# Nino narrativa: de motor de alertas para assessor (`nino_narrative.v1`)

## O que está acontecendo hoje (verificado)

- Todos os 72 templates ativos de comunicação estão em modo `fixed`. A infraestrutura `ai_framed` existe no código (coluna `mode`, `frame_template`, renderizador), mas **nunca executa** — por isso todas as mensagens têm cara de alerta de sistema.
- O texto final hoje vem de: corpo determinístico do motor + moldura fixa do template + uma checagem comportamental que só devolve o corpo determinístico quando o texto inventa número.
- Já existe base reutilizável: catálogo de narrativa com tom/termos permitidos e proibidos, memória com origem, confiança e data de validade, e registro de entregas com evidência e motivo de bloqueio.

Ou seja: não é preciso criar uma segunda verdade nem um segundo banco de fatos. Falta a camada de leitura em cima do que já é calculado.

## O que vai ser construído

### 1. Pacote de evidência tipado
Novo contrato `NarrativeEvidencePack` (versionado) montado a partir dos fatos canônicos da situação: tipo, período, fato principal, fatos de apoio, categorias e estabelecimentos relevantes, contexto de ritmo/anomalia/caixa/cartão/dívida/meta/comparação, confiança, afirmações permitidas e proibidas. A camada de linguagem recebe **apenas** esse pacote — nunca acesso livre aos dados.

### 2. Agrupamento multissinal
Quando vários sinais contam a mesma história (ritmo acima do normal + mobilidade + lazer + várias compras pequenas), eles entram como um único pacote com um fato principal e apoios, gerando uma leitura em vez de quatro avisos.

### 3. Camada de linguagem (AI-framed de verdade)
Para cada mensagem elegível: corpo determinístico + pacote de evidência + política de tom por tipo (risco, atenção, conquista, comportamento, lembrete, meta, relatório) → texto humano com título editorial, conclusão antes do número, 1 a 3 números no máximo e, quando fizer sentido, **uma** pergunta específica.
Elegibilidade: ritmo, padrão, comparação, concentração, fechamentos, meta, mudança de comportamento, risco multifatorial, oportunidade, conquista.
Fica determinístico o que é operacional: parcela vence amanhã, confirmação de pagamento/lançamento, divisão do rolê, recebimento.

### 4. Guarda de verdade
Antes de enviar: todo valor, percentual, data, categoria e estabelecimento citado tem de existir no pacote; nenhuma causa, risco ou projeção inventada; afirmação proibida barra o texto; confiança insuficiente barra o texto. Falha → envia o corpo determinístico. Nada é enviado sem passar por essa checagem.

### 5. Variação controlada
Rotação de abertura, título, estrutura e pergunta por usuário e por assunto, com histórico curto para não repetir "Notei que..." toda hora. A variação nunca muda fato.

### 6. Memória das respostas e validade
Resposta do usuário ("foi planejado, estou viajando") vira contexto estruturado na memória existente, com assunto, origem, confiança, início e **data de expiração**. Enquanto valer, as leituras seguintes reconhecem o contexto; depois de expirar, ele deixa de explicar gastos. Respostas como "é recorrente", "é do trabalho", "não quero alertas disso" alimentam aprendizado, supressão e categoria — sempre com registro visível, nunca regra permanente oculta.

### 7. Categorização
O Nino pode sugerir revisão de categoria quando houver base, sem alterar nada sozinho e sem contrariar categoria confirmada pelo usuário sem nova evidência.

### 8. Relatórios do assessor
Os relatórios passam a abrir com a leitura do período (o que mudou e por quê, onde está o espaço de ajuste) e só depois os números de prova, com as mesmas regras de verdade.

### 9. WhatsApp escaneável
Título em negrito, quebras curtas, destaque nos termos que importam, emoji com moderação, pergunta final em negrito quando houver.

### 10. Custo, latência e painel
Geração das mensagens proativas fora do caminho de resposta ao usuário. Cada comunicação registra modelo, latência, tokens, uso ou não da narrativa, resultado da guarda e motivo de fallback. No painel: fatos → situação → texto determinístico → narrativa → guarda → texto final.

### 11. Testes
No mínimo 20 cenários golden (gasto acima do típico, gasto pontual, viagem planejada, categoria acelerando, caixa apertado, fatura alta, meta saudável, meta em risco, melhora e piora de comportamento, dívida, parcelas, concentração, semana boa e ruim, mês parcial, período sem comparação, dados insuficientes, limite de cartão desconhecido, múltiplos sinais), avaliando verdade, naturalidade, concisão, repetição, quantidade de números, tom e qualidade da pergunta.

### 12. Entrega final
Relatório com pelo menos 10 exemplos reais no formato ANTES / EVIDÊNCIAS / DEPOIS / GUARDA (passou ou caiu no determinístico), usando dados reais do projeto.

## Detalhes técnicos

- Novos módulos em `supabase/functions/_shared/agent/narrative/`: `NarrativeEvidencePack.ts` (contrato + montagem a partir da situação canônica), `SignalGrouping.ts`, `TonePolicy.ts`, `NarrativeComposer.ts` (chamada ao gateway, streaming, telemetria via `recordGatewayCall`), `NarrativeGuard.ts` (números/datas/categorias/merchants/claims), `NarrativeVariation.ts`.
- Reuso: `EvidenceClaims.ts` para claims permitidos, `nino_narrative_catalog` para tom e termos permitidos/proibidos, `agent_memory` (`source`, `confidence`, `expires_at`) para contexto temporário, `nino_learning_events` para aprendizado.
- `CommunicationDispatcherV3.ts` passa a: montar o pacote, decidir `fixed` vs `ai_framed` por tipo, chamar a composição, aplicar a guarda e persistir a trilha em `communication_deliveries` (novas colunas: `narrative_mode`, `narrative_model`, `narrative_body`, `guard_status`, `fallback_reason`, `contextual_question`, `narrative_tokens_in/out`, `narrative_latency_ms`, `evidence_pack_version`).
- Migration: colunas acima + índice por `guard_status`; virada dos tipos elegíveis para `mode='ai_framed'` no catálogo de templates, mantendo `body_template` como corpo determinístico de fallback.
- Espelhamento `src/lib/copy` ↔ `_shared/copy` via `scripts/sync-finance-core.mjs`; `AGENT_RUNTIME_VERSION` bump e redeploy das funções de `DEPENDENTS.md` (só com sua autorização).
- Admin: nova seção de rastreio da narrativa (fatos → situação → determinístico → narrativa → guarda → final) e séries de custo/latência da narrativa separadas do restante.

## Fases

1. Contrato do pacote de evidência + agrupamento multissinal + testes de montagem.
2. Política de tom, composição e guarda, com fallback determinístico e telemetria.
3. Virada seletiva dos tipos elegíveis para narrativa (operacionais permanecem determinísticos).
4. Memória contextual com validade, aprendizado das respostas e sugestão de categoria.
5. Relatórios do assessor e formatação WhatsApp.
6. 20+ testes golden, painel de rastreio e relatório com 10 exemplos reais.

## Fora do escopo

Nenhuma mudança em cálculo financeiro, verdade canônica, autenticação ou banco de fatos. Nenhum deploy sem sua autorização explícita.
