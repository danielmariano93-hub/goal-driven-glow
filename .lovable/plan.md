
# Plano — Fase 1 do Agent Core unificado

Escopo estrito: infraestrutura. Nenhum comportamento funcional muda nesta fase.
Nada de novos recursos, novo LLM, novo prompt, novo painel admin, novo RAG, MCP,
Policy Engine, Response Validator, multiagente, canary. Não implementar agora —
este documento planeja a implementação futura.

---

## 1. Resumo executivo

**Como o agente funciona hoje.** Existem dois pontos de entrada:
- `supabase/functions/agent-chat/index.ts` (441 linhas), invocada pelo App via
  `supabase.functions.invoke("agent-chat", …)` a partir de
  `src/components/assessor/AssessorPanel.tsx`.
- `supabase/functions/whatsapp-webhook/index.ts` (429 linhas), que recebe WAHA,
  autentica, resolve vínculo, cria conversa e chama
  `runOrchestrator` de `supabase/functions/_shared/agent/orchestrator.ts`
  (327 linhas) via `EdgeRuntime.waitUntil`.

Ambos convergem em `runAgentTurn` (`_shared/agent/llm.ts`) usando o mesmo
conjunto de tools (`_shared/agent/tools.ts`), o mesmo `loadActivePrompt`
(`_shared/agent/prompt.ts`), o mesmo `interpret` (`_shared/agent/parser.ts`),
e escrevem em `agent_runs` / `agent_tool_calls`. As RPCs
`agent_upsert_draft`, `agent_execute_confirmation` e o registro de
`pending_confirmations` já são o "estado de confirmação" persistente,
compartilhado.

**Principal problema arquitetural.** A camada acima do runtime está duplicada:
`agent-chat` e `orchestrator` reimplementam lado a lado a mesma sequência
(interceptar CONFIRMAR/CANCELAR → carregar histórico → runAgentTurn →
persistir run/tool_calls → registrar mensagens). Elas divergem em detalhes
não intencionais:

- App: fast-path de analytics, fast-path de despesa em cartão, anti-loop
  guard, buildReceipt com "Gasto"/"no cartão".
- WhatsApp: dedupe por `inbound_message_id`, fallback determinístico
  completo (`fallbackTurn`), enqueue em `outbound_messages` com
  `idempotency_key`, buildReceipt com "Despesa registrada".

Ou seja, o mesmo usuário obtém respostas semanticamente iguais mas
literalmente diferentes conforme o canal, e novas melhorias precisam ser
aplicadas duas vezes com risco de esquecer uma. O "estado operacional"
(intenção corrente, dados já coletados numa conversa multi-turn) não é
persistido em lugar nenhum — depende de o modelo reler `conversation_messages`
a cada turno e do fast-path olhar o último `role:"user"` do histórico.

**Arquitetura recomendada.** Extrair uma camada `AgentCore` compartilhada em
`_shared/agent/core/` responsável por: interceptação de confirm/cancel,
carregamento canônico de histórico, roteamento de intenção, montagem de
contexto financeiro sob demanda, chamada do `runAgentTurn` já existente,
persistência de run/tool_calls e produção da mensagem de saída. `agent-chat`
e `whatsapp-webhook` viram Channel Adapters finos que apenas: autenticam a
entrada, normalizam a mensagem, chamam `AgentCore.handleTurn(...)` e
entregam a saída pelo transporte do próprio canal (JSON HTTP no App;
`outbound_messages` + dispatcher no WhatsApp).

**Benefício desta fase.** Menos código; comportamento consistente entre
canais; base clara para a Fase 2 evoluir estado, intenção e contexto sem
tocar em tools, RPCs, segurança, prompt, simulador ou telemetria.

---

## 2. Diagnóstico da arquitetura atual (fluxo real)

```text
App (AssessorPanel)                          WhatsApp (WAHA)
    │ POST /agent-chat                          │ POST /whatsapp-webhook
    ▼                                           ▼
[agent-chat/index.ts]                       [whatsapp-webhook/index.ts]
  auth (JWT do user)                          verifyWebhookSecret + dedupe
  rate limit                                  ACK path (curto)
  get/create conv (source='app')              extractLinkCode (VINCULAR)
  insert conversation_messages (inbound)      resolve whatsapp_links → user
  interpret() confirm/cancel? ──┐             ensureConversation(user,phone)
  fast-path analytics?          │             insert conversation_messages (inbound)
  fast-path card expense?       │             media? → fallback link Assessor
  runAgentTurn(...) ────────────┤             EdgeRuntime.waitUntil(
  anti-loop guard               │                runOrchestrator(...))
  findPending → return          │
  agent_runs / agent_tool_calls │             [orchestrator.ts]
  insert conversation_messages  │               dedupe(inbound_message_id)
  (outbound)                    │               interpret() confirm/cancel?
  ◄──────────────────────────── ┘                 └─ agent_execute_confirmation
  return { reply, pending, report }               loadActivePrompt
                                                  load history (conversation_messages)
                                                  runAgentTurn(...)  ◄── mesmas tools
                                                  fallbackTurn(...) se LLM off/erro
                                                  agent_runs / agent_tool_calls
                                                  enqueueReply → outbound_messages
                                                  triggerDispatcher (whatsapp-send)
                                                RETURN 200 rápido
```

Camada compartilhada de fato hoje:
`_shared/agent/{llm,tools,prompt,parser,resolvers,extract,messageTemplates}.ts`
e `_shared/engine/facts.ts`. RPCs SQL:
`agent_upsert_draft`, `agent_execute_confirmation`, além das tabelas
`conversations`, `conversation_messages`, `pending_confirmations`,
`agent_prompt_versions`, `agent_runs`, `agent_tool_calls`,
`outbound_messages`, `inbound_messages`, `whatsapp_links`.

---

## 3. Inventário do que já existe (relevante para esta fase)

| Componente | Arquivo | Responsabilidade | Consumido por | Preservar? | Alterar? |
|---|---|---|---|---|---|
| Ponto de entrada App | `supabase/functions/agent-chat/index.ts` | HTTP+auth+conv+runtime+telemetria | `AssessorPanel.tsx` | Sim | Reduzir a Channel Adapter |
| Ponto de entrada WA | `supabase/functions/whatsapp-webhook/index.ts` | Webhook+dedupe+link+conv+dispatch | WAHA | Sim | Manter recepção; delegar runtime a AgentCore |
| Orquestrador atual | `supabase/functions/_shared/agent/orchestrator.ts` | Loop confirm/LLM/fallback + persistência para WA | webhook, agent-run | Sim (renomear para AgentCore) | Refatorar sem mudar semântica |
| Simulador | `supabase/functions/agent-run/index.ts` | Chama `runOrchestrator` com source=simulator | painel admin | Sim | Passar a chamar AgentCore com o mesmo contrato |
| Runtime LLM | `_shared/agent/llm.ts` | `runAgentTurn` + `temporalSystemContext` | ambos | Sim | Não tocar |
| Tools | `_shared/agent/tools.ts` (747 linhas) | Draft/Query tools + JSON schema | ambos | Sim | Não tocar |
| Parser determinístico | `_shared/agent/parser.ts` | `interpret`, `resolveOccurredAt` | ambos | Sim | Não tocar |
| Resolvers | `_shared/agent/resolvers.ts` | Entidades por texto | tools | Sim | Não tocar |
| Extract spans | `_shared/agent/extract.ts` | Fast-path amount/card/date | agent-chat | Sim | Mover uso para AgentCore/Intent Router |
| Prompt loader | `_shared/agent/prompt.ts` | Carrega `agent_prompt_versions` ativo | ambos | Sim | Não tocar |
| RPCs de confirmação | migração `20260715232850_*` | `agent_upsert_draft`, `agent_execute_confirmation` | ambos | Sim | Não tocar |
| Estado de confirmação | `pending_confirmations` (unique parcial por conv) | 1 rascunho pendente por conversa | ambos | Sim | Não tocar |
| Histórico | `conversations`, `conversation_messages` | Turnos por conversa | ambos | Sim | Adicionar leitor canônico (não alterar schema) |
| Isolamento WA | UNIQUE `(user_id, phone_e164)` (mig. `20260718205818`) | 1 conv por (user,phone) | webhook | Sim | Reaproveitar |
| Telemetria | `agent_runs`, `agent_tool_calls` | Steps/tokens/latência/tool logs | ambos | Sim | Escrever pelo AgentCore |
| UI Assessor | `src/components/assessor/AssessorPanel.tsx` | Chat App | usuário | Sim | Sem mudança de UI |
| Contexto app | `src/context/AssessorContext.tsx`, `src/pages/Assessor.tsx` | Painel único global | App | Sim | Sem mudança |

---

## 4. Problemas reais encontrados (com evidência)

Cada item cita arquivo e trecho verificado neste turno.

**P1 — Duplicação da camada acima do runtime.**
Evidência: `agent-chat/index.ts:81-164` (short-circuit confirm/cancel + insert
inbound/outbound + `agent_execute_confirmation`) e
`orchestrator.ts:190-223` fazem a mesma sequência com pequenas divergências.
`agent-chat/index.ts:184-285` e `orchestrator.ts:225-322` inserem/atualizam
`agent_runs` e `agent_tool_calls` com colunas iguais e formatos ligeiramente
diferentes (App marca `path:"llm"` fixo; WA distingue `llm` vs
`deterministic_fallback`). Impacto: qualquer melhoria (ex.: novo passo,
novo campo em telemetria) tem de ser aplicada duas vezes; recibos e
mensagens divergem entre canais. Severidade: alta. Recomendação: extrair
AgentCore único.

**P2 — Recibos e textos divergem entre canais.**
Evidência: `orchestrator.ts:96-106` retorna "Despesa registrada"; 
`agent-chat/index.ts:298-310` retorna "Gasto registrado no cartão".
Impacto: experiência inconsistente. Severidade: média. Recomendação:
centralizar `buildReceipt` no AgentCore.

**P3 — Fast-paths existem só no App.**
Evidência: `agent-chat/index.ts:193-230, 336-363, 365-441` implementam
`isAnalyticsRequest`, `analyticsArgs`, `tryFastPathCardExpense`,
`SINGLE_CARD_HINT`. `orchestrator.ts` não tem equivalente — no WhatsApp o
mesmo enunciado depende do modelo. Impacto: mesmo pedido do usuário
("gastei 50 no cartão") tem caminhos diferentes por canal. Severidade:
média. Recomendação: mover fast-paths para um Intent Router compartilhado
como pré-passo opcional ao runtime.

**P4 — Estado operacional inferido do texto.**
Evidência: `agent-chat/index.ts:365-410` (`tryFastPathCardExpense`) lê
`[...history].reverse().find(h => h.role === "user")` para completar um
turno anterior. `orchestrator.ts:256-264` carrega
`conversation_messages` para dar ao LLM. Não há registro estruturado do
"fluxo em andamento" (o que já foi coletado, o que falta). Isso funciona
para casos curtos, mas quebra em: mudança de assunto no meio; retomada
depois de intervalo; segundo canal para o mesmo usuário. Severidade:
média. Recomendação (Fase 1): definir um State Manager fino que persista
apenas o mínimo — a chave "flow atual" e "última tool draft" — sem tentar
resolver todo o problema agora.

**P5 — Histórico do App usa `.slice(1)` para descartar a mensagem recém
inserida.**
Evidência: `agent-chat/index.ts:167-177` faz o insert inbound e depois
seleciona ordenando desc com `limit(HISTORY_TURNS+1)` e derruba o
primeiro. Se dois turnos entrarem em rápida sucessão, corre-se risco de
dropar a mensagem errada. Severidade: baixa (raro em uso interativo).
Recomendação: no AgentCore, buscar o histórico ANTES do insert do turno
corrente, ou filtrar por `id != inbound_id`.

**P6 — Perda potencial de recibo por depender de `enqueueReply` só no WA.**
Evidência: `orchestrator.ts:59-81` insere em `outbound_messages` com
`idempotency_key = run:{inbound_message_id}`. No App, o recibo vai apenas
como resposta HTTP e `conversation_messages` (não em `outbound_messages`).
Impacto: correto para o design atual; documentar como responsabilidade do
Channel Adapter para que a Fase 1 preserve.

**P7 — `agent-run/index.ts` (simulador) usa `runOrchestrator` que sempre
`enqueueReply` em `outbound_messages`.**
Evidência: `orchestrator.ts:60-72` marca `channel: "simulator"` mas ainda
grava outbound. Isso é aceitável hoje; ao unificar, o Adapter do simulador
deve continuar não enviando para WhatsApp real.

**P8 — Isolamento do App: fallback pega "última conversa `source='app'`"
independente de deep-link.**
Evidência: `AssessorPanel.tsx:69-77` seleciona `conversations.source='app'`
mais recente quando o localStorage está vazio ou inválido. Isso é seguro
porque o `agent-chat` revalida ownership (`agent-chat/index.ts:67-79`).
Severidade: baixa. Documentar.

Fora disso, não há evidência de dessincronia entre `pending_confirmations`
e `conversations` (unique parcial por conv resolve; RPC roda em
`for update`).

---

## 5. Duplicações entre Plataforma e WhatsApp

**Já compartilhado:** `llm.ts`, `tools.ts`, `prompt.ts`, `parser.ts`,
`resolvers.ts`, `extract.ts`, `messageTemplates.ts`, `engine/facts.ts`,
todas as RPCs de rascunho/confirmação, todas as tabelas de conversa e
confirmação, telemetria e simulador.

**Duplicado hoje (deve migrar para o core):**
- Interceptação de CONFIRMAR/CANCELAR e chamada a `agent_execute_confirmation`.
- Carga de histórico + montagem de `history[]` para `runAgentTurn`.
- Insert de `agent_runs` inicial + update final com steps/tokens/latency.
- Insert em lote de `agent_tool_calls`.
- Escolha entre caminho LLM e fallback determinístico.
- Detecção do rascunho gerado no turno para expor `pending` ao caller.
- Formatação do recibo por `kind`.

**Inconsistências reais:**
- Textos de recibo (P2).
- Presença de fast-paths (P3).
- Rótulo de `path` em `agent_runs` (P1).
- Presença de anti-loop guard (só no App).

**Não deve migrar (fica no Channel Adapter):**
- App: JWT do usuário, rate limit por `conversation_messages`, resposta
  HTTP síncrona com `pending`/`report`.
- WA: verificação de secret, dedupe por `provider_message_id`, media
  fallback, extração de `VINCULAR`, `outbound_messages` + dispatcher,
  `ensureConversation(user,phone)`.

---

## 6. Arquitetura proposta

```text
┌─ App ────────────────────────┐    ┌─ WhatsApp (WAHA) ─────────────────┐
│ AssessorPanel.tsx            │    │ whatsapp-webhook/index.ts         │
│ (UI + chamada HTTP)          │    │ (secret, dedupe, link, media,     │
│                              │    │  outbound_messages, dispatcher)   │
└─────────────┬────────────────┘    └───────────────┬───────────────────┘
              │  NormalizedInboundTurn              │  NormalizedInboundTurn
              ▼                                     ▼
        ┌───────────────────────────────────────────────────┐
        │           Channel Adapter (thin)                  │
        │  agent-chat/index.ts  |  whatsapp-webhook/index.ts│
        │  Auth + normalização + entrega da saída           │
        └───────────────────────┬───────────────────────────┘
                                ▼
        ┌───────────────────────────────────────────────────┐
        │  AgentCore.handleTurn(input)  (_shared/agent/core)│
        │                                                   │
        │  1. Session       → SessionManager                │
        │  2. ConversationState (read/append)               │
        │  3. IntentRouter  → intent + fast paths           │
        │  4. StateManager  → carrega/expira estado atual   │
        │  5. Confirmation short-circuit (RPC existente)    │
        │  6. FinancialContext360 (montagem sob demanda)    │
        │  7. runAgentTurn(...) (runtime atual, sem mudança)│
        │  8. Persistência: agent_runs / agent_tool_calls   │
        │  9. StateManager.update(...)                      │
        │  10. Retorno estruturado (reply, pending, meta)   │
        └───────────────────────┬───────────────────────────┘
                                ▼
                ┌────────────────────────────┐
                │  Tools + RPCs (inalterados)│
                └────────────────────────────┘
```

`NormalizedInboundTurn` (contrato do adapter → core):
```ts
{ channel: "app" | "whatsapp" | "simulator",
  user_id: string, conversation_id: string,
  inbound_message_id: string | null,
  text: string, ui_action?: "confirm" | "cancel",
  pending_id?: string,
  to_phone?: string, source_meta?: Record<string,unknown> }
```
`AgentCoreResult` (core → adapter):
```ts
{ reply: string,
  reply_kind: "receipt"|"draft"|"question"|"info"|"cancelled"|"expired"|"unlinked",
  pending: { id, kind, summary_text, expires_at, payload } | null,
  executed?: unknown, report?: unknown,
  run_id?: string, path: "llm"|"deterministic_fallback" }
```
O Channel Adapter escolhe como entregar `reply` (HTTP JSON no App;
`outbound_messages` no WA); o core não sabe do transporte.

---

## 7. Responsabilidades por camada

| Responsabilidade | AgentCore | Adapter App | Adapter WA | Tools | RPCs | DB | Frontend |
|---|---|---|---|---|---|---|---|
| Autenticação da entrada |  | ✓ (JWT) | ✓ (secret+link) |  |  |  |  |
| Dedupe de entrega |  |  | ✓ |  |  | inbound_messages |  |
| Rate limit |  | ✓ |  |  |  |  |  |
| Resolver `conversation_id` | ✓ (via SessionManager) | fornece hint | fornece (user,phone) |  |  | conversations |  |
| Append `conversation_messages` | ✓ |  |  |  |  | conversation_messages |  |
| Roteamento de intenção | ✓ |  |  |  |  |  |  |
| Confirmar/Cancelar | ✓ |  |  |  | agent_execute_confirmation | pending_confirmations |  |
| Chamar LLM | ✓ |  |  |  |  |  |  |
| Executar tools |  |  |  | ✓ | ✓ | várias |  |
| Fallback determinístico | ✓ |  |  |  |  |  |  |
| Persistir telemetria | ✓ |  |  |  |  | agent_runs, agent_tool_calls |  |
| Escolher recibo | ✓ |  |  |  |  |  |  |
| Enviar reply | delega | HTTP JSON | outbound_messages + dispatcher |  |  |  |  |
| Ownership final |  |  |  |  | ✓ (nas RPCs) | RLS |  |
| UI de chat |  |  |  |  |  |  | ✓ |

---

## 8. Novos componentes sugeridos

Todos em `supabase/functions/_shared/agent/core/`. Nenhum introduz nova
dependência externa; nenhum substitui algo do runtime, tools ou RPCs.

1. **`AgentCore.ts`** — função `handleTurn(input): AgentCoreResult`.
   Consome os componentes abaixo. Justificativa: eliminar P1/P2/P3.
   Alternativa: manter `orchestrator.ts` e transformar `agent-chat` em
   chamador dele — rejeitada porque `orchestrator` foi desenhado com
   `outbound_messages`/idempotency para WhatsApp; misturar responsabilidades
   piora o problema.
2. **`SessionManager.ts`** — resolve/cria `conversation_id`:
   - WA: `(user_id, phone_e164)` (unique já existe).
   - App: prioriza `conversation_id` recebido; senão última `source='app'`
     do usuário; senão cria uma nova. Justificativa: centralizar a lógica
     hoje duplicada em `agent-chat` e `orchestrator`.
3. **`ConversationHistory.ts`** — leitura canônica dos últimos N turnos e
   append de mensagens. Resolve P5 filtrando por `id != inbound_id`.
4. **`IntentRouter.ts`** — expõe `routeIntent(text, history)` retornando
   `{ kind, confidence, entities, suggestedTool? }`. Envelopa
   `parser.interpret` + fast-paths do App (`isAnalyticsRequest`,
   `tryFastPathCardExpense`) e o guard de "só cartão / follow-up". Sem
   mudar as regras existentes. Justificativa: eliminar P3.
5. **`StateManager.ts`** — API mínima:
   `get(conv_id) / setFlow(conv_id, flow, data, ttl) / clear(conv_id) /
   noteLastTool(conv_id, tool_name, result)`. Persistência: começar
   REAPROVEITANDO `conversations.pending_slots` (jsonb, já existe na
   migração `20260715233953`) — evita nova tabela nesta fase. Se essa
   coluna não estiver mais em uso após reads, criar tabela dedicada
   `agent_conversation_state` (§10). Justificativa: dar suporte a P4
   sem inflar escopo.
6. **`FinancialContext360.ts`** — função pura `assemble(user_id, intent,
   state)` que retorna um objeto compacto com os slices relevantes
   (contas, cartões, categorias, resumo do mês, últimos N lançamentos).
   Internamente chama as MESMAS tools já existentes (`list_accounts`,
   `list_credit_cards`, `list_categories`, `get_financial_summary`,
   `list_recent_transactions`) — sem duplicar SQL, sem substituir tools.
   Não executa operações financeiras. Uso previsto: fornecer
   contexto pré-computado APENAS para intenções analíticas e de
   simulação; para intenções de escrita, o modelo continua invocando
   tools sob demanda (comportamento atual). Justificativa: reduzir passos
   do LLM sem mudar tools.
7. **`ReceiptBuilder.ts`** — `buildReceipt(kind, result, channel)` único.
   Resolve P2.

Cada arquivo é pequeno (<200 linhas), testável isoladamente, e importado
pelos dois adapters.

---

## 9. Arquivos impactados

| Arquivo | Alteração prevista | Motivo | Risco | Obrigatório? |
|---|---|---|---|---|
| `supabase/functions/_shared/agent/core/*` | Criar | AgentCore + componentes | baixo | sim |
| `supabase/functions/_shared/agent/orchestrator.ts` | Reduzir a wrapper que chama AgentCore no modo WA/simulador; manter export `runOrchestrator` para compatibilidade com `agent-run/index.ts` | Eliminar duplicação | médio | sim |
| `supabase/functions/agent-chat/index.ts` | Reduzir a Channel Adapter (auth + normalização + resposta HTTP); remover fast-paths locais movidos para IntentRouter | Eliminar P1/P3 | médio | sim |
| `supabase/functions/whatsapp-webhook/index.ts` | Manter recepção; substituir bloco de `runOrchestrator` por `AgentCore.handleTurn` via wrapper. Mantém `outbound_messages`+dispatcher | Eliminar P1 preservando idempotência do canal | médio | sim |
| `supabase/functions/agent-run/index.ts` | Continuar chamando `runOrchestrator` (wrapper) | Simulador intacto | baixo | não |
| `supabase/functions/_shared/agent/llm.ts` | Não tocar | Runtime preservado | — | não |
| `supabase/functions/_shared/agent/tools.ts` | Não tocar | Tools preservadas | — | não |
| `supabase/functions/_shared/agent/parser.ts` | Não tocar | Interpret preservado | — | não |
| `supabase/functions/_shared/agent/prompt.ts` | Não tocar | Prompt preservado | — | não |
| `src/components/assessor/AssessorPanel.tsx` | Não tocar nesta fase | Contrato do adapter mantém shape atual | — | não |
| Testes em `src/test/` e novos em `supabase/functions/_shared/agent/core/*.test.ts` | Adicionar | §13 | baixo | sim |

Se, durante a implementação, o contrato de resposta do `agent-chat` mudar
por qualquer motivo, `AssessorPanel.tsx` entra na lista com ajuste mínimo
(campos opcionais). O plano parte da premissa de **shape idêntico**.

---

## 10. Banco de dados

Preferência: **não criar nova tabela nesta fase**.

Reaproveitar:
- `pending_confirmations` para estado de confirmação (já cobre).
- `conversations.pending_slots jsonb` para estado operacional mínimo
  (flow atual + last_tool). Antes de decidir, verificar em migração
  `20260715233953` se essa coluna ainda é usada por algum código; se
  estiver órfã, é o vetor mais barato.

Contingência (se `pending_slots` estiver ocupada ou for arriscada
compartilhar):

```sql
create table if not exists public.agent_conversation_state (
  conversation_id uuid primary key
    references public.conversations(id) on delete cascade,
  user_id uuid not null,
  flow text,                        -- ex.: 'new_expense_card'
  collected jsonb not null default '{}'::jsonb,
  last_tool text,
  last_tool_result jsonb,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes')
);
create index on public.agent_conversation_state(user_id);
create index on public.agent_conversation_state(expires_at);
alter table public.agent_conversation_state enable row level security;
grant select on public.agent_conversation_state to authenticated;
grant all on public.agent_conversation_state to service_role;
create policy acs_select_own on public.agent_conversation_state
  for select to authenticated using (user_id = auth.uid());
```
- Ciclo de vida: escrito pelo service role dentro do AgentCore; expira em
  30 min por padrão; substituído a cada mudança de flow; limpo após
  confirmação/cancelamento.
- Limpeza: cron leve (`documents-cleanup` já existe; adicionar apagar
  registros expirados) ou trigger no update.
- Migração: reversível — `drop table` remove sem impactar tools/RPCs.
- Rollback: alternar AgentCore para modo `state=none` (comportamento
  atual — inferir do histórico) via flag em `agent_prompt_versions.status`
  ou variável de ambiente.

Nada mais no schema muda.

---

## 11. Fluxos futuros após a Fase 1

**Mensagem simples ("oi"):** Adapter normaliza → AgentCore append inbound
→ IntentRouter=`unknown` → StateManager: sem flow → runAgentTurn com
history → reply curto → append outbound → adapter entrega.

**Criar lançamento ("gastei 42,90 no almoço hoje no Nubank"):** Adapter
normaliza → IntentRouter=`transaction` → StateManager: sem flow ativo →
runAgentTurn escolhe `create_transaction_draft` → tool grava
`pending_confirmations` via `agent_upsert_draft` → AgentCore encontra
pendente → retorna `reply_kind:"draft"` com `pending` → adapter entrega.

**Consulta financeira ("como foi meu mês?"):** IntentRouter marca
`analytics` → FinancialContext360 fornece resumo pré-computado → o
runtime usa `analyze_spending` (mesma tool) → reply informativo. O
fast-path atual do App vira uma rota do IntentRouter, portanto WhatsApp
passa a ganhar o mesmo tratamento.

**Confirmação ("CONFIRMAR"):** IntentRouter=`confirm` → AgentCore chama
`agent_execute_confirmation` (RPC atual, imutável) → ReceiptBuilder →
StateManager.clear → adapter entrega. WhatsApp adicionalmente enfileira em
`outbound_messages` com `idempotency_key` (responsabilidade do Adapter).

**Cancelamento ("CANCELAR"):** IntentRouter=`cancel` → update
`pending_confirmations.status='cancelled'` (comportamento atual) →
StateManager.clear → reply padrão.

**Mudança de assunto:** IntentRouter detecta intenção nova ≠ flow atual →
StateManager.clear antes de rodar runtime → sem contaminação.

**Retomada de conversa:** StateManager.get retorna estado se
`now < expires_at`; caso contrário trata como conversa nova. Sem
`pending`, sem flow: apenas history.

**WhatsApp:** idêntico ao acima, com Adapter cuidando de
`whatsapp-send` e `outbound_messages` como hoje.

**Plataforma:** idêntico, respondendo HTTP com `AgentCoreResult` no shape
que `AssessorPanel` já consome (`reply`, `pending`, `executed`, `report`).

---

## 12. Estratégia de migração (incremental, reversível)

Subetapa 12.1 — **Esqueleto do AgentCore inerte.**
Criar `_shared/agent/core/*` com implementação chamando `runOrchestrator`
ainda. Sem uso em produção. Rollback: apagar diretório. Risco: nenhum.

Subetapa 12.2 — **Extrair Session/History/Receipt.**
Mover `enqueueReply`, `mapConversationRow`, `buildReceipt`, `findPending`,
`ensureConversation` para o core, mantendo `orchestrator.ts` reexportando.
Rollback: git revert. Risco: baixo. Validação: rodar suite de testes do
agente (`agent-*.test.ts`) sem regressão.

Subetapa 12.3 — **AgentCore.handleTurn coexistindo.**
Implementar `handleTurn` compondo os módulos. `whatsapp-webhook` continua
chamando `runOrchestrator`; `agent-chat` continua monolítico. Testes de
paridade comparando saída de `handleTurn` vs caminhos atuais em fixtures.
Rollback: descartar arquivo. Risco: baixo.

Subetapa 12.4 — **Cortar WhatsApp para o AgentCore.**
Alterar `whatsapp-webhook` para chamar `AgentCore.handleTurn` num Adapter
fino que ainda enfileira em `outbound_messages` com o mesmo
`idempotency_key`. Manter `runOrchestrator` como wrapper por trás,
delegando ao core, para o simulador não quebrar. Validação: enviar
mensagens em ambiente de teste (texto simples, transação, CONFIRMAR,
CANCELAR, mídia — que continua no fallback existente).
Rollback: reverter chamada em `whatsapp-webhook`. Risco: médio.

Subetapa 12.5 — **Cortar App para o AgentCore.**
Substituir o corpo de `agent-chat/index.ts` por Adapter fino chamando
`AgentCore.handleTurn`. Fast-paths passam a viver no IntentRouter.
Contrato de resposta mantido idêntico. Validação: subir e testar Assessor
no preview com casos reais (analytics, cartão único, follow-up, confirm,
cancel, documento). Rollback: reverter arquivo. Risco: médio.

Subetapa 12.6 — **Ativar StateManager mínimo.**
Ligar leitura/escrita em `conversations.pending_slots` (ou nova tabela
§10) apenas para: `flow_started_at`, `flow_kind`, `last_tool`. Consumido
pelo IntentRouter para detectar mudança de assunto. Rollback: flag de
build desligando o módulo. Risco: baixo.

Subetapa 12.7 — **Deprecar código morto no orchestrator.**
Remover trechos que ficaram sem uso após 12.4/12.5. Rollback: git revert.
Risco: baixo.

Nenhuma subetapa faz Big Bang; todas são passíveis de rollback por
reverter no máximo um arquivo.

---

## 13. Testes necessários

Unitários (novos, em `supabase/functions/_shared/agent/core/*.test.ts` e
`src/test/*.test.ts`):
- `SessionManager`: resolução por (user,phone) no WA; escolha por
  `source='app'` no App; criação idempotente.
- `IntentRouter`: casos existentes de `parser.interpret` + fast-paths do
  App (analytics, cartão-único, follow-up "Cartão Itaú").
- `StateManager`: set/get/clear; expiração; troca de assunto limpa flow.
- `ReceiptBuilder`: cada `kind` produz string única.
- `AgentCore.handleTurn`: paridade com `runOrchestrator` para fixtures
  de: texto simples, transação, transferência, meta, aporte, dívida,
  analytics, before_spending, CONFIRMAR, CANCELAR, mídia.

Integração:
- App: `agent-chat` responde no shape esperado por
  `AssessorPanel.tsx` (`reply`, `pending`, `executed`, `report`,
  `conversation_id`).
- WhatsApp: `whatsapp-webhook` continua produzindo linha em
  `outbound_messages` com `idempotency_key = run:{inbound_message_id}` e
  aciona `whatsapp-send`.

Regressão (rodar toda a suite atual de `src/test/`):
- `agent-parser.test.ts`, `agent-extract.test.ts`,
  `agent-resolvers.test.ts`, `agent-resolve-occurred-at.test.ts`,
  `agent-edit-flow.test.ts`, `agent-description-semantics.test.ts`,
  `whatsapp-orchestrator-flow.test.ts`.

Segurança:
- Isolamento entre usuários: adapter WA aceita apenas telefone com
  `whatsapp_links.status='active'` (comportamento atual).
- App: `agent-chat` continua rejeitando `conversation_id` de outro user
  (comportamento atual, `agent-chat/index.ts:67-72`).
- `user_id` das tools continua sempre vindo do adapter (nunca do modelo).

---

## 14. Critérios de aceite

- App e WhatsApp instanciam o mesmo `AgentCore.handleTurn`.
- Nenhuma tool foi duplicada; `tools.ts` inalterado.
- `pending_confirmations` e `agent_execute_confirmation` intactos e
  usados por ambos os canais.
- Recibos ("Despesa registrada", "Transferência registrada", …) idênticos
  nos dois canais.
- Fast-paths de analytics e de cartão passam a valer também para o
  WhatsApp.
- Todos os testes do agente listados em §13 passam sem alteração de
  expected snapshots existentes (exceto textos de recibo se unificados).
- `agent_runs.path` reflete `llm` vs `deterministic_fallback` em ambos os
  canais.
- Estado operacional mínimo persiste entre turnos e expira em 30 min;
  mudança de assunto não herda flow.
- Nenhuma tabela nova foi criada, OU foi criada apenas
  `agent_conversation_state` com RLS, GRANT e job de limpeza.
- `agent-run/index.ts` (simulador) continua funcional.
- Nenhuma regressão em: vinculação WhatsApp, media fallback, ACKs,
  outbound dispatcher, painel admin do agente, telemetria em
  `agent_runs` / `agent_tool_calls`.

---

## 15. Riscos e mitigações

| Risco | Prob. | Impacto | Mitigação | Sinal de regressão | Rollback |
|---|---|---|---|---|---|
| Divergência sutil na sequência de inserts no App | média | recibos duplicados / faltantes | Testes de paridade em 12.3 | Duplicidade em `conversation_messages` no primeiro dia | Reverter 12.5 |
| Quebra do dispatcher WA por refactor | baixa | alta (silêncio no WhatsApp) | Manter Adapter WA idêntico em `outbound_messages`+`idempotency_key` | Fila crescendo em `outbound_messages`, `whatsapp-ack-watchdog` alertando | Reverter 12.4 |
| StateManager contamina fluxos legítimos | média | alta | TTL 30 min; clear em confirm/cancel; flag para desligar | Rascunho errado após "mudei de assunto" | Desligar StateManager |
| `pending_slots` estar em uso por código antigo | baixa | quebra silenciosa | Auditar uso antes de 12.6; se estiver em uso, criar tabela dedicada | Erro de leitura em conv antiga | Criar tabela nova §10 |
| Contrato do App mudar por engano | baixa | UI quebra | Testes de shape antes de 12.5 | 500 em `agent-chat` | Reverter 12.5 |
| Fast-path do WA passa a rodar em enunciados que a IA respondia melhor | baixa | resposta pior | Ativar por flag por canal, monitorar telemetria | Queda em `steps=0`, aumento em `error_masked` | Desligar flag |

---

## 16. Ordem recomendada de implementação

12.1 → 12.2 → 12.3 (com testes de paridade) → 12.4 (WA) → 12.5 (App) →
12.6 (StateManager) → 12.7 (limpeza).

Rodar `bunx vitest run` após cada subetapa; deploy Edge Function
independentemente para WA e App; observar `agent_runs` por 24 h antes de
avançar.

---

## 17. Pontos que precisam de decisão humana

1. **Armazenamento do estado operacional:** reutilizar
   `conversations.pending_slots` (mais barato, sujeito a auditoria) OU
   criar `agent_conversation_state` (mais explícito, exige migração)?
   Recomendação: reutilizar se auditoria confirmar que a coluna está
   livre; caso contrário, criar a tabela.
2. **Unificar textos de recibo:** adotar a redação do WhatsApp
   ("Despesa registrada") ou a do App ("Gasto registrado no cartão") como
   padrão único? Recomendação: WhatsApp, por já ser a mais neutra.
3. **Ativar fast-paths no WhatsApp:** ligar de imediato ou lançar
   inicialmente atrás de flag para observar 48 h?
4. **TTL padrão do StateManager:** 30 min é razoável ou o produto quer
   uma janela diferente (ex.: 24 h para uma coleta longa)?
5. **Alterar contrato de `agent-chat`:** manter shape atual (recomendado)
   ou aproveitar para incluir `state` explícito na resposta?

---

## Arquivos inspecionados neste turno

- `supabase/functions/_shared/agent/orchestrator.ts` (integral)
- `supabase/functions/_shared/agent/llm.ts` (integral)
- `supabase/functions/_shared/agent/prompt.ts` (integral)
- `supabase/functions/_shared/agent/parser.ts` (integral)
- `supabase/functions/_shared/agent/resolvers.ts` (integral)
- `supabase/functions/_shared/agent/extract.ts` (integral)
- `supabase/functions/_shared/agent/messageTemplates.ts` (integral)
- `supabase/functions/_shared/agent/tools.ts` (linhas 1-336 e 560-747)
- `supabase/functions/agent-chat/index.ts` (linhas 1-382 de 441)
- `supabase/functions/whatsapp-webhook/index.ts` (linhas 1-394 de 429)
- `supabase/functions/agent-run/index.ts` (integral)
- `src/components/assessor/AssessorPanel.tsx` (linhas 1-387 de 513)
- Contexto já em janela: `src/context/AssessorContext.tsx`,
  `src/pages/Assessor.tsx`, `supabase/functions/_shared/messaging/types.ts`,
  `src/pages/WhatsApp.tsx`.
- Grep de migrations em `supabase/migrations/` para conversation_id,
  RPCs `agent_upsert_draft`, `agent_execute_confirmation`,
  `pending_confirmations`, unique parcial e unique `(user_id,phone_e164)`.

## Áreas não validadas nesta fase

- Corpo completo de `agent-chat/index.ts` linhas 382-441 (final
  do fast-path e utilitários) — presumido consistente com o restante.
- Corpo final de `whatsapp-webhook/index.ts` linhas 394-429 (chamada a
  `EdgeRuntime.waitUntil` + try/catch global) — comportamento descrito no
  cabeçalho do arquivo já confere.
- Corpo de `agent-chat` na linha do `resumeIngestion`/documentos: fora do
  escopo desta fase.
- Uso atual da coluna `conversations.pending_slots` — precisa
  `rg pending_slots` antes de 12.6.
- Simulador (`src/pages/admin/AgenteSimulador.tsx`) — presumido chamar
  `agent-run` sem depender de shape novo; validar em 12.3.
- Painel admin do agente (`src/pages/admin/Agente.tsx`,
  `pages/admin/Mensagens.tsx`) — expressamente fora desta fase.

## Dúvidas restantes

- O produto quer manter `conversations.source='app'` como discriminador
  ou passar a diferenciar mais canais no futuro (chat web público, etc.)?
- Alguma restrição regulatória para persistir "flow atual" além de
  histórico textual? (LGPD já cobre; confirmar se `collected` pode
  guardar valores brutos ou precisa mascarar.)

## Complexidade qualitativa por subetapa

- 12.1: baixa. 12.2: baixa. 12.3: **média**. 12.4: **média**. 12.5:
  **média**. 12.6: baixa/**média** (depende da decisão §17.1). 12.7: baixa.

## Menor escopo implementável que já gera valor sem regressão

Executar **12.1 + 12.2 + 12.3 + 12.4** — extrai o AgentCore, migra o
WhatsApp para ele e mantém `agent-chat` intocado por enquanto. Isso já:
- elimina metade da duplicação (P1);
- unifica recibos no canal com maior risco de silêncio (P2);
- prepara terreno para o App na iteração seguinte (12.5);
- é 100% reversível revertendo `whatsapp-webhook/index.ts`.

Recomendação: parar a Fase 1 imediata neste ponto, medir telemetria por
uma semana, e só então executar 12.5–12.7.
