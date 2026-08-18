# Motor Emocional-Financeiro do Nino (emotion_finance.v1)

Evoluir o módulo emocional de uma correlação simples humor × categoria para um motor longitudinal
emoção → comportamento financeiro, com baseline pessoal, janelas temporais, controles de contexto,
tamanho de amostra e nível de confiança. O motor calcula; o Nino apenas explica.

## Princípios não negociáveis

- Associação, nunca causa. O Nino diz "no seu histórico, X aparece junto com Y", nunca "você gastou porque estava ansioso".
- Nenhum número nasce fora do motor determinístico (mesma regra dos motores atuais, envelope `nino_engines.v1`).
- Sem amostra mínima, o Nino diz honestamente que ainda está observando — não estima.
- Nada de diagnóstico psicológico, rótulo clínico ou tom de julgamento.

## O que o motor vai calcular

Para cada emoção registrada (catálogo canônico atual: tranquilo, atento, preocupado, confiante,
impulsivo, frustrado, celebrando, culpado):

1. **Episódios**: cada check-in vira um episódio com janelas de 6h / 24h / 48h após o registro.
2. **Baseline pessoal contextual**: gasto esperado para aquele usuário no mesmo dia da semana,
   mesma fase do mês (início/meio/fim e proximidade do fechamento de fatura), fim de semana ou não,
   excluindo transferências, faturas, investimentos, recorrentes já conhecidos e atípicos (outliers por MAD).
3. **Uplift**: observado ÷ esperado, com delta absoluto em reais.
4. **Consistência**: em quantos dos N episódios o gasto ficou acima do esperado (ex.: 12 de 17).
5. **Drivers**: categorias e estabelecimentos que mais explicam a diferença.
6. **Frequência e ticket**: número de compras e ticket médio no episódio vs. baseline.
7. **Confiança**: `insufficient_data | low | medium | high`, por amostra + consistência + cobertura de dados.

Camada 2 — **padrões compostos**: emoção + contexto financeiro (ex.: "atento nos 7 dias antes do
fechamento da fatura", "cansaço seguido de delivery", "3 dias consecutivos de humor melhor").
Só publicados quando a amostra do cruzamento atinge o mínimo próprio.

Camada 3 — **risco prospectivo**: quando um padrão é `medium/high`, um check-in novo da mesma emoção
gera um sinal do dia: "em 7 de 10 vezes seus gastos flexíveis subiram nas 24h seguintes — quer que eu
te ajude a segurar até amanhã?" com ação concreta (limite do dia, revisar depois, ignorar).

## Onde isso aparece

- **Tela Emoções**: substitui o bloco atual de correlação por "Padrões do seu histórico" — cartões com
  emoção, uplift, consistência, drivers, período e selo de confiança/amostra, mais estado vazio
  explicando quantos registros faltam.
- **Nino (app e WhatsApp)**: perguntas como "eu gasto mais quando estou ansioso?" respondidas pelo motor,
  com números e ressalva de associação; e o sinal do dia no fluxo proativo já existente.
- **Home**: no máximo um cartão, quando houver padrão relevante e sinal ativo no dia.
- **Painel admin**: ajuste de amostra mínima, janelas, piso de uplift e liga/desliga do sinal prospectivo
  e do envio por WhatsApp — sem mexer em código.

## Detalhes técnicos

- Novo `src/lib/engine/emotionFinance.ts` (envelope `nino_engines.v1`, `formula_version: emotion_finance.v1`),
  espelhado nas Edge Functions via `scripts/sync-finance-core.mjs` (entra em `FINANCE_CORE_MODULES`, com
  teste de paridade existente cobrindo).
  Funções: `buildEmotionEpisodes`, `contextualBaseline`, `emotionUplift`, `compositePatterns`, `prospectiveSignal`.
- Fonte de dados: `emotional_checkins` (`emotion_key`, `mood`, `occurred_at`, `notes`) + `transactions`
  confirmadas (exclusões canônicas de `engineEnvelope.ts`, uso de data econômica/bancária conforme
  `behavioralDate`), com aliases legados resolvidos por `src/lib/emotions/catalog.ts`.
- Persistência: gravar os padrões em `behavioral_patterns` (já tem `detector`, `uplift_pct`, `consistency`,
  `sample_size`, `confidence`, `evidence`, `exclusions`, `formula_version`) com `detector = emotion_finance`,
  recalculados no `nino-intelligence-tick`. Sem tabela nova para o padrão.
- Migration nova apenas para: configuração admin (`emotion_finance_config`: janelas, amostra mínima,
  piso de uplift, canais, sinal prospectivo ligado) com RLS + GRANT, RPCs `admin_emotion_finance_config`
  e `admin_emotion_finance_config_update` (`_require_perm`), e a RPC de leitura do padrão pelo app.
- Nino: nova ferramenta determinística `get_emotion_finance_patterns` em `tools.ts`, rota em
  `CapabilityRouter.ts`, formatação em `DeterministicAnswers.ts` e guarda de linguagem no
  `ResponseValidator.ts`/`prompt.ts` proibindo frase causal ("porque estava", "isso causou").
- Proatividade: novo detector em `ProactiveDetectors.ts` (kind `emotion_spend_signal`), classificado como
  care kind em `careKinds.ts`, entrada no `communication_catalog` com severidade e cota próprias.
- Frontend: `src/components/emotions/EmotionFinancePatterns.tsx` + ajuste em `src/pages/Emocoes.tsx`
  (remove `Correlations` legado); admin em `src/components/admin/nino/EmotionFinanceBoard.tsx`.
- Testes: `src/test/emotion-finance.test.ts` cobrindo baseline por dia da semana, amostra insuficiente,
  neutralização do caso "sexta-feira já é dia de jantar", exclusão de atípicos, consistência e
  ausência de linguagem causal.
- Sem alteração de identidade visual, paleta ou LP. Sem publicação em produção.
