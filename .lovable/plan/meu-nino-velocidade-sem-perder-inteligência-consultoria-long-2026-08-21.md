# Meu Nino — Velocidade sem perder inteligência + Consultoria longitudinal

Plano fechado, uma única iniciativa. Todo diagnóstico abaixo foi confirmado no código e na observabilidade real deste projeto.

## 1. Diagnóstico — latência do App (medido)

- `useAllTransactions()` = `useTransactions({})`: `select("*")` (66 colunas), páginas de 1.000, laço de até 100 páginas, sem recorte de período. O usuário principal já tem 1.735 lançamentos (jan→ago/2026): a Home baixa a vida financeira inteira para mostrar o mês.
- `useFinancialSnapshot()` consome 15 fontes e chama `computeFinancialSnapshot()` no cliente a cada tela (Home, Metas, Compromissos, Planejamento, MetaCategoriaDetalhe) — recálculo integral por navegação.
- `financial_current_snapshots` existe e está **vazia (0 linhas)**: o snapshot server-side foi criado e nunca foi alimentado.
- `financial_daily_facts` tem apenas **59 linhas** e `financial_performance_snapshots` **1 linha** — a materialização existe mas não cobre o histórico.
- Cache: `staleTime` único de 30s para tudo (categorias, contas, saldo, snapshot).
- `invalidateFinancialQueries` invalida **32 chaves** e marca snapshots sujos; `FinancialRealtimeSync` dispara isso para qualquer alteração em `transactions`/`category_spending_goals`. Um lançamento pelo WhatsApp recarrega o ledger completo + 15 fontes.

## 2. Diagnóstico — latência do Agente (medido em `agent_runs`, 14 dias)

| rota | n | p50 | p90 | tokens_in médio | tokens_out |
|---|---|---|---|---|---|
| fast_log | 94 | 915 ms | 1.425 ms | 0 | 0 |
| deterministic_tool | 10 | ~3,5–5 s | 6,8 s | 0 | 0 |
| llm (general) | 24 | 7.362 ms | 9.855 ms | 18.972 | 304 |
| llm (performance) | 1 | 10.486 ms | — | 26.042 | 385 |
| llm (merchant) | 1 | 12.903 ms | — | 25.576 | 424 |

As tools são rápidas (166–716 ms). O custo está no prompt e no loop.

## 3. Breakdown de tokens (origem confirmada no código)

O escopo de tools **já** é filtrado por capability (11–16 tools/turno) — isso não é o vilão principal. O bloat vem do empilhamento no `AgentCore`:

| bloco | origem | estimativa |
|---|---|---|
| system prompt do banco | `agent_prompt_versions` (635 chars) | ~0,2k |
| contexto financeiro 360 | `JSON.stringify(...).slice(0, 14_000)` | ~3,5k |
| diagnóstico canônico | `nino_diagnosis_context_for_user` (JSON completo) | ~1,5–3k |
| regra crítica + plano + capability + contas + pendência + correções | 6 blocos concatenados | ~1,5k |
| histórico | 12 turnos × até 2.000 chars | ~2–6k |
| schemas das tools | 11–16 specs | ~3–5k |
| resultados de tool | JSON bruto devolvido ao modelo | ~2–8k |
| **multiplicador** | cada passo do loop reenvia tudo; `tokens_in` é somado por passo | ×1–3 |

## 4. Fluxo atual vs alvo

```text
HOJE:   query -> capability -> [360 + diagnóstico + 6 blocos + 12 turnos + 15 schemas] -> LLM -> validator
ALVO:   query -> capability -> context budget -> tools determinísticas
        -> FinancialAnswerContext compacto -> (template | LLM leve) -> validator
```

## 5. Gargalos por impacto

P0: ledger completo na Home · invalidação global em cascata · prompt de 20–27k tokens · perguntas simples pagando rota LLM completa.
P1: `staleTime` uniforme · histórico sem sumarização · resultados de tool crus no prompt.
P2: ausência de breakdown de latência por estágio · fatos diários/mensais sem backfill.

## 6. Arquitetura alvo de performance

**App** — a UI apresenta, não recalcula:
- Nova RPC `financial_snapshot_current(_user_id)` materializa `financial_current_snapshots` (saldo, disponível, gasto, renda, resultado, ritmo, projeção, exposição de cartão, compromissos, metas, patrimônio, provenance, completeness). Usa **exatamente** os motores canônicos (`finance-core`, espelho de `src/lib/engine`) — nenhuma fórmula nova.
- `useFinancialSnapshot()` passa a ler a RPC; o cálculo cliente fica como fallback explícito quando o snapshot está sujo/ausente (mesmo padrão já usado em `performanceSnapshots.ts`).
- `useTransactions` ganha `columns` e `limit` obrigatórios por caso de uso: Home = janela do período; Lançamentos = paginação real (`useInfiniteQuery`); Relatórios = período pedido. `useAllTransactions()` fica restrito a rotinas explicitamente históricas.
- Colunas enxutas (12 campos) em vez de `select("*")`.

**Agente** — orçamento de contexto por rota:

| rota | contexto alvo | latência alvo |
|---|---|---|
| fast_log | 0 tokens | < 1,2 s (já ok) |
| determinística + template | 0 tokens | < 2,5 s |
| LLM simples | ≤ 3k | 2–4 s |
| LLM analítica | ≤ 7k | 3–6 s |
| multi-step | ≤ 12k | 4–8 s |

Meta agregada: p90 das perguntas normais < 6 s; App first paint < 1 s, dados principais < 1,5 s, navegação quente < 500 ms.

Como chegar lá, sem tirar inteligência:
- `FinancialAnswerContext` (contrato único: `question_scope, facts, comparisons, drivers, confidence, limitations, provenance, suggested_actions`). Toda tool analítica retorna esse pacote compacto para o modelo e guarda o payload completo para artefato/recibo.
- Diagnóstico e contexto 360 entram **por capability**, com corte de campos (não `slice(14_000)`), e nunca os dois inteiros no mesmo turno.
- Histórico: 4 turnos recentes crus (800 chars) + resumo semântico do restante via `MemoryStore` + `ContinuationContract`. Continuidade preservada; texto antigo integral não vai mais.
- `DeterministicAnswers` cobre "quanto gastei", "qual minha fatura", "qual dia gasto mais", "quanto tenho de patrimônio" com template humanizado — sem LLM.
- Roteamento de modelo por tarefa já existe (`modelGateway`): passa a usar modelo leve para classificação/humanização e reserva o modelo forte para raciocínio.

## 7. Snapshots, materialização e invalidação

Grafo de dependência explícito (substitui a invalidação global):

```text
transaction(dia D) -> financial_daily_facts(D) -> monthly_fact(mês de D)
                   -> longitudinal windows que contêm D
                   -> financial_current_snapshots
                   -> financial_performance_snapshots afetados -> advisor decision
```

- `financial_truth_changed` passa a receber o(s) período(s) afetados e marca só o que depende deles.
- `invalidateFinancialQueries` passa a aceitar um escopo (`transactions | cards | goals | debts | all`); realtime usa escopo, não `all`.
- `staleTime` por natureza: quase estáticos 30 min (categorias, contas, cartões, settings), dinâmicos 30 s, derivados governados por `valid_until` do snapshot.
- Prefetch leve nas rotas principais (Home, Lançamentos, Nino, Relatórios, Metas).
- Recomputação incremental em background pelo `finance-backfill-runner` (já existe) após importação histórica — nada síncrono no upload.

## 8. Inteligência longitudinal (`longitudinal_intelligence.v1`)

Novo motor em `src/lib/engine/longitudinal.ts` (espelhado para as functions pelo `sync-finance-core.mjs`), consumindo os motores existentes — sem duplicar fórmula:
- Série mensal/semanal de renda, gasto, resultado, savings rate, gasto flexível vs estrutural (`costStructure`), frequência, ticket, cartão, dívida, patrimônio, volatilidade.
- Tendência determinística: média móvel, mediana móvel, inclinação, **change-point detection**, streaks, regime — saída `{status, started_at, duration_months, confidence}`. A LLM nunca decide matemática.
- Separação obrigatória **resultado** vs **comportamento** (renda extraordinária não vira "melhora comportamental").
- Normalização de eventos extraordinários (PLR/bônus, férias, compra única, viagem, resgate, quitação, estorno) e respeito absoluto aos invariantes: `internal_transfer`, `card_payment`, `investment_application/redemption`, `refund`, `loan_proceeds` e **`adjustment` (âncora de conciliação)** nunca são consumo, renda, melhora ou poupança.
- Confiança reduzida quando a base é fraca (share categorizado, transferências ambíguas, dados estimados): "há sinal de melhora" em vez de "você melhorou".

## 9. Wealth Opportunity (`wealth_opportunity.v1`)

- Baseline pessoal por categoria flexível (mediana robusta do próprio usuário), `observed_spend`, `recoverable_excess` — sem culpa e sem assumir corte total.
- Cenários configuráveis: conservador 25%, realista 50%, forte 70% do excesso recuperável.
- Patrimônio contrafactual mês a mês (nunca `economia × 12`): sem rendimento por padrão; com rendimento só em cenário explícito e capitalizado por aporte.
- Saída: `WealthOpportunity {period, observed_spending, baseline_spending, recoverable_excess, conservative/realistic/strong, actual_net_worth, potential_net_worth, opportunity_gap, main_sources, confidence, assumptions}`.

## 10. Do passado para o plano

- `sustainable_monthly_saving` derivado de baseline + excesso recuperável + renda + compromissos + dívidas + metas.
- Esse número alimenta `goal_strategy.v1` como **funding capacity** (nada de motor novo de meta).
- Ações do Nino após a análise: criar meta, criar limite por categoria, acompanhar, recalibrar, alertar desvio, comemorar melhora real — sempre sob `AutonomyPolicy` (rascunho + confirmação + prova de escrita).
- Resposta consultiva, nunca moralista, com rótulos separados: FATO / ESTIMATIVA / CENÁRIO / RECOMENDAÇÃO.

## 11. Autoaprendizado

Preserva `advisor_interaction_events` + `user_advisor_topic_affinity` (attention learning) e adiciona **financial profile learning**: fatos derivados deterministicamente (gasto flexível habitual, categorias voláteis, propensão a parcelar, recorrência de merchant, sazonalidade de renda, capacidade de poupar, reação a limites, recuperação após excesso). Nenhuma "personalidade" inventada pela LLM.

## 12. Reuso — sem motor novo redundante

REUSE: `canonicalFacts`, `financialComparison`, `financialPerformance.v2`, `metrics`, `costStructure`, `savingsOpportunities`, `behaviorChange`, `merchantIntelligence`, `spendingRhythm`, `anomalies`, `cardExposure`, `incomeProjection`, `commitmentAgenda`, `debtStatus`, `goalStrategy`, `categoryGoalStrategy`, `performanceSnapshots`, `advisorRelevance`.
EXTEND: `financialEvolution` (passa a delegar as janelas 30/90/180 ao longitudinal), `FinancialContext360` (contexto por capability), `CapabilityRegistry`/`CapabilityRouter`, `DeterministicAnswers`, `ConversationHistory`, `Observability`, `useTransactions`, `invalidation`.
NEW: `longitudinal.ts`, `wealthOpportunity.ts`, `FinancialAnswerContext`, RPC `financial_snapshot_current`.
DEPRECATE: `useAllTransactions()` como dependência padrão de tela; `slice(14_000)` do contexto; invalidação global.

## 13. Capabilities e AgentCore

Capabilities reais (com tool determinística por trás): `financial_performance`, `financial_evolution`, `longitudinal_financial_analysis`, `wealth_opportunity_analysis`, `wealth_scenario`, `financial_plan`, `goal_strategy`.
O `AgentCore`/`CompositeExecutor` compõe: detectar período → fatos longitudinais → excesso recuperável → cenários → patrimônio atual → patrimônio potencial → capacidade sustentável → `goal_strategy` → resposta. A LLM apenas explica.

## 14. Observabilidade

- `agent_runs` ganha breakdown: `routing_ms, history_ms, memory_ms, financial_context_ms, planning_ms, tool_ms, llm_ms, validation_ms, persistence_ms, total_ms` e `tokens_system/tools/memory/history/financial/total`.
- Nova tabela `app_performance_events` (rota, query, duração, linhas, payload, cache hit/miss, snapshot compute ms, render ready ms).
- Alertas internos no painel admin: p90 de latência, tokens excessivos, tool lenta, query grande, cache hit rate baixo.

## 15. Migrations, backfill e testes

Migrations: RPC `financial_snapshot_current` + grants; colunas de breakdown em `agent_runs`; `app_performance_events` (RLS por `auth.uid()`, grants explícitos); `financial_truth_changed` com escopo de período.
Backfill idempotente e em lotes: `financial_daily_facts` (hoje 59 linhas) e fatos mensais para todo o histórico, via `finance-backfill-runner`, com checkpoints em `financial_backfill_checkpoints`.
Testes: fixtures de 100/1.000/5.000/10.000 lançamentos (Home não pode degradar linearmente); paridade App×Edge dos motores; longitudinal com change-point sintético; wealth opportunity com baseline conhecida; invariantes de `adjustment`/transferência/cartão; regressão de verdade financeira (saldo, fatura, patrimônio, categorias, recibos) e testes de latência/tokens do agente para as 3 classes de pergunta.

## 16. Riscos

Divergência App×Edge (mitigado pelo sync obrigatório do finance-core e teste de paridade) · snapshot servido desatualizado (mitigado por `valid_until` + invalidação por escopo + fallback de cálculo) · perda de continuidade conversacional ao cortar histórico (mitigado por resumo semântico + `ContinuationContract` e testes de conversa) · cenário contrafactual soar como culpa (mitigado por baseline própria, rótulos e confiança).

## 17. Aceite

Entrego matriz REQUISITO / ANTES / DEPOIS / STATUS / EVIDÊNCIA com: nº de queries da Home, linhas de transações, payload, cold load, navegação quente, tempo de snapshot; tokens e p50/p90 por rota do agente; e execução real das 7 perguntas exigidas ("estou melhor que no início do ano?", "quando comecei a piorar/melhorar?", "qual comportamento explica?", "quanto poderia ter acumulado?", "quanto consigo guardar por mês?", "plano para R$ 20 mil") mostrando engine, facts, assumptions, confidence e resposta final.

## 18. Ordem única de implementação

1. Observabilidade (breakdown de agente + eventos de app) — sem baseline não há prova.
2. Escopo de transações + colunas enxutas + paginação real nas telas.
3. RPC `financial_snapshot_current` + `useFinancialSnapshot` lendo snapshot.
4. Cache por natureza + invalidação por escopo + realtime granular + prefetch.
5. `FinancialAnswerContext` + contexto por capability + histórico híbrido + rotas determinísticas com template.
6. Backfill de fatos diários/mensais.
7. `longitudinal_intelligence.v1`.
8. `wealth_opportunity.v1` + integração com `goal_strategy`.
9. Capabilities/AgentCore/composição + ações sob AutonomyPolicy.
10. Financial profile learning + reprocessamento incremental.
11. Testes de performance/regressão + matriz de evidências.
