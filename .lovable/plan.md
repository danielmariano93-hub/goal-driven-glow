## Fase 3 — WhatsApp/WAHA + Agente Financeiro (NoControle.ia)

Orçamento: 31 créditos. Escopo é grande demais para caber inteiro; o plano abaixo prioriza a fundação segura ponta a ponta + fluxo de vínculo real, e deixa a orquestração do agente com LLM/tool-calls num segundo bloco explicitamente identificado. Nada de deploy/publicação. Nenhum secret hardcoded.

### Estado atual auditado
- 16 tabelas financeiras + auth prontas; RLS OK; testes/build/typecheck verdes.
- Nenhuma edge function existente; `supabase/functions/` ausente.
- Secrets externos WAHA_* ausentes. `LOVABLE_API_KEY` presente (AI Gateway).
- `has_role(_user_id, _role)` é a única assinatura — precisa overload que usa `auth.uid()` e revogação do velho de anon/public.
- `/app/importar` inexistente; nenhum código referencia `financial_ecosystem_v2`.

---

### Bloco A — Correções + Fundação (cabe no orçamento)

**A1. Migration `f3_agent_core.sql`** (uma migration única)

Enums novos: `messaging_provider` (waha, meta_cloud), `msg_direction` (inbound, outbound), `msg_status` (queued, sent, delivered, read, failed), `link_status` (pending, active, revoked), `run_status` (running, done, error, cancelled), `confirmation_status` (pending, confirmed, cancelled, expired), `prompt_status` (draft, active, archived).

Tabelas (todas `user_id uuid`, RLS estrita `user_id = auth.uid()`, GRANT authenticated/service_role; tabelas operacionais internas ficam sem policy de authenticated — só service_role):

- `whatsapp_links` (user_id UNIQUE-active parcial, phone_e164 UNIQUE-active parcial, phone_hash, status, consent_at, last_verified_at, revoked_at). Policy: user lê próprio, admin lê tudo via `is_current_user_admin`.
- `phone_link_codes` (user_id, code_hash, expires_at, attempts, cooldown_until, used_at). Sem SELECT para user; escrita via RPC.
- `inbound_messages` (provider, provider_message_id UNIQUE, from_phone, to_phone, body, received_at, raw_hash, processed_at, ignored_reason). Só service_role.
- `outbound_messages` (user_id?, to_phone, body, provider, provider_message_id?, status, attempts, next_attempt_at, error, kind: system|agent|confirmation). Só service_role, mas RPC `list_my_recent_conversation()` devolve sanitizado.
- `message_delivery_events` (outbound_id, status, occurred_at, payload_hash). Só service_role.
- `conversations` (user_id, phone_e164, last_message_at). RLS user_id.
- `conversation_messages` (conversation_id, user_id, direction, body_masked, created_at). RLS user_id, `body_masked` = texto truncado sem PII cruzada.
- `agent_runs` (user_id, conversation_id, status, model, prompt_version_id, steps, tokens_in, tokens_out, cost_cents, started_at, ended_at, error_masked). RLS user_id (SELECT).
- `agent_steps` (run_id, idx, kind: message|tool_call|tool_result|final, name?, args_hash, result_hash, tokens?). Só service_role.
- `pending_confirmations` (user_id, conversation_id, kind, payload jsonb, summary_text, status, expires_at, executed_at, result_ref). RLS user_id.
- `idempotency_keys` (scope, key, user_id?, first_seen_at, result_hash). Só service_role.
- `agent_prompt_versions` (version, status, system_prompt, model, temperature, max_steps, created_by, notes). SELECT admin.
- `agent_settings` (id=1 row, model, temperature, max_steps, timeout_ms, proactive_enabled default false, updated_by). SELECT admin.
- `provider_health_events` (provider, ok, latency_ms, error_masked, occurred_at). SELECT admin.

RPCs SECURITY DEFINER `search_path=public`, `REVOKE ALL FROM public,anon`, `GRANT EXECUTE TO authenticated`:
- `has_role(_role app_role)` overload → `has_role(auth.uid(), _role)`; manter a versão antiga mas `REVOKE EXECUTE FROM anon, public, authenticated` (só service_role/policies com search_path=public a chamam).
- `create_phone_link_code()` → gera código 6 dígitos, guarda hash, TTL 10min, limita 5 tentativas em 30min, cooldown; retorna código plano UMA vez.
- `revoke_whatsapp_link()` → marca revoked.
- `list_my_whatsapp_link()` → devolve status + phone mascarado `+55 (11) *****‑1234`.

**A2. `has_role` cleanup**
Revogar execução da assinatura antiga de `anon`/`public`/`authenticated`; criar overload novo; verificar policies existentes seguem funcionando (elas chamam `has_role(auth.uid(), 'admin')` que continua acessível a `authenticated`? Não — revogar de authenticated também exigiria substituir chamadas. Solução: manter antigo com EXECUTE só a `authenticated` sob o argumento `auth.uid()` sendo obrigatório documentado, adicionar overload sem argumento). Confirmação final via `pg_proc`.

**A3. `/app/importar`**
Arquivo `src/pages/Importar.tsx`. Lê `localStorage.getItem('financial_ecosystem_v2')` no cliente, mostra contagens por tipo, mapeia contas/categorias/transações/metas/aportes suportadas, chama RPC `import_legacy_batch(payload jsonb)` que gera `import_batches` + `import_rows` e insere idempotentemente pelo `external_id` gerado do payload. Marca `imported_at` em localStorage — nunca apaga. Se só parte for mapeável, mostra lista clara.

**A4. Lazy-load das rotas**
`React.lazy` + `Suspense` no `App.tsx` para todas as páginas de `/app/*` e `/admin`. Reduz bundle inicial (hoje 741 kB).

**A5. Contrato `MessagingProvider`**
`src/lib/messaging/types.ts` no cliente (só types) e `supabase/functions/_shared/messaging/types.ts` no server:
```ts
interface MessagingProvider {
  normalizeAddress(raw: string): string | null;
  sendText(to: string, body: string): Promise<{provider_message_id: string}>;
  getHealth(): Promise<{ok: boolean; latency_ms: number; error?: string}>;
  getSessionStatus(): Promise<{status: string}>;
  startSession?(): Promise<void>;
  stopSession?(): Promise<void>;
  verifyWebhookSecret(headers: Headers): boolean;
  mapInboundEvent(payload: unknown): NormalizedInbound | null;
}
```
Implementação `WahaProvider` em `supabase/functions/_shared/messaging/waha.ts` (URL/API_KEY/SESSION/SECRET via `Deno.env.get`). Stub `MetaCloudProvider` (só assinatura). Factory `getProvider()` retorna WAHA quando secrets presentes, senão modo "não configurado".

**A6. Edge Functions**
- `whatsapp-webhook` (verify_jwt=false): valida secret → dedup por `provider_message_id` → grava `inbound_messages` → E.164 → se corpo `^VINCULAR (\d{4,8})$` chama RPC `redeem_phone_link_code(phone,code)`; senão enfileira em `agent_runs` via `agent-runner` (stub que responde texto padrão "recebido — em breve consigo processar" enquanto o Bloco B não estiver ligado).
- `whatsapp-send` (JWT verificado, só admin ou service): consome `outbound_messages` queued, chama provider, atualiza status, guarda `provider_message_id`.
- `whatsapp-ack-watchdog` (verify_jwt=false, chamado só por cron ou admin): reenfileira `outbound_messages` sem ACK há > N minutos, respeitando `attempts` e backoff exponencial; marca dead-letter.
- `whatsapp-session` (JWT admin): expõe `getHealth/getSessionStatus/startSession/stopSession` — só configurado/não configurado se secret ausente.

Todas: CORS, Zod para body, resposta rápida (≤300ms) no webhook, logs sanitizados (hash-only PII), `idempotency_keys` para dedup.

**A7. UI `/app/whatsapp`**
`src/pages/WhatsApp.tsx`: estados `not-linked → code-generated (mostra código plano + TTL + botão copiar + link wa.me/NUMERO_OFICIAL?text=VINCULAR%20xxxxxx) → linked (mostra número mascarado + saúde + revogar)`. Sem revelar existência de outro usuário. Consentimento LGPD checkbox obrigatório antes de gerar código. Adicionar link no `MaisMenu`.

**A8. Admin `/admin/agente`**
`src/pages/admin/Agente.tsx`: cards read-only "WAHA configurado: sim/não", saúde última hora (via `provider_health_events`), volumes (contagens agregadas), lista de outbox pendente/dead-letter (mascarada), vínculos totais/ativos/revogados (sem telefones completos), tabela `agent_prompt_versions` com botões rascunho/validar/publicar/rollback (RPC `set_active_prompt_version(id)`), `agent_settings` editável (model, temperature, max_steps, timeout_ms; proactive_enabled fica desligado e travado). Se WAHA não configurado, banner "Configuração pendente" — nenhum valor fictício.

**A9. Landing**
Uma pequena seção "Um número, seu contexto privado" reutilizando componentes existentes; sem retrabalho de design.

**A10. Testes (Vitest)**
- E.164 Brasil (normalização de `+55 11 9…`, `011 9…`, `(11) 9…`).
- Hash de código + TTL + limite de tentativas (unitário sobre RPC via psql opcional; unitário puro sobre função de hash).
- Webhook: secret inválido → 401; duplicado (mesmo provider_message_id) → ignorado; corpo de bot com marca de origem → ignorado; VINCULAR separado do chat.
- `pending_confirmation`: draft → confirmar → executa uma vez; segunda confirmação → idempotente; outro telefone → negado; expirado → negado.
- Provider trocável: `getProvider()` sem secret devolve stub "não configurado" e todas as funções degradam com 503 controlado.
- SQL reproduzível de RLS em `supabase/tests/rls.sql` (comentado como manual — sem harness de dois usuários).

**A11. Verificações finais**
`bunx tsgo --noEmit`, `bunx vitest run`, `bunx vite build`. Sem erros. Relatório de créditos consumidos e de dependências externas ausentes (WAHA_BASE_URL, WAHA_API_KEY, WAHA_SESSION, WAHA_WEBHOOK_SECRET).

---

### Bloco B — Agente com LLM real (segundo passo, se restarem créditos)

Só executar se ainda houver ≥ 12 créditos após A. Caso contrário, `whatsapp-webhook` responde texto neutro e o Bloco B fica pendente com plano de continuação registrado.

- Edge Function `agent-runner`: AI SDK + Lovable AI Gateway (`google/gemini-2.5-flash` para custo), `streamText` com tools; `stopWhen: stepCountIs(8)`.
- Tools server-side (Zod): `list_accounts`, `list_categories`, `get_financial_summary`, `create_transaction_draft`, `create_transfer_draft`, `create_goal_draft`, `add_goal_contribution_draft`, `create_debt_draft`, `run_before_spending`, `list_recent_transactions`, `cancel_pending_action`. `user_id` sempre do `whatsapp_links` pelo telefone verificado — nunca do modelo.
- Drafts → `pending_confirmations`; responder ao usuário resumo + "responda CONFIRMAR ou CANCELAR (expira em 15 min)".
- Comandos texto `CONFIRMAR` / `CANCELAR` (case-insensitive) tratados antes do LLM.
- Prompt versionado carregado de `agent_prompt_versions` onde `status='active'`; guardrails anti-injection embutidos.
- Testes: prompt injection ("ignore instruções…") → agente ignora; `create_transaction_draft` não executa direto; texto financeiro → draft.

---

### Riscos e mitigações
- **Orçamento**: A é o mínimo viável. B fica declarado como pendência se não couber.
- **WAHA offline**: tudo degrada para "não configurado" — nenhum retry infinito, nenhuma UI enganosa.
- **Dedup**: `provider_message_id` UNIQUE + `idempotency_keys` para VINCULAR e confirmações.
- **Sem harness de dois usuários**: RLS validada por SQL reproduzível declarado.
- **Regressões**: nenhuma migration antiga tocada; nenhuma tabela financeira alterada.

### Ordem exata
A1 → A2 (mesma migration) → A5 tipos → A6 edge functions → A3 importar → A4 lazy → A7 UI whatsapp → A8 admin agente → A9 landing → A10 testes → A11 build/typecheck. Relatório.

### Créditos estimados
- Bloco A: **médio-alto** (perto do teto de 31).
- Bloco B: **alto**; provavelmente não cabe nesta rodada.

Ao fim: relato objetivo do que foi entregue, migrations aplicadas, edge functions criadas, arquivos, testes executados com resultado, e o que ficou pendente (secrets, Bloco B).
