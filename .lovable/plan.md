## Fase 1 — Conclusão do Agent Core unificado

Objetivo: eliminar a duplicação entre `agent-chat` (App) e `whatsapp-webhook` (WhatsApp), colocando ambos atrás de um único `AgentCore.handleTurn`, com SessionManager, IntentRouter, StateManager, FinancialContext360 e Channel Adapters compartilhados. Sem mudar comportamento externo.

### Pipeline final (idêntico nos dois canais)

```text
Channel Adapter (in)
  → SessionManager (resolve/renew session + expiração)
  → IntentRouter (classifica intenção determinística)
  → StateManager (carrega estado estruturado da conversa)
  → FinancialContext360 (snapshot: contas, cartões, metas, lançamentos, recorrências, indicadores)
  → Policy Engine (confirmações pendentes, cancelamentos, guardrails)
  → Action Planner (LLM + tools ou fast-path determinístico)
  → Tool Runtime (loop de tools já existente)
  → Response Generator (mensagem + recibo)
  → Response Validator (sanitização, tamanho, PII)
  → Persistência (conversation_messages, agent_runs, session_state, outbound)
Channel Adapter (out)
```

### Etapas de execução (subetapas 12.3 → 12.9)

**12.3 — `AgentCore.handleTurn`**
- Criar `supabase/functions/_shared/agent/core/AgentCore.ts` exportando `handleTurn(input, deps)`.
- Input: `{ user_id, conversation_id, inbound_message_id, text, channel: "whatsapp" | "app", to_phone? }`.
- Compor os módulos abaixo em uma única função; retornar `{ reply, receipt?, toolCalls, runId }`.
- Reaproveitar integralmente o corpo atual de `runOrchestrator` como implementação inicial, apenas fatiado por seção.

**12.4 — Módulos do Core (arquivos novos, extraídos sem mudar comportamento)**
- `core/SessionManager.ts`: resolve `session_id` por `(user_id, channel)`, aplica TTL (padrão 30 min de inatividade) e limpa contexto expirado. Persistência: nova tabela `agent_sessions(id, user_id, channel, conversation_id, last_activity_at, expires_at, state jsonb)` (migration incluída). Sem GRANTS para anon.
- `core/IntentRouter.ts`: move a classificação determinística hoje espalhada em `parser.ts` + fast-paths do `agent-chat` (cartões, analytics, confirmação, cancelamento, ajuda). Retorna `{ intent, confidence, slots }`.
- `core/StateManager.ts`: leitura/escrita do `state jsonb` da sessão (draft atual, slots coletados, última tool, cursor de fluxo). API `get/patch/clear`.
- `core/FinancialContext360.ts`: monta snapshot sob demanda por intenção (evita puxar tudo sempre). Usa loaders já existentes em `_shared/engine/facts.ts` e `tools.ts`.
- `core/PolicyEngine.ts`: encapsula as regras hoje inline no orchestrator — interceptação de confirmação/cancelamento via `PendingConfirmations`, ownership, limite de passos.
- `core/ActionPlanner.ts` + `core/ToolRuntime.ts`: wrappers finos sobre o loop LLM+tools atual (`llm.ts` + `tools.ts`); nenhuma mudança de prompt ou de contrato de tool.
- `core/ResponseGenerator.ts` + `core/ResponseValidator.ts`: extraem a montagem final de texto/recibo e a sanitização/truncagem já existentes.

**12.5 — Channel Adapters**
- `core/adapters/WhatsAppAdapter.ts`: mapeia payload WAHA já normalizado → `AgentCore.handleTurn` input; escreve saída via `OutboundQueue.enqueueReply` + `triggerDispatcher`.
- `core/adapters/AppAdapter.ts`: mapeia request do `agent-chat` → input; devolve resposta síncrona no HTTP.
- Ambos ficam com <80 linhas: só tradução de entrada/saída e autenticação.

**12.6 — Corte do WhatsApp**
- `whatsapp-webhook/index.ts`: substituir a chamada a `runOrchestrator` por `WhatsAppAdapter.handle(...)`. Manter dedupe, ACK, media fallback, vinculação e `EdgeRuntime.waitUntil` intactos.

**12.7 — Corte do App**
- `agent-chat/index.ts`: remover fast-paths, loops de tools e montagem de histórico duplicados; passar a chamar `AppAdapter.handle(...)`. Manter contrato HTTP/response inalterado para o frontend (`AssessorPanel` não muda).

**12.8 — Limpeza controlada**
- `_shared/agent/orchestrator.ts` vira um shim fino que chama `AgentCore.handleTurn` com `channel: "whatsapp"` para preservar `agent-run` e testes atuais; funções auxiliares já reexportadas do core permanecem.
- Remover código morto em `agent-chat` (apenas o que ficou sem referência).

**12.9 — Testes de paridade**
- Novo `src/test/agent-core-parity.test.ts`: para um conjunto de mensagens (gasto simples, confirmação, cancelamento, consulta de saldo, analytics, ajuda), roda `AgentCore.handleTurn` uma vez como `channel: "app"` e outra como `channel: "whatsapp"` com mocks de service, e verifica: mesmas tools chamadas, mesmo texto final (mod. saudação de canal), mesmo estado persistido.
- Rodar suíte completa (`bunx vitest run`) e `tsgo` — meta: 0 regressões nos 339 testes existentes.

### Regras não-negociáveis
- Sem alterar prompts, tools, schemas de banco de negócio, RLS, RPCs financeiras ou UI.
- Nenhuma mudança em `pending_confirmations`, `outbound_messages`, `conversation_messages`, `agent_runs`.
- Migration nova só cria `agent_sessions` (+ índice + RLS + GRANTs para `authenticated`/`service_role`).
- Toda extração é *move + reexport*: se um teste quebrar, o move está errado.

### Arquivos previstos

Novos:
- `supabase/functions/_shared/agent/core/AgentCore.ts`
- `supabase/functions/_shared/agent/core/SessionManager.ts`
- `supabase/functions/_shared/agent/core/IntentRouter.ts`
- `supabase/functions/_shared/agent/core/StateManager.ts`
- `supabase/functions/_shared/agent/core/FinancialContext360.ts`
- `supabase/functions/_shared/agent/core/PolicyEngine.ts`
- `supabase/functions/_shared/agent/core/ActionPlanner.ts`
- `supabase/functions/_shared/agent/core/ToolRuntime.ts`
- `supabase/functions/_shared/agent/core/ResponseGenerator.ts`
- `supabase/functions/_shared/agent/core/ResponseValidator.ts`
- `supabase/functions/_shared/agent/core/adapters/WhatsAppAdapter.ts`
- `supabase/functions/_shared/agent/core/adapters/AppAdapter.ts`
- `supabase/migrations/<timestamp>_agent_sessions.sql`
- `src/test/agent-core-parity.test.ts`

Editados:
- `supabase/functions/_shared/agent/orchestrator.ts` (vira shim)
- `supabase/functions/_shared/agent/core/index.ts` (barrel expandido)
- `supabase/functions/whatsapp-webhook/index.ts` (usa WhatsAppAdapter)
- `supabase/functions/agent-chat/index.ts` (usa AppAdapter; remove duplicação)

### Deploy ao final
- Deploy: `whatsapp-webhook`, `agent-chat`, `agent-run`.
- Aplicar migration `agent_sessions`.
- Rodar suíte + typecheck + build.
- Entregar checklist item-a-item com arquivos alterados.

### Fora de escopo desta fase
- Reescrita de prompts, novo modelo, novas tools, novas telas, mudanças em recibos ou em fluxos financeiros. Ficam para Fase 2.
