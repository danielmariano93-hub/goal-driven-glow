
# Correção Final e Hardening — NoControle.ia

Foco: consertar o que a auditoria acusou e validar. Nenhuma nova feature, nenhum redesign. Uma rodada, uma migration incremental, correções em Edge Functions, ajustes localizados na UI, e testes/consultas de verificação.

---

## 1. Migration incremental `beta_hardening`

### 1.1 Revogar EXECUTE default e conceder mínimo por função

Para toda função `SECURITY DEFINER` em `public`:
```sql
REVOKE ALL ON FUNCTION public.<fn>(...) FROM PUBLIC, anon;
```
Depois, `GRANT EXECUTE` seletivo:

- **authenticated** (usa `auth.uid()`, chamada pelo cliente):
  `ensure_profile`, `complete_onboarding`, `create_transfer`,
  `create_phone_link_code`, `revoke_whatsapp_link`, `list_my_whatsapp_link`,
  `confirm_pending_action`, `cancel_pending_action`,
  `recurring_confirm`, `recurring_skip`,
  `split_create`, `split_add_payment`, `split_reverse_payment`,
  `split_send_reminders`,
  `import_legacy_batch`, `import_transactions_batch`,
  `user_export_data`, `user_request_deletion`,
  `join_challenge`, `mark_all_notifications_read`,
  `challenge_progress_add` (validar `auth.uid()` internamente).
- **service_role apenas** (jobs/orquestração):
  `claim_outbound_batch`, `mark_outbound_sent`,
  `recover_expired_outbound_leases`, `recurring_generate_due`,
  `notify_upsert`, `agent_execute_confirmation`,
  `agent_upsert_draft`, `agent_sim_enqueue`, `agent_sim_reset`,
  `admin_dashboard_stats`, `set_active_prompt_version`,
  `update_agent_settings`.
- **admin server-side apenas**: usar `is_current_user_admin()` no corpo
  quando também exposto via edge (dashboard stats, prompt versions).

Toda função revalida `auth.uid() IS NOT NULL` (ou admin/service) no corpo — defesa em profundidade.

### 1.2 Divisão custom: separar `owner_amount`

Refatorar `split_create` para aceitar `p_owner_amount numeric` como parâmetro dedicado e validar em centavos:
```
total_cents == sum(participants.amount_due_cents) + (include_owner ? owner_cents : 0)
```
Rejeitar com `raise exception 'custom_sum_mismatch'` se divergir. Client passa `owner_amount` separado do array de participantes.

### 1.3 Reminder jobs: claim atômico + estados corretos

Adicionar colunas (se ausentes) em `reminder_jobs`:
`status` estendido para inclusão de `processing`, `enqueued`, `failed`, `skipped`;
`lease_expires_at timestamptz`, `attempts int default 0`, `last_error text`,
`outbound_message_id uuid references outbound_messages`.

Nova RPC `claim_reminder_jobs(p_limit int)` `SECURITY DEFINER`, service_role only, com `FOR UPDATE SKIP LOCKED`, respeitando `scheduled_for <= now()`, quiet hours (`SP 08–22`) e `attempts < 5`.

Índice único parcial: `(participant_id, date_trunc('day', scheduled_for))` para dedup diário.

### 1.4 Account deletion — máquina de estados

Adicionar em `account_deletion_requests`:
`status` enum (`pending, approved, processing, completed, rejected, cancelled`),
`grace_period_ends_at`, `processed_at`, `processed_by`, `admin_notes`.

RPCs:
- `user_cancel_deletion_request(p_id)` — usuário cancela enquanto `pending`.
- `admin_approve_deletion_request(p_id, p_notes)` — admin marca approved + grace period 7d.
- `admin_reject_deletion_request(p_id, p_notes)`.
- `admin_process_deletion_request(p_id)` — service_role via edge; anonimiza/deleta em ordem correta e finalmente `auth.admin.deleteUser`.

RLS: usuário só vê/cancela o próprio; admin lê tudo via `is_current_user_admin()`.

### 1.5 RLS sanity de tabelas recentes

Auditar e reforçar:
- `shared_expense_participants`: sem SELECT para anon; owner-only via `owner_user_id = auth.uid()`.
- `shared_expense_events`: idem; nunca expor `pix_key` para não-owner.
- `reminder_jobs`: owner-only SELECT; INSERT/UPDATE via RPC.
- `xp_events`, `user_gamification`: SELECT own; INSERT via RPC apenas.
- `notification_preferences`, `notifications`: own only.
- `challenges_catalog`: SELECT anon+authenticated (público leitura); INSERT/UPDATE service_role.

Confirmar `GRANT` explícito para cada tabela — sem `anon` onde política escopa `auth.uid()`.

---

## 2. Edge Functions

### 2.1 CORS

Substituir `import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'` (não existe) pelo helper local já em `supabase/functions/_shared/cors.ts` em TODAS as funções.

### 2.2 `split-reminders-dispatch`

Reescrever:
- Método `POST` apenas.
- Gate: exigir header `x-cron-secret` == `Deno.env.get('CRON_SECRET')` **ou** JWT admin (`is_current_user_admin`). Rejeitar 401 caso contrário.
- Usar `claim_reminder_jobs` (lease de 2min).
- Para cada job: verificar participante `status IN ('pending','partial','notified')`, respeitar `opt_out`, quiet hours, cooldown de 24h.
- Criar `outbound_messages` com `idempotency_key = 'reminder:'||participant_id||':'||date(scheduled_for)`.
- Marcar job como `enqueued` (não `sent`). Estado final derivado do outbound.
- Watchdog externo (`whatsapp-ack-watchdog`) já atualiza outbound; complementar para reflexo em reminder_job.
- Sanitizar logs (sem Pix, sem telefone completo).

### 2.3 `user-data-export`

Exigir Authorization Bearer real, validar via `supabase.auth.getClaims(token)`, executar `user_export_data()` com o cliente autenticado (RLS). Retornar JSON. CORS ok.

### 2.4 `admin-process-deletion` (nova)

Service_role. Gate por admin JWT. Executa `admin_process_deletion_request` + `auth.admin.deleteUser`. Auditoria em tabela.

### 2.5 `supabase/config.toml`

Explicitar `verify_jwt` por função:
- `whatsapp-webhook`: `false` (valida secret WAHA no código).
- `split-reminders-dispatch`, `whatsapp-ack-watchdog`: `false` (valida cron secret).
- `agent-run`, `whatsapp-send`, `whatsapp-session`, `user-data-export`, `admin-process-deletion`: `true`.

### 2.6 Deno check

Rodar `deno check` em cada `index.ts` para pegar erros de sintaxe/imports.

---

## 3. Front-end (mínimo necessário)

- `DivisaoDoRoleNova.tsx`: separar `ownerAmount` em state próprio quando `includeOwner && custom`; validar soma em centavos antes de chamar RPC.
- `Perfil.tsx`: exibir status real da solicitação de exclusão, permitir cancelar enquanto `pending`, remover promessa "equipe processará".
- `AdminDashboard.tsx`: nova aba/seção "Exclusões" com aprovar/rejeitar/processar e "Reminder jobs" com dead letters.
- Remover botões sem handler nas rotas prioritárias (varredura rápida).

---

## 4. Testes

Adicionar:
- `split-math.test.ts`: casos owner incluído com custom, 100/3, 10.01/3.
- `sql-privileges.test.ts` (opcional, via `supabase--read_query` no relatório) — checar `has_function_privilege('anon', ...)` para cada RPC privada.
- `deletion-flow.test.ts`: state machine.
- `reminder-claim.test.ts`: dedup e claim.

Executar `bunx vitest run`, `tsgo`, `deno check supabase/functions/**/index.ts`, `vite build`.

---

## 5. Relatório final

Entregar:
1. Migration + lista de GRANTs finais (query real de `pg_proc` filtrada).
2. Edge Functions ajustadas + `deno check` verde.
3. Divisão custom + exclusão + reminder jobs corrigidos com evidência.
4. Contagem real de testes passando.
5. Pendências externas restantes: apenas credenciais WAHA/IA, domínio, docs legais.

```text
Ordem de execução
─────────────────
migration → edge fns → front pontual → testes → build → typecheck → deno check → consulta privilégios → relatório
```
