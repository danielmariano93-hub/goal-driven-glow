# Nino: refinamento técnico completo (05/11/2026)

Escopo: produto inteiro (app, agente de WhatsApp, comunicação proativa, banco, backend, CI, operação).
Método: leitura do código (`main` em 61a8736), consultas somente leitura ao banco de produção (projeto "Meu Nino"), alertas do
próprio Supabase e suíte local. Cada achado diz se foi **[verificado]** (medi ou li) ou **[inferido]**. Seção 8 lista o que
NÃO foi verificado.

## 1. Resumo executivo

- O Nino é um produto grande para a escala de uso atual: 45 funções de backend, 261 tabelas (RLS ligada em todas), 576 funções
  SQL, 32 agendamentos, 84 ferramentas do agente, 52 tipos de comunicação, ~283 mil linhas de TypeScript, 509 arquivos de teste
  (suíte completa: 508 arquivos / 4350 testes passando). Em produção há **12 perfis, 4 deles de teste** e ~3 mil lançamentos.
- A fundação é boa: RLS em 100% das tabelas, testes de paridade app x servidor, suíte completa no CI, flags por usuário, guardas
  que preferem recusar a responder errado.
- Os riscos reais hoje não estão na falta de funcionalidade, e sim em: **(a)** diagnosticabilidade do agente (argumentos das
  ferramentas não são gravados), **(b)** comunicação sem medição de engajamento, **(c)** complexidade acumulada (dois runtimes de
  agente, 42 flags, 514 migrações), **(d)** higiene de segurança e desempenho do banco que ainda não dói, mas vai doer com escala,
  **(e)** entrega de WhatsApp sem política de fila vencida (despejo de 8 mensagens em 27/10).
- Uma única falha de segurança concreta e pequena: `nino_diag_changed_since` (S1).

## 2. Inventário de funcionalidades (o que existe hoje)

### 2.1 App (rotas `/app`)
Home (resumo) · Lançamentos (lista, detalhe, edição) · Contas · Categorias · Cartões (faturas, ciclos, pagar fatura) · Dívidas ·
Recorrências · Compromissos (agenda) · **Metas** (de valor e de gasto por categoria, cartão compacto com projeção e data prevista,
acordeão "Planos e experimentos" com criação de plano) · Metas conjuntas (convite, ranking) · Planejamento · Investimentos ·
**Ticket Alimentação** (carteira de benefício, gráfico por dia da semana, edição de lançamento) · Divisão do rolê (criar, editar,
lembretes, cobranças recebidas) · Relatórios (inteligentes, semanal e mensal, agendados) · Mapa/Emoções (check-in emocional,
padrões) · Desafios · Notificações · Importar (CSV, OFX, formato legado) · Open Finance (Pluggy) · Perfil · Plano (catálogo e lista
de espera; **não há cobrança integrada**) · WhatsApp (conectar aparelho por QR/código, número oficial) · Guia · Assessor · Nino
(hub, contexto, "Prepare-se"/antecipações, detalhe de alerta) · links curtos `/s/:token` · onboarding · login/cadastro/recuperação
de senha · exportação e exclusão de conta (LGPD) · push web/nativo · landing, privacidade e termos.

### 2.2 Nino no WhatsApp (agente, 84 ferramentas)
- **Registrar** (sempre como rascunho com confirmação): gasto/receita, transferência, pagar fatura, dívida, meta, aporte em meta,
  meta de gasto por categoria, divisão do rolê, recorrência, editar/apagar lançamento, desfazer a última ação.
- **Consultar**: saldo, resumo, fatura de cartão, parcelas futuras, gasto por data/período, comparar períodos, comparar com a média
  mensal, patrimônio líquido, Ticket Alimentação, agenda de compromissos, investimentos, fontes financeiras.
- **Analisar**: gasto por estabelecimento/categoria/dia da semana, anomalias, oportunidades de economia, projeção de fechamento do
  mês, projeção de caixa explicada, evolução e trajetória financeira, saúde e desempenho financeiro, plano financeiro, simulação de
  meta e de parcelamento, comportamento e emoções, mapa financeiro.
- **Entrada**: texto, áudio (transcrição), documentos (extrato/nota com revisão), registro rápido por token, notificações bancárias.
- **Saída**: gráficos (artefatos), relatório por modelo, explicação do porquê de uma mensagem proativa.
- **Mudança de hábito**: compromissos de mudança (criar, pausar, acompanhar), check-in emocional.

### 2.3 Comunicação proativa (52 tipos em 13 famílias, 3 canais: app, WhatsApp, push)
Famílias: recorrências/vencimentos (8) · metas (8) · antecipação (7) · gastos (6) · hábitos (5) · evolução (5) · financeiro (3) ·
conquistas (2) · emoções (2) · categorização (2) · desempenho (2) · operacional (1) · comportamento (1).
Motores: ciclo horário (:17), antecipação, lembretes de vencimento, previsão do fim de semana + fechamento de segunda, aviso de dia
útil, **plano do dia crítico** (novo, flag), alertas do Ticket, metas de gasto, relatórios semanais/mensais, momento comportamental.
Controles: catálogo por tipo (canal, severidade mínima, cooldown), opt-out, silêncio 21h-8h, orçamento em pontos, **pilares e teto
de 5/dia** (novo, flag), narrativa por IA com guarda de números.

### 2.4 Plataforma e operação
Admin (visão geral, clientes e ficha, produto/crescimento, comunicações, Nino IA e custos, administração) · MCP próprio (7
ferramentas: lançar, posição, resumo, extrato e quitação de fatura…) · motor de categorias com consenso global · finance-core
espelhado entre app e servidor · 42 flags (18 ligadas no banco; por usuário) · alertas operacionais · auditoria de IA (execuções,
ferramentas, custo).

## 3. Arquitetura em camadas

1. **App** (Vite/React, TanStack Query, shadcn): telas finas sobre `src/lib/engine` (lentes e métricas) e `src/lib/db`.
2. **finance-core** (`src/lib/engine` espelhado em `supabase/functions/_shared/finance-core`): números iguais no app e no servidor,
   garantidos por teste de paridade.
3. **Agente**: AgentCore (V1), AgentCoreV2, ponte V3, "brain" de escrita (ActionIR → workflow durável → ferramenta de rascunho),
   interpretador semântico, grounding e guardas de contrato.
4. **Proactive**: sinais → situações → alocador (pilares) → despachante (política) → canais.
5. **Banco**: Postgres com RLS, RPCs `SECURITY DEFINER`, 32 jobs, filas em tabelas.

## 4. Estado medido [verificado]

| Item | Valor |
|---|---|
| Perfis / de teste | 12 / 4 |
| Lançamentos | 2.993 |
| Tabelas / com RLS | 261 / 261 |
| Funções SQL / agendamentos | 576 / 32 |
| Linhas TS (app / servidor) | ~163 mil / ~120 mil |
| `any` explícito (app / servidor) | 747 / 1.367 |
| Erros de tipo no app (`tsc`) | 17 (já existiam; fora do escopo desta sessão) |
| Maiores arquivos | `tools.ts` 4.077 · `AgentCore.ts` 2.464 · `assistant-ingest-document` 2.070 · `AgentCoreV2.ts` 1.609 · `mcp/index.ts` 1.511 |
| Migrações | 514 |
| Execuções do agente, 7 dias | 600 (caminho com IA: 539, média 9,0 s, p95 13,5 s) |
| Erros no caminho com IA, 7 dias | 134 de 539, **mas 126 foram em 29-30/10 (baterias de teste ao vivo)**; de 31/10 a hoje: 8 de 73 (11%), todos no caminho com IA |
| Latência por caminho | registro rápido 1,8 s · ferramenta determinística 8,9 s · IA 9,0 s |

Nota sobre o erro: os 134 inflam pelo piloto de 29-30/10. Os erros restantes são em maioria **guardas que recusam** (por desenho),
e 2 são o `needs_amount` já corrigido hoje. Não dá para afirmar a taxa de "resposta ruim ao usuário" só com esses dados.

## 5. Achados

Severidade: **P0** corrigir já (pequeno e claro) · **P1** próximo ciclo · **P2** planejado · **P3** higiene.

### Segurança
- **S1 (P0) [verificado]** `nino_diag_changed_since(_user_id, _since, _scope)` é `SECURITY DEFINER`, aceita qualquer `_user_id` e é
  executável **sem login** (anon). Devolve um booleano ("esse usuário teve atividade desde T?"). Exige conhecer o UUID, então o
  risco é baixo, mas é gratuito de fechar: só é chamada por outras funções do banco (migração `20261029230000`). Correção:
  `revoke execute ... from public, anon, authenticated`.
- **S2 (P2) [verificado]** 358 funções `SECURITY DEFINER` executáveis por usuário logado. Triei as 45 que recebem um id de usuário:
  4 de admin (protegidas por `_require_perm`), 5 auxiliares de RLS (`has_role`, `is_client_user`, `is_shared_goal_member`,
  `is_split_participant`, `shared_goal_role`: não dá para revogar, as políticas precisam delas; vazam no máximo um booleano para
  quem já conhece os UUIDs) e a S1. **Não auditei o corpo das outras ~313**. Recomendação: teste automatizado que lista as funções
  definer chamáveis e falha se surgir uma fora de uma lista permitida.
- **S3 (P1) [verificado]** Proteção contra senha vazada desligada (configuração de Auth).
- **S4 (P3) [verificado]** `pg_net` no schema `public`; 1 função sem `search_path` fixo; 8 funções chamáveis por anon (as legítimas:
  `landing_plans_public`, `resolve_short_link`, `plan_waitlist_join`, `plan_interest_track`; 2 são gatilhos).
- **S5 (informativo) [verificado]** 41 tabelas com RLS e sem política: tabelas internas (filas, chaves VAPID, mensagens). Nega
  tudo a usuários e libera só o serviço: o desejado.

### Banco e desempenho (não dói com 12 usuários, mas vai doer)
- **D1 (P2) [verificado]** 169 políticas com `auth.uid()` sem `(select ...)`: reavaliadas por linha. Correção mecânica por migração.
- **D2 (P3) [verificado]** 81 chaves estrangeiras sem índice, 48 índices sem uso, 14 casos de políticas permissivas múltiplas,
  3 índices duplicados.
- **D3 (P3) [verificado]** Crescimento: `financial_situation_evidence` 30 MB para ~1,8 mil linhas (~17 KB por linha),
  `nino_diagnosis_snapshots` 52 MB. `proactive_decisions` (54 mil linhas) não aparece nos jobs de retenção.
- **D4 (P2) [verificado]** 514 migrações e 576 funções: o custo de recriar o banco e de revisar mudanças cresce. Considerar uma
  migração-base consolidada.
- **D5 (P2) [inferido]** 4 jobs rodam a cada minuto ou a cada 2 minutos (snapshot, fila de mensagens, envio de WhatsApp, limpeza de
  documentos). Com poucos usuários é barato; medir custo de invocações antes de escalar.

### Agente (IA)
- **A1 (P0/P1) [verificado]** Os argumentos das ferramentas **não são gravados** quando o resultado vem pela ponte V2
  (`evidence_unavailable_in_v2_bridge`). Foi isso que escondeu a causa do erro do "10,80". Gravar argumentos (mascarando
  conteúdo sensível) é o maior ganho de diagnóstico por esforço.
- **A2 (P1) [verificado]** Conversão de valor dependia de `Number()`; cada ferramenta de ciclo de vida tem o seu conversor de "10,80".
  Corrigido o rascunho de lançamento (#386). Recomendação: um único conversor de valor compartilhado, com teste de tabela.
- **A3 (P1) [verificado]** Latência: caminho "determinístico" leva 8,9 s em média, quase igual ao da IA. Algo pesado roda nele
  (provável composição por IA depois da ferramenta) [inferido]. Para WhatsApp, 9 s é muito.
- **A4 (P2) [verificado]** Dois runtimes de agente coexistem (AgentCore 2.464 linhas e AgentCoreV2 1.609, mais ponte V3 e "brain") e
  42 flags. A matriz de combinações é maior do que dá para testar. Plano: para cada flag já em 100% em produção, remover o ramo
  antigo.
- **A5 (P1) [verificado]** Qualidade contínua: o conjunto dourado ao vivo (~150 perguntas com gabarito por SQL) e o teste "zero
  resposta errada executada" no CI estão em aberto desde o piloto.
- **A6 (P2) [inferido]** Autocorreção ("reinterpretar uma vez quando o plano falha") em andamento; reduz recusas desnecessárias.

### Comunicação proativa
- **C1 (P1) [verificado]** **Sem medição de engajamento**: `interacted_at` e `acted_at` vazios em todas as entregas de WhatsApp. Sem
  isso a calibração dos pilares é no escuro. É a Fase 3. Indício disponível: resposta em até 2 h (check-in emocional 9/16, aviso de
  ritmo 1/9, risco do dia da semana 1/8).
- **C2 (P1) [verificado]** **Fila vencida despejada**: 20 falhas de WhatsApp a partir de 20/10, 6 dias sem envio, depois **8
  mensagens em 27/10**. Falta regra "mensagem velha não sai" e política de reenvio. A causa das falhas de 20/10 **não foi
  investigada**.
- **C3 (P1) [verificado]** Severidade inflada em tipos de meta (impacto de R$ 26 marcado como crítico). Hoje só o pilar Proteger
  fura o teto; a raiz (como a severidade é calculada) continua.
- **C4 (P2) [verificado]** Superfície duplicada de plano: a página `HabitsV2` (aceite do limite de fim de semana) **não tem rota em
  `App.tsx`** (só testes a importam) e o fluxo novo de planos está em Metas. Decidir qual fica.
- **C5 (P2)** O servidor não impõe "um plano ativo por vez" (só o app). Pilares e plano do dia crítico estão **ligados só na conta
  dona**; faltam dias de dados reais.

### Qualidade de código e CI
- **K1 (P2) [verificado]** Tipagem frouxa: 2.114 `any` e 5 supressões de tipo. O CI faz `deno check` só nos contratos puros V2/V3; o
  resto do servidor é "relatado como dívida", não bloqueado.
- **K2 (P2) [verificado]** Arquivos gigantes (`tools.ts` com 4 mil linhas, 84 ferramentas num arquivo só): difícil de revisar e de
  testar por partes.
- **K3 (P3) [verificado]** **ESLint não roda em nenhum workflow.**
- **K4 (P3) [verificado]** O CI mantém duas listas curadas de testes além de `npm test` (suíte completa): a lista é uma
  "primeira passada rápida" e custa uma tarefa manual a cada teste novo.
- **K5 (P3) [verificado]** Código morto provável: `AssessorAcompanhamento` e `AssessorAcompanhamentoV2` sem rota própria
  (`NinoHub` usa a V2), `HabitsV2` sem rota.
- **K6 (P2) [verificado]** Pares app/servidor mantidos à mão por paridade (finance-core, `dayPlan`/`dayPlanOffer`): bom padrão, mas
  cada par novo é uma dívida que só o teste protege.
- **K7 (P1) [verificado]** Não há teste ponta a ponta em navegador nem no WhatsApp real (sem Playwright/Cypress).

### Produto
- **R1 (P2) [verificado]** Não encontrei provedor de pagamento no código; o "Plano" é catálogo e lista de espera.
- **R2 (informativo)** Escala pequena (12 perfis): toda calibração (cotas, severidade, convites) é estatisticamente frágil. Evitar
  decisões "definitivas" sobre poucos dados.

## 6. Roadmap recomendado

**Agora (dias)**
1. S1: revogar execução de `nino_diag_changed_since` (migração de uma linha).
2. A1: gravar argumentos reais das ferramentas na ponte V2.
3. Ativar proteção contra senha vazada (S3).
4. Acompanhar 3 a 5 dias das flags na conta dona (pilares e plano do dia crítico) antes de ampliar.

**Próximo ciclo (1-3 semanas)**
5. Fase 3: telemetria de engajamento por pilar (entregue, lida, ação, silenciou).
6. C2: regra de validade (mensagem velha não sai) e investigação das falhas de 20/10.
7. A5: conjunto dourado ao vivo e teste "zero resposta errada" no CI.
8. A3: perfilar a latência de 9 s do caminho determinístico.
9. A2: conversor único de valor.
10. K7: um fluxo ponta a ponta mínimo (registrar um gasto) em ambiente de teste.

**Planejado (1-2 meses)**
11. C3: calibrar severidade na origem. 12. A4: aposentar ramos antigos atrás de flags já em 100%. 13. D1 (initplan) e D2 (índices) em
migração mecânica. 14. S2: teste de allowlist de funções definer. 15. K1: subir o `deno check` para bloqueante por pasta,
começando pelas novas (`proactive/`). 16. K5/C4: decidir e remover código morto. 17. D4: migração-base.

## 7. Critérios de aceite sugeridos
- Nenhuma função chamável sem login que receba `user_id`.
- 100% das chamadas de ferramenta com argumentos gravados e mascarados.
- Engajamento medido para ≥ 90% das mensagens de WhatsApp.
- Nenhuma mensagem proativa enviada com mais de 6 h de atraso (exceto prazo/caixa).
- p95 do caminho determinístico < 4 s.

## 8. O que NÃO foi verificado
- Corpo das ~313 funções `SECURITY DEFINER` fora da triagem por `user_id`.
- Comportamento real no app (telas) e no WhatsApp ponta a ponta; só testes e dados.
- Código do servidor sob `deno check` (sem Deno neste ambiente).
- Custo mensal de IA e de invocações; taxa de "resposta ruim ao usuário" (só recusas e erros foram contados).
- Causa das 20 falhas de WhatsApp de 20/10.
- Conteúdo de mensagens e dados de outros usuários: não li (só contagens agregadas e a conta dona).
