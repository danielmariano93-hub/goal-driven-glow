# Fase 3 — Agent Core Inteligente: Memória, Perfil, Insights e Aprendizado

Entrega única, sobre a arquitetura das Fases 1 e 2. Zero regressão nos 361 testes atuais. Todo módulo novo pluga no `ContextPipeline`, `PolicyEngine`, `ActionPlanner` e `Observability` existentes — nenhuma duplicação de responsabilidade.

## 1. Memória Inteligente (`core/MemoryStore.ts`)
Camada persistente de fatos aprendidos sobre o usuário.

**Migration `agent_memory`**:
- `id, user_id, kind, key, value jsonb, confidence numeric, source (user|inferred|correction), last_used_at, use_count, expires_at, created_at, updated_at`.
- `kind ∈ {favorite_category, frequent_merchant, recurring_bill, preferred_card, favorite_investment, goal, spending_pattern, habit, language, alias, correction, response_preference, context}`.
- Unique `(user_id, kind, key)`; RLS por `user_id`; GRANTs `authenticated`+`service_role`; índice `(user_id, kind, last_used_at desc)`.

**API**: `remember`, `recall(kind?, key?, limit)`, `forget`, `consolidate` (merge de duplicatas via key normalizada), `decay` (reduz `confidence` de fatos não usados; descarta abaixo de threshold; respeita `expires_at`). Consolidação e decay rodam em cron diário via `agent-memory-maintain`.

Integra no `ContextPipeline.memory(kinds[])` com cache por turno. Nunca sobrescreve fato com `source=correction` por inferência.

## 2. Perfil Financeiro Dinâmico (`core/UserProfile.ts` + tabela `user_profiles_snapshot`)
Snapshot materializado, recalculado sob demanda com TTL 6h ou após import/edição relevante.

Campos: `estimated_income, spending_pattern jsonb, seasonality jsonb, savings_capacity, net_worth, risk_level, behavior_tags[], monthly_evolution jsonb, top_categories jsonb, indicators jsonb, computed_at`.

`buildProfile(user_id)` usa `computeMonthlyTotals`, `investment_movements`, `debts`, `goals` — reaproveita engine existente. Exposto via `ContextPipeline.profile()` (lazy). Todas as tools de análise passam a receber `profile` como contexto opcional.

## 3. Motor de Insights (`core/InsightsEngine.ts`)
Consolida `insights-generate` existente + novos detectores puros e testáveis:
- `spike_detector`, `duplicate_expense`, `underused_subscription`, `above_average`, `growing_category`, `saving_opportunity`, `goal_at_risk`, `forgotten_bill`, `investment_opportunity`, `concentration_risk`.

Cada detector: `(profile, snapshot360, memory) → Insight[]` com `{ id, kind, severity, score, title, body, action?, evidence }`. `rank()` prioriza por `severity*score*recency` e aplica cooldown (via memória) para não repetir. Persistidos em `user_insights` (já existe) com `kind` estendido. Edge Function `insights-generate` chama o engine unificado. Uma tool `list_relevant_insights` disponível ao agente.

## 4. Planejador Financeiro (`core/FinancialPlanner.ts`)
Constrói planos completos a partir de objetivo declarado.

Input: `{ objective, target_amount?, deadline?, constraints? }`.
Output: `{ goal, milestones[], schedule, projections, impact, recommendations[] }` — usa `profile.savings_capacity`, `debts`, `goals` existentes.

Tools novas: `create_financial_plan_draft` (rascunho confirmável), `simulate_plan_impact`. Planos aprovados viram `goals` + `recurring_rules` reais.

## 5. Agente Proativo (`core/ProactiveEngine.ts` + cron `agent-proactive-tick`)
Varre usuários ativos periodicamente e cria `pending_proactive_suggestions` (nova tabela) — não envia mensagens ainda; apenas prepara.

Detectores: vencimentos próximos, metas em risco, desvios de padrão, recorrências prestes a bater, oportunidades de economia.

Cada sugestão tem `channel_ready ∈ {app,whatsapp,both}`, `expires_at`, `dedup_key`. `NotificationDispatcher` (stub) fica pronto para ativação futura sem refatoração. Home consome sugestões via query existente.

## 6. Personalização (`core/PersonalizationEngine.ts` + tabela `user_ai_preferences`)
Campos: `tone, verbosity, explanation_style, example_style, suggestion_frequency, technical_level, updated_at`.

Aplicado no `ResponseGenerator` como sufixo do system prompt. `PersonalizationEngine.infer()` deriva ajustes a partir de correções e memória (`response_preference`). Persistência via API do app + inferência automática.

## 7. Admin IA
Novas rotas em `src/pages/admin/`:
- `IAMemoria.tsx` — busca usuário, lista memória por kind, permite `forget`/`consolidate`/`reprocess`.
- `IAPerfil.tsx` — perfil consolidado com evolução mensal.
- `IAInsights.tsx` — insights gerados por usuário, filtros por severidade/kind.
- `IADecisoes.tsx` — leitura de `agent_decisions` + `agent_runs` com drill-down.
- `IASessoes.tsx` — inspecionar `agent_sessions` (state, última atividade).

Edge Function `admin-ai-inspect` (verifica `platform_admin`, expõe leituras + ações). Reutiliza `AdminLayout`, `StatusChip`.

## 8. Simulador expandido (`src/pages/admin/AgenteSimulador.tsx`)
Ao rodar um turno, exibe painéis colapsáveis:
- Memória carregada (kinds + valores).
- Contexto enviado ao LLM (system+history+tools).
- Decisão do PolicyEngine.
- Plano do ActionPlanner (`Step[]` + dedup).
- Tool calls executadas com args/result/duração.
- Validações do ResponseValidator.
- Métricas por etapa (`TurnMetrics`) + custo estimado.

Backend: `agent-run` retorna `debug` payload quando `X-Debug: 1` + admin.

## 9. Aprendizado Contínuo (`core/LearningLoop.ts`)
Hook pós-turno no `AgentCore.handleTurn` (best-effort, `guard`ed):
- Correção detectada (usuário edita item recém-criado, cancela draft, diz "não era isso") → grava `memory.correction` + ajusta `merchant_aliases`/categorias.
- Confirmação → reforça `confidence` dos fatos usados no turno.
- Recusa → decrementa e cria cooldown.
- Padrões (mesmo merchant + categoria 3+ vezes) → promove a `frequent_merchant`.

Alimenta `PersonalizationEngine.infer` e `MemoryStore.consolidate`.

## 10. Configurações IA (`user_ai_preferences` + `agent_settings` extension)
Colunas novas em `agent_settings` (global admin): `default_proactivity, default_retention_days, default_technical_level`.
Tabela `user_ai_preferences` (item 6) cobre por-usuário. UI mínima em `Perfil.tsx` (tom + frequência de sugestões + nível técnico). Resto exposto via API para ativação futura.

## 11. Refatoração final
- Remove código morto restante em `orchestrator.ts` e `insights-generate` legado.
- Consolida detectores dispersos (`facts.ts`, `insights/fallbacks.ts`) sob `InsightsEngine`.
- Padroniza tipos em `core/index.ts`: `Memory`, `UserProfile`, `Insight`, `FinancialPlan`, `ProactiveSuggestion`, `Preferences`.
- Atualiza `docs/` com o mapa arquitetural final (Fases 1+2+3).

## Restrições
- Comportamento externo idêntico: WhatsApp, App, Simulador, Admin, Prompt Versioning permanecem funcionais.
- Zero mudança em RLS existente, RPCs financeiras, contratos HTTP atuais.
- Novos módulos reusam `ContextPipeline`, `PolicyEngine`, `ActionPlanner`, `ToolRuntime`, `ResponseValidator`, `Observability`, `DecisionLogger`.

## Migrations
1. `agent_memory` (+ índices, RLS, GRANTs).
2. `user_profiles_snapshot`.
3. `user_ai_preferences`.
4. `pending_proactive_suggestions`.
5. `agent_settings` — colunas de defaults.
6. `user_insights` — colunas `severity, score, evidence jsonb, dedup_key` se ainda ausentes.

## Testes (`src/test/`)
- `agent-memory-store.test.ts` — remember/recall/consolidate/decay.
- `agent-user-profile.test.ts` — cálculo determinístico.
- `agent-insights-engine.test.ts` — cada detector + ranking + cooldown.
- `agent-financial-planner.test.ts` — plano end-to-end.
- `agent-proactive-engine.test.ts` — geração e dedup.
- `agent-personalization.test.ts` — infer + aplicação no prompt.
- `agent-learning-loop.test.ts` — correções e reforços.
- `agent-core-phase3-parity.test.ts` — paridade App↔WhatsApp com memória ativa.
- `admin-ai-inspect.test.ts` — controle de acesso.

Meta: 361 atuais + ~40 novos, todos verdes. `bunx vitest run` + `tsgo` + build.

## Arquivos

**Novos (core)**
`core/MemoryStore.ts`, `core/UserProfile.ts`, `core/InsightsEngine.ts`, `core/FinancialPlanner.ts`, `core/ProactiveEngine.ts`, `core/PersonalizationEngine.ts`, `core/LearningLoop.ts`, `core/NotificationDispatcher.ts` (stub).

**Novos (edge)**
`supabase/functions/agent-memory-maintain/index.ts`, `supabase/functions/agent-proactive-tick/index.ts`, `supabase/functions/admin-ai-inspect/index.ts`.

**Novos (frontend)**
`src/pages/admin/IAMemoria.tsx`, `IAPerfil.tsx`, `IAInsights.tsx`, `IADecisoes.tsx`, `IASessoes.tsx`.

**Editados**
`core/AgentCore.ts` (hook LearningLoop + Preferences), `core/ContextPipeline.ts` (memory + profile), `core/ResponseGenerator.ts` (personalização), `core/ActionPlanner.ts` (tools novas), `core/index.ts` (barrel), `insights-generate/index.ts` (delegar), `AgenteSimulador.tsx` (painéis debug), `agent-run/index.ts` (debug payload), `Perfil.tsx` (preferências IA), `AdminLayout.tsx` (navegação IA), `App.tsx` (rotas admin), `orchestrator.ts` (cleanup final), `docs/` (arquitetura).

## Deploy final
Migrations acima → deploy `agent-chat`, `agent-run`, `whatsapp-webhook`, `insights-generate`, `agent-memory-maintain`, `agent-proactive-tick`, `admin-ai-inspect` → cron para as duas *-tick → suíte completa + tsgo + build → publica frontend.

## Fora de escopo
Envio real de notificações proativas (dispatcher fica plugável), UI completa de todas as preferências avançadas (infra pronta, UI mínima entregue), novos modelos LLM.
