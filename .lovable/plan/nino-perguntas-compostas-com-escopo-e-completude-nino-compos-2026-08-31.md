# Nino: perguntas compostas com escopo e completude (`nino_composite.v1`)

Objetivo: o Nino deixa de responder "uma intenção → uma ferramenta" e passa a montar um **plano analítico**, executar múltiplos motores canônicos em paralelo, preservar o escopo pedido, separar **meta** de **evolução** e só responder quando todos os componentes pedidos estiverem satisfeitos.

## A. Root cause do caso real

Verificado no código:

1. `core/IntentResolver.ts` devolve **uma** intenção com **um** `required_tool`. Para metas: `goals_overview → get_goals_overview` (linhas 130-165). Comparação não entra no conjunto permitido.
2. `agent/tools.ts:1195 get_goals_overview` devolve metas de poupança/doação + `category_goals` derivados de `snap.active_category_goals`, **sem nenhuma comparação temporal** e sem `category_id` nos itens de categoria (usa `goal_id` como `id`). Logo não existe chave para comparar "as mesmas categorias".
3. Comparação vive em outro motor: `agent/engineTools.ts:471 compare_financial_metric`, que só aceita **um** sujeito por chamada (`category_spend` + um `category_id`) e, sem sujeito, cai em `overall` — exatamente a troca de escopo observada ("total geral do período").
4. `core/CompositeExecutor.ts` só dispara quando `ConversationOrchestrator.splitTasks` divide a frase (exige verbo interrogativo em cada lado). A frase real é uma oração longa com "e compare…" e **não** é dividida; mesmo se fosse, cada subtarefa é roteada de forma independente e **perde o escopo** da anterior.
5. Não existe validador de completude: `CompositeExecutor` conta `answered`, mas ninguém verifica "4 metas pedidas × 1 analisada". Daí a pergunta final "quer ver o detalhe de outra categoria?".
6. Não existe camada de interpretação: a distinção meta-estourada × gasto-menor-que-o-mês-anterior nunca é calculada, então sobra para a LLM.

Root cause em uma frase: **a arquitetura tem roteamento de intenção única e escopo implícito; não tem plano analítico, contrato de escopo, composição de motores nem validação de completude.**

## B. Fluxo atual

```text
mensagem
 → ConversationHistory / TurnPlan (período)
 → IntentResolver / CapabilityRouter  (1 intenção → 1 required_tool)
 → DeterministicAnswers | ActionPlanner(LLM) → ToolRuntime (1 tool principal)
 → EvidencePack → TruthValidator (só confere números) → ReplyHumanizer
```

## C. Onde a pergunta se perdeu

| Etapa | Perda |
|---|---|
| IntentResolver | escolheu `goals_overview`, descartou "comparar com mês passado" |
| Router/Planner | sem slot de escopo: "essas mesmas categorias" virou nada |
| Tool única | `get_goals_overview` não compara; `compare_financial_metric` sem sujeito virou total geral |
| Sem validador | resposta parcial (1 de N metas) foi considerada final |
| Sem interpretação | "estourou meta" foi comunicado como piora |

## D. AnalyticalQueryPlanner (novo)

Determinístico primeiro, LLM só como último recurso.

```text
resolveAnalyticalPlan(text, turnPlan, memory) → AnalyticalPlan
```

Etapas: (1) normalização (reusa `normalizeIntentText`); (2) extração de **facetas** por evidência lexical/semântica — `overview`, `attainment`, `comparison`, `aggregate`, `interpretation`, `ranking`, `filter`; (3) extração de **objeto de domínio** (`goals`, `categories`, `cards`, `debts`, `wealth`, `income`); (4) extração de **escopo** e **períodos** (via `periodResolver` já existente, nunca via LLM); (5) mapeamento faceta+domínio → conjunto de engines; (6) `response_depth` derivado da quantidade de facetas.

```ts
type AnalyticalPlan = {
  version: "analytical_plan.v1";
  primary_intent: string;              // ex. goal_performance_analysis
  requested_answers: RequiredAnswer[];
  scope: AnalysisScope;
  periods: { current: Period; comparison: Period | null; methodology: string };
  engines: EngineRef[];                 // executáveis em paralelo
  response_depth: "brief" | "standard" | "analytical";
  resolution: "deterministic" | "llm_assisted";
};
```

Fallback LLM (`llm_assisted`) só produz facetas/domínios/escopo — **nunca** número nem período; validado contra o enum antes de virar plano. Se o circuito de IA estiver fechado, o plano determinístico segue valendo.

## E. Query Requirements

```ts
type RequiredAnswer =
  | "active_goals" | "attainment_per_goal" | "historical_comparison_per_entity"
  | "scoped_aggregate" | "overall_interpretation" | "ranking" | "priority";

type Requirement = { key: RequiredAnswer; cardinality: "single" | "per_entity"; entity_count?: number };
```

Cada requisito é marcado `resolved | partial | unresolved` durante a orquestração; nada é comunicado como final com `partial`/`unresolved` silencioso.

## F. Scope Resolver / ScopePreservationGate

```ts
type AnalysisScope = {
  entity_type: "category" | "merchant" | "account" | "card" | "debt" | "goal" | "global";
  selection: "explicit_ids" | "categories_with_active_goals" | "all" | "inherited";
  entity_ids: string[];
  entity_labels: string[];
  aggregate_scope: "scoped_entities" | "global";
  source: "user_text" | "engine_resolved" | "inherited_from_turn";
  locked: boolean;
};
```

Regras:
- Anáforas (`essas`, `essas mesmas`, `dessas metas`, `nelas`, `dessas despesas`, `só as que…`) → `selection: "inherited"`; o gate resolve a partir do escopo do turno anterior salvo em `ConversationMemory`.
- `locked: true` proíbe qualquer engine de responder com `aggregate_scope: "global"`. Violação = truth gate C reprovado; o orquestrador recalcula o agregado a partir das entidades escopadas em vez de trocar o significado.
- Follow-up que muda só período mantém `entity_ids` e substitui `periods.comparison`.

## G. Contrato `goal_performance_assessment.v1`

Motor determinístico novo, composto (não recalcula gasto):

```ts
{
  formula_version: "goal_performance_assessment.v1",
  period: { current, comparison, methodology },
  freshness: { ledger_version, computed_at, source: "ledger" | "derived_cache", stale: boolean },
  categories: [{
    category_id, category_name,
    goal: { target, actual, delta, delta_pct, status: "achieved" | "missed" | "scheduled" | "paused" },
    historical: { current, previous, delta, delta_pct, trend, confidence },
    interpretation: { state }
  }],
  aggregate: { total_target, current_spend, previous_spend, vs_target, vs_target_pct, vs_previous, vs_previous_pct, scope: "scoped_entities" },
  conclusions: { goal_attainment_summary, behavioral_evolution, strongest_improvement, strongest_deterioration, priority },
  confidence, data_quality, evidence, formula_versions: string[]
}
```

`interpretation.state` ∈ `goal_achieved_and_improved | goal_achieved_but_worsened | goal_missed_but_improved | goal_missed_and_worsened | insufficient_data`.
`trend` ∈ `strongly_improved | improved | stable | worsened | strongly_worsened | insufficient_data` (limiares determinísticos por % e piso de materialidade, reusando o piso já usado em `assess_financial_performance`).

## H. Reuso dos motores existentes

| Necessidade | Fonte canônica reusada |
|---|---|
| metas por categoria | `finance-core/metrics.ts: evaluateCategoryGoal`, `resolveGoalPeriod`, `computeAgentSnapshot.activeCategoryGoals` |
| comparação por categoria | `computeFinancialComparison` (via `engineTools.compare_financial_metric` internals) e `analytics/compare.ts` |
| gasto/estorno/categoria efetiva | `finance-core/facts.ts` (`behavioralMetricAmount`, `buildRefundAttribution`, `effectiveCategoryId`, `isRealMonthlyMovement`) |
| períodos | `analytics/periodResolver.ts`, `analytics/periods.ts` (`comparablePeriods`) |
| proveniência/confiança | `analytics/provenance.ts` |
| metas de poupança/doação | `tools.get_goals_overview` (mantido) |

Nenhuma fórmula nova de gasto. O motor lê o ledger **uma vez** (janela suficiente para os dois períodos) e passa a mesma lista para as duas verdades — garante identidade de categoria idêntica nos dois períodos (truth gate G).

## I. Interpretation Resolver

`core/InterpretationResolver.ts`: recebe as `categories[]` e devolve estado agregado determinístico — `all_goals_met`, `improving_despite_goal_misses`, `regressing_despite_goals_met`, `mixed`, `deteriorating`, `insufficient_data` — mais contagens, maior avanço, maior deterioração e prioridade (categoria que estourou meta **e** piorou vs. histórico). Compartilhado com `financial_life_assessment`.

## J. Truth Gates (verificáveis, em `core/TruthValidator.ts` + novo `core/AnalysisGates.ts`)

A. `goal_missed` não implica `worsened`. B. `goal_achieved` não implica `improved`. C. escopo travado ≠ agregado global. D. `entity_count` analisado < pedido → `overview_incomplete`. E. comparação pedida e ausente → `answer_incomplete`. F. evidência stale crítica → recomputar ou baixar confiança explicitamente. G. mesma identidade canônica de categoria nos dois períodos. H. estorno abate a categoria econômica correta. I. `superseded` fora. J. pagamento de fatura, transferência interna e aporte não são consumo.

## K. Answer Completeness Validator

`core/AnswerCompleteness.ts`: compara `requested_answers` × evidência produzida; devolve `{ required, resolved, missing[], score, status }`. `incomplete` bloqueia a resposta final: o orquestrador (1) tenta completar com os motores faltantes, ou (2) responde declarando explicitamente o que não conseguiu. Proíbe pergunta de continuação (“quer ver outra categoria?”) quando `requested_answers` inclui `per_entity` já satisfeito.

## L. Freshness

Reusa `derived/cache.ts` (`getLedgerVersion`, `financial_derived_cache.ledger_version`). Todo resultado do motor novo carrega `freshness`. Se a fonte derivada tiver `ledger_version` diferente da atual: recomputar do ledger (caminho padrão, já é o que `computeAgentSnapshot` faz), e só servir stale com `confidence: "low"` e nota de metodologia explícita quando o recompute falhar.

## M. Memória / follow-up

`core/ConversationMemory.ts` ganha `last_analysis`: `{ plan_version, primary_intent, scope, periods, entity_states[], created_at }`, com TTL de turno curto. Follow-ups (“e só as que estourei?”, “e comparado com junho?”, “qual melhorou mais?”) reusam `entity_ids` e `entity_states` sem reexecutar motores quando a resposta já está na análise anterior (0 tokens, 0 queries).

## N. Arquivos alterados

- `supabase/functions/_shared/agent/core/IntentResolver.ts` — expõe facetas detectadas ao planner (sem virar lista de frases).
- `.../core/CapabilityRouter.ts` — aceita plano multi-engine em vez de `required_tool` único.
- `.../core/AgentCore.ts` — insere planner + orquestração + completude antes do caminho atual.
- `.../core/CompositeExecutor.ts` — passa a executar `AnalyticalPlan.engines` com escopo compartilhado.
- `.../core/DeterministicAnswers.ts` — renderer do novo motor e `response_depth`.
- `.../core/ConversationMemory.ts`, `.../core/ContinuationContract.ts` — escopo herdado.
- `.../core/TruthValidator.ts`, `.../core/EvidencePack.ts`, `.../core/Observability.ts`, `.../core/FeatureFlags.ts`.
- `.../agent/tools.ts` — `get_goals_overview` passa a expor `category_id` nos itens de categoria; registro da nova ferramenta.
- `.../agent/engineTools.ts` — comparação multi-sujeito interna reaproveitável.

## O. Arquivos novos

`core/AnalyticalQueryPlanner.ts`, `core/ScopeResolver.ts`, `core/AnalysisRequirements.ts`, `core/AnswerCompleteness.ts`, `core/InterpretationResolver.ts`, `core/AnalysisGates.ts`, `core/EvidenceGraph.ts`, `finance-core/goalPerformanceAssessment.ts` (+ espelho gerado em `_shared/finance-core` via `scripts/sync-finance-core.mjs`), `agent/goalPerformanceTool.ts`, `docs/NINO_COMPOSITE_V1.md`, testes.

## P. Migration

Necessária, pequena: inserir os flags novos em `agent_runtime_flags` (chave/valor já existente) e ampliar o payload de telemetria em `agent_turn_events` (colunas JSON já existentes; sem nova tabela). Nenhuma mudança em tabelas financeiras.

## Q. Testes

- Caso real completo: todas as metas, comparação das mesmas categorias, agregado escopado, distinção meta × evolução, conclusão geral; proíbe resposta com 1 categoria, agregado global e pergunta de continuação.
- Meta estourada + gasto −50% → "não atingiu, mas melhorou". Meta atingida + gasto +50% → "atingiu, mas piorou".
- 4 metas, 3 melhoram 1 piora → `improving_despite_goal_misses` + prioridade correta.
- Follow-ups: filtrar estouradas; trocar período mantendo entidades; "qual melhorou mais".
- Gates A–J unitários; completude; stale evidence; planner (composto vs. simples); performance (sem tool explosion).
- Regressões existentes de intenção, áudio, circuito, deterministic-first e snapshots devem continuar verdes.

## R. Telemetria

Por turno: `analytical_plan`, `requested_answers`, `resolved_answers`, `scope`, `engines`, `comparison_period`, `evidence_count`, `completeness_score`, `truth_gate_results`, `data_freshness`, `interpretation_state`, `response_depth`, `final_path`, tokens, latência. Métricas: `composite_query_rate`, `partial_answer_prevented`, `scope_violation_prevented`, `stale_evidence_prevented`, `answer_completeness`, `multi_engine_query_latency`, `goal_performance_assessment_runs`.

## S. Performance esperada

Caso real: 1 leitura de ledger + motores em paralelo, renderer determinístico → **0 tokens**. Perguntas simples inalteradas (caminho atual, cache derivado por `ledger_version`). Síntese LLM só para pedidos abertos, com Evidence Pack compacto (poucos KB) e uma única chamada.

## T. Flags e rollback

`analytical_query_planner_v1`, `goal_performance_assessment_v1`, `scope_preservation_v1`, `answer_completeness_v1`, `interpretation_resolver_v1` — independentes, default off no primeiro deploy, fallback = fluxo atual.

## U. Riscos

1. Planner classificar pergunta simples como composta → mitigado por limiar de facetas + testes de latência.
2. Janela de ledger maior para dois períodos → mitigada por leitura única e cache por `ledger_version`.
3. Completude bloquear resposta e gerar silêncio → o validador sempre tem saída honesta declarada.
4. Escopo herdado errado em conversa longa → TTL curto e exigência de anáfora explícita.
5. Divergência App/Edge no motor novo → obrigatório passar pelo `finance-core` sincronizado.

## V. Checklist de aceite

Decomposição correta · todas as partes respondidas · escopo nunca trocado silenciosamente · meta ≠ evolução · comparação por motor canônico · zero matemática da LLM · stale nunca assertivo · resposta humana e interpretativa · simples continua rápida · sem explosão de tool calls · follow-ups preservam entidade e período · regressão do caso real · nada específico por usuário · válido para 100% dos usuários · nenhuma regressão recente.

## Auditoria prévia (item 23)

Antes de codar: varredura anonimizada de `agent_runs`/`agent_turn_events` recentes classificando `partial_answer`, `scope_loss`, `missing_comparison`, `missing_entity`, `wrong_aggregation`, `shallow_interpretation`, `context_loss`, `unnecessary_clarification` — os casos encontrados entram na suíte de regressão.

Nada será publicado sem autorização explícita.
