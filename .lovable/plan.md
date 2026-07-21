# Fase 2 — Agent Core: Policy, Planner, Validator, Observabilidade

Entrega única. Preserva arquitetura da Fase 1 (`AgentCore.handleTurn` + adapters + módulos em `_shared/agent/core/`). Reaproveita todo o código atual; nada de duplicação nem mudança de comportamento externo. Aplicado em um único patch, seguido de deploy e suíte completa.

## 1. Policy Engine completo (`core/PolicyEngine.ts`)
Único ponto de decisão. Expande o atual (hoje só confirm/cancel) para retornar uma `Decision` explícita a cada turno:
- `direct_reply` | `run_tools` | `ask_confirmation` | `block` | `need_context` | `reuse_context` | `create_draft` | `cancel` | `interrupt` | `fallback`.
Entradas: intenção roteada, snapshot do `StateManager`, `PendingConfirmations`, guardrails (ownership, limite de passos, plausibilidade temporal já existente). Saída consumida por `AgentCore` — nenhum `if` de negócio permanece fora do PolicyEngine.

## 2. Action Planner (`core/ActionPlanner.ts`)
Reescrito para planejar antes de executar:
- Interpreta intenção + slots do `IntentRouter`.
- Decompõe em `Step[]` (tool calls ordenadas + dependências).
- Deduplica chamadas (chave = tool_name+args normalizados) e reusa resultados via `ContextPipeline`.
- Escolhe fast-path determinístico quando plano é trivial (evita LLM).
- Só invoca `ToolRuntime` — nenhuma ferramenta é chamada diretamente em outro lugar.

## 3. Response Validator (`core/ResponseValidator.ts`)
Expande além do trim/cap atual:
- Valida presença/tipo de campos, JSON de tool results, coerência com estado (ex.: recibo sem draft), tool calls inválidas, respostas vazias, confirmações inconsistentes.
- Ações: `accept` | `regenerate` (uma tentativa) | `fallback_deterministic`.

## 4. Decision Logger (`core/DecisionLogger.ts` + tabela `agent_decisions`)
Migration nova cria `public.agent_decisions(run_id, step_index, intent, policy_decision, planned_steps jsonb, tool_calls jsonb, validations jsonb, fallback bool, error text, duration_ms, created_at)` com RLS (service_role total, authenticated select do próprio user via join em agent_runs). GRANTs completos. Logger grava um registro por turno permitindo reconstruir o fluxo.

## 5. Tool Runtime consolidado (`core/ToolRuntime.ts`)
Wrapper único com contrato uniforme `{ ok, result, error, duration_ms, retries }`:
- timeout (por tool, default 10s), retry exponencial em erros transitórios, isolamento (try/catch por call), rollback via callback opcional declarado na tool, métricas emitidas ao Observability.

## 6. Context Pipeline (`core/ContextPipeline.ts`)
Fachada única. Consolida `FinancialContext360`, `StateManager`, `ConversationHistory`, `PendingConfirmations`. Cache por turno (memo por chave). Nenhuma tool/planner acessa Supabase direto para contexto — só através daqui.

## 7. Error Recovery (`core/ErrorRecovery.ts`)
Centraliza: retry inteligente (classifica erro → retryable/não), fallback determinístico via `DeterministicFallback`, recuperação de contexto (reload sob demanda), mensagens amigáveis reutilizando `FRIENDLY_ORCHESTRATOR_ERROR` e templates de `messageTemplates.ts`.

## 8. Observabilidade (`core/Observability.ts`)
Coleta por turno: tempo por etapa (session/intent/policy/plan/tools/validate/persist), tempo por tool, contagem de tool calls, taxa fallback/confirmação/erro, tokens in/out (já disponíveis em `agent_runs`), custo estimado via `ai_model_prices` (se existir; senão null). Persiste em `agent_runs` (colunas já existentes) + `agent_decisions`.

## 9. Performance
- Cache de contexto por turno no `ContextPipeline`.
- Deduplicação de tool calls no `ActionPlanner`.
- Lazy load do `FinancialContext360` (só o slice pedido pela intenção).
- Reuso de `loadActivePrompt` cached em memória por 60s (Edge Function scope).
- Evita chamada LLM quando fast-path determinístico resolve.

## 10. Refatoração final
- Remove código morto residual de `orchestrator.ts` (mantém apenas shim mínimo).
- Consolida imports via `core/index.ts`.
- Padroniza nomenclatura (`Decision`, `Plan`, `Step`, `ToolResult`, `TurnMetrics`).
- Move helpers órfãos para módulos apropriados; deleta os sem uso.

## Restrições e compatibilidade
- Comportamento externo idêntico: WhatsApp, App, Simulador, Admin, Prompt Versioning, Confirmações e Analytics continuam funcionando com os mesmos contratos HTTP/DB.
- Nenhuma mudança em prompts, tools de negócio, RLS existente, RPCs financeiras, UI.
- Única migration nova: `agent_decisions` (+ índice + RLS + GRANT authenticated/service_role).

## Testes
Novos em `src/test/`:
- `agent-policy-engine.test.ts` — matriz de decisões.
- `agent-action-planner.test.ts` — decomposição, dedupe, reuse.
- `agent-response-validator.test.ts` — accept/regenerate/fallback.
- `agent-tool-runtime.test.ts` — timeout, retry, rollback.
- `agent-context-pipeline.test.ts` — cache e lazy load.
- `agent-error-recovery.test.ts` — classificação e mensagens.
- `agent-decision-logger.test.ts` — payload persistido.
- `agent-core-phase2-parity.test.ts` — paridade App↔WhatsApp para gasto, confirmação, cancelamento, consulta, analytics, ajuda.
Meta: 0 regressões nos 347 existentes + todos os novos verdes. Roda `bunx vitest run` e `tsgo`.

## Arquivos

**Novos**
- `supabase/functions/_shared/agent/core/ContextPipeline.ts`
- `supabase/functions/_shared/agent/core/DecisionLogger.ts`
- `supabase/functions/_shared/agent/core/ErrorRecovery.ts`
- `supabase/functions/_shared/agent/core/Observability.ts`
- `supabase/migrations/<ts>_agent_decisions.sql`
- 8 arquivos de teste acima.

**Editados**
- `core/PolicyEngine.ts`, `core/ActionPlanner.ts`, `core/ResponseValidator.ts`, `core/ToolRuntime.ts`
- `core/AgentCore.ts` (nova composição do pipeline)
- `core/index.ts` (barrel)
- `core/adapters/WhatsAppAdapter.ts`, `core/adapters/AppAdapter.ts` (apenas se contrato de retorno mudar)
- `_shared/agent/orchestrator.ts` (limpeza do shim)

## Deploy final
- Aplica migration `agent_decisions`.
- Deploy: `whatsapp-webhook`, `agent-chat`, `agent-run`.
- Roda suíte + typecheck + build.
- Relatório: arquivos alterados, testes rodados, total aprovado, bloqueios (se houver).

## Fora de escopo
Novos modelos, novas tools de negócio, mudanças de UI, novas telas de admin. Fica para Fase 3.
