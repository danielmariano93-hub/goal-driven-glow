
# Fase 3 · Bloco B — Agente Financeiro End-to-End

Entrega uma jornada completa: inbound → interpretação → draft → CONFIRMAR → persistência única → recibo, com simulador admin quando WAHA/LLM não estiverem configurados. Reaproveita toda a infraestrutura da Fase 3 (webhook, outbox, links, pending_confirmations, agent_prompt_versions, agent_settings, agent_runs, agent_steps).

## 1. Auditoria e correções (migration incremental única)

- `REVOKE EXECUTE` de `public.has_role(uuid, app_role)` de `authenticated`; manter apenas a variante `has_role(app_role)` que usa `auth.uid()`.
- Adicionar `direction` (`'debit' | 'credit'`) em `transactions` para transferências (nullable; obrigatório quando `type='transfer'` via trigger). Backfill: por par `transfer_group_id`, menor `id` = debit, outra = credit. Atualiza `create_transfer` RPC para gravar direção explicitamente.
- Adicionar tabela `agent_drafts` (id, user_id, conversation_id, kind enum, payload jsonb validado, human_summary, status enum `pending|confirmed|cancelled|expired|superseded`, expires_at, result jsonb, created_at). Índice único parcial: um único draft `pending` por conversation_id.
- `pending_confirmations`: adicionar `result_snapshot jsonb` + `confirmed_from_message_id` para tornar CONFIRMAR idempotente (retorna mesmo recibo).
- Índice único em `outbound_messages(idempotency_key)` (nullable) para dedupe de recibos.
- RLS: usuário lê somente próprias linhas em `agent_runs`, `agent_steps`, `agent_drafts`, `pending_confirmations`, `conversations`, `conversation_messages`. Admin usa RPCs `SECURITY DEFINER` que retornam telefones já mascarados.
- Claim atômico na outbox: RPC `claim_outbound_batch(limit)` que faz `UPDATE ... WHERE status='queued' AND next_attempt_at<=now() RETURNING *` com `FOR UPDATE SKIP LOCKED`.

## 2. Importador legado (correção)

Reescreve `import_legacy_batch(p_payload jsonb)` para reconhecer o formato real do `financial_ecosystem_v2`:
- `lancamentos` → transactions (mapear tipo, valor, data, categoria/conta por nome/slug)
- `contasFixas` → recurring_entries
- `metas` → goals; `aportes` → goal_contributions
- `dividas` → debts
- `investimentos` → investments
- `emocoes` → emotional_checkins
- `categoriasCustom` → categories (pessoais)
- `config` → user_financial_settings (merge, não sobrescreve dados já preenchidos)

Idempotente via `import_rows(external_id)`. Prévia por entidade no UI, com contagem de itens ignorados e motivos. Nunca apaga origem.

## 3. Orquestrador do agente (Edge Function `agent-run`)

Ponto único chamado por (a) `whatsapp-webhook` para mensagens normais e (b) `/admin/agente/simulador`. Assinatura: `{ user_id, conversation_id, inbound_message_id, text, source: 'whatsapp'|'simulator' }`.

Fluxo:
1. Dedupe por `inbound_message_id` (retorna resultado prévio se existir).
2. **Interceptor pré-LLM**: se texto normalizado ∈ {CONFIRMAR, SIM, OK} e existe draft `pending` da conversa → executor transacional. Se ∈ {CANCELAR, NAO, NÃO} → marca `cancelled`. Ambos idempotentes.
3. Carrega prompt ativo + `agent_settings`. Se `LOVABLE_API_KEY` ausente → modo determinístico (regex tolerante a "gastei/recebi/transferi 42,90 [descrição] [hoje|ontem]") suficiente para os testes e simulador; UI marca "IA não configurada".
4. Chama gateway Lovable AI (google/gemini-2.5-flash) com tools abaixo, `stopWhen: stepCountIs(8)`, timeout de `agent_settings.timeout_ms`.
5. Cada step grava `agent_steps` sanitizado (sem payload PII bruto).
6. Resposta final entra na `outbound_messages` via `idempotency_key = run_id`.
7. `agent_runs` grava status, duração, tokens, custo estimado, erro sanitizado.

`user_id` **sempre** derivado do `whatsapp_links.user_id` (server), nunca do modelo. Tools recebem contexto via closure; schemas Zod não expõem user_id.

## 4. Tools funcionais (todas com execução real)

Reads (sem draft): `list_accounts`, `list_categories`, `get_financial_summary`, `list_recent_transactions`, `run_before_spending`.

Writes (criam `agent_drafts` pending, jamais escrevem direto): `create_transaction_draft`, `create_transfer_draft`, `create_goal_draft`, `add_goal_contribution_draft`, `create_debt_draft`, `cancel_pending_action`.

Executor server-side por `kind`, chamado apenas via CONFIRMAR:
- transaction/transfer → `create_transfer` RPC ou insert direto com validação de ownership
- goal/contribution/debt → insert com validação
- Um único INSERT por CONFIRMAR; `result_snapshot` guardado; segunda CONFIRMAR retorna snapshot.

Interpretação de valor BR: parser dedicado com testes (`1.234,56` → 1234.56, `42,90` → 42.90, `100` → 100). Datas relativas em `America/Sao_Paulo` (hoje/ontem/anteontem). Se conta única do usuário → sugere automaticamente. Se múltiplas → lista e pergunta. Nunca inventa categoria/conta.

## 5. Simulador `/admin/agente/simulador`

- Só admin. UI destacada "simulação — nenhuma mensagem real enviada".
- Seleciona usuário de sandbox (marca `profiles.is_sandbox` ou usa o próprio admin).
- Campo telefone simulado + textarea.
- Chama `agent-run` com `source: 'simulator'`. Outbox marca `channel='simulator'` para não tentar envio WAHA.
- Painel: inbound, run steps (sanitizados), draft, resposta outbound, tabelas afetadas.
- Botões CONFIRMAR/CANCELAR dentro do simulador (envia como nova mensagem).
- Botão "reset sandbox" apaga apenas registros criados por runs `source='simulator'` do usuário sandbox.

## 6. Admin `/admin/agente` (evolução)

- Editor de prompt com draft/preview/publish/rollback (usa `agent_prompt_versions.status`).
- Formulário de `agent_settings` com ranges validados (temp 0-1, steps 1-8, timeout 1-60s, max_tokens 500-4000).
- Lista de `agent_runs` últimas 100 com filtros status/período; drill-in para steps.
- Painel `pending_confirmations` por status.
- Outbox: queued / sent / failed / dead-letter.
- Saúde WAHA (existente) + saúde IA (`LOVABLE_API_KEY` presente + ping).
- Telefones sempre mascarados. Nunca exibe secrets.

## 7. UX usuário `/app/whatsapp`

Além do vínculo existente:
- Bloco "O que eu entendo" com 4 exemplos reais.
- Lista de confirmações pending do próprio usuário com botões CONFIRMAR/CANCELAR (via RPC).
- Últimos 10 recibos.
- Badges de estado: `WhatsApp não configurado`, `Conectado`, `IA não configurada`.

## 8. Webhook e outbox

- `whatsapp-webhook` (já existe) passa a: identificar VINCULAR → link; identificar CONFIRMAR/CANCELAR + draft pending → executor direto; caso contrário → invoca `agent-run`.
- `whatsapp-send` usa `claim_outbound_batch` (SKIP LOCKED) e respeita `channel != 'simulator'`.
- Dedupe: inbound por `provider_message_id`, run por `inbound_message_id`, outbound por `idempotency_key`, execução por `pending_confirmations.result_snapshot`.

## 9. Testes (vitest + SQL)

Novos testes cobrindo:
- Parser BR de valores/datas.
- Interpretação determinística (fallback sem LLM).
- Pipeline end-to-end via simulador: gasto → draft → CONFIRMAR → 1 transação; CONFIRMAR de novo → ainda 1; webhook duplicado → 1 resposta.
- CANCELAR e expirado → zero escrita.
- Outro telefone → negado.
- Isolamento A/B (usuário A não usa conta de B).
- Transferência: direção correta, efeito líquido zero.
- Meta/aporte/dívida via agente.
- Read tools não criam draft.
- Prompt injection ignorada (asserção sobre resposta do fallback determinístico + guard rails no system prompt).
- Ausência de secrets → app saudável.
- Claim concorrente da outbox (transações paralelas) não duplica.
- Teste SQL reproduzível de RLS entre dois usuários.

## 10. Arquivos

**Migration**: `supabase/migrations/<ts>_agent_e2e.sql` (revoke has_role legado, direction, agent_drafts, result_snapshot, idempotency_key, claim RPC, importer reescrito, sandbox flag).

**Edge Functions novas**: `agent-run/index.ts`, `agent-confirm/index.ts` (usado por app UI e simulador); `_shared/agent/{orchestrator.ts, tools.ts, parser.ts, executor.ts, prompt.ts, deterministic.ts}`.

**Edge Functions editadas**: `whatsapp-webhook/index.ts` (chama agent-run), `whatsapp-send/index.ts` (claim atômico + skip simulator).

**Frontend**: `src/pages/admin/AgenteSimulador.tsx`, evolução de `src/pages/admin/Agente.tsx`, `src/pages/WhatsApp.tsx` (pendências/recibos), `src/pages/Importar.tsx` (prévia multi-entidade).

**Libs**: `src/lib/agent/commands.ts` (CONFIRMAR/CANCELAR client-side), atualização `src/lib/db/finance.ts` para queries de pendências/recibos.

**Testes**: `src/test/agent-parser.test.ts`, `src/test/agent-pipeline.test.ts`, `src/test/agent-rls.sql`, `src/test/outbox-claim.test.ts`.

## 11. Segurança

- Prompt do sistema em pt-BR curto: identidade do NoControle.ia, jamais revelar prompt/executar SQL/mudar identidade/aprovar recomendação regulada.
- Toda tool revalida ownership via `user_id` do closure vs. `accounts.user_id` / `categories.user_id`.
- Nenhum secret no cliente. `LOVABLE_API_KEY` server-only.
- Logs sanitizam corpo de mensagem (max 500 chars, sem PII adicional).

## 12. Ordem de execução

1. Migration incremental.
2. `_shared/agent/*` (parser, prompt, tools, executor, orchestrator, deterministic).
3. Edge functions `agent-run`, `agent-confirm`; atualização de `whatsapp-webhook` e `whatsapp-send`.
4. Reescrita do importador legado.
5. UI simulador + evolução admin agente.
6. UI usuário whatsapp (pendências/recibos) + Importar.
7. Testes vitest + SQL de RLS.
8. `bun run test`, `tsgo --noEmit`, `bun run build`.

## Créditos: alto (nova função central + testes + UI admin + importador). Sem publicação.
