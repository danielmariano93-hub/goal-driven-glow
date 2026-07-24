
# Auditoria — Migration `20260724180000_admin_control_center_contract_repair.sql`

Somente inspeção. Nada foi alterado.

## 1. Sincronização GitHub → Lovable
- Arquivo `supabase/migrations/20260724180000_admin_control_center_contract_repair.sql` está presente no workspace (550 linhas). Última migration local acima do merge é `20260724143647_...` seguida diretamente pela nova `20260724180000_...`, o que é consistente com o merge do PR #3.
- Não é possível ler o SHA do Git em Plan Mode (git é gerenciado internamente); porém a presença do arquivo e a ordenação linear indicam que a `main` mesclada em `dbe8e77` já refletiu no workspace. Nenhum arquivo divergente detectado nas leituras realizadas.
- Ação: nenhuma sincronização adicional necessária antes de aplicar. Se após autorização o commit não bater, a Lovable deve puxar `main` antes.

## 2. Estado da migration no histórico
Consulta em `supabase_migrations.schema_migrations` (versões ≥ `20260724100000`) retornou apenas:
`20260724132839`, `20260724133603`, `20260724134328`, `20260724143647`.
**A versão `20260724180000` NÃO está registrada. Status: PENDENTE.** Nenhuma versão com mesmo timestamp e conteúdo divergente. Sem drift detectado.

## 3. Validação objeto por objeto (leitura)

### Permissões
`platform_permissions` já contém todas as 12 ações que a migration insere (cockpit/growth/product_intel/clients[.identity[.masked]]/operations/messaging/whatsapp/audit) com os `allowed` esperados. O `INSERT ... ON CONFLICT (role, action) DO UPDATE` é idempotente. `_require_perm(_action text)` existe.

### `admin_v2_operations_health`
Existe overload duplo: `()` e `(_hours integer)`. A migration `DROP FUNCTION IF EXISTS ... ()` remove exatamente a assinatura zero-arg (segura) e recria a versão com `_hours`. Colunas usadas conferem: `job_heartbeats` (`job_key`, `last_run_at`, `next_run_at`, `last_ok`, `processed`, `failed`, `last_error_code`) e `agent_runs` (`status USER-DEFINED`, `latency_ms int`, `started_at timestamptz`). `ended_at` existe mas não é usado — sem risco.

### `admin_v2_ia_ocr_metrics`
`document_imports.status` é `text` com valores reais `confirmed`, `partially_confirmed`, `partial`, `failed`, `canceled` — cobertos exatamente. `extraction_ms int` e `created_at timestamptz` existem. Sem estados residuais fora do conjunto.

### `admin_v2_whatsapp_monitor`
`outbound_messages`: `provider USER-DEFINED`, `status USER-DEFINED`, `created_at`, `sent_at`, `delivered_at`, `read_at` — todos presentes. `inbound_messages.received_at` existe. Comparações via `provider::text = 'waha'` e `status::text in (...)` protegem contra enum. Valores reais atuais de status: `sent`, `delivered`, `dead` — subconjunto dos aceitos. `delivered_at`/`read_at` atualmente nulos (receipts indisponíveis), tratado pelo `receipts_available:false`.

### `admin_v2_growth_funnel`
`product_events`: `feature text`, `event_name text`, `event_source USER-DEFINED (event_source enum: live/backfill/backfill_proxy)`, `outcome text`, `pseudo_id uuid`, `occurred_at timestamptz`. Todos os 7 `event_name` reais do banco são cobertos pela normalização (`ocr_document_uploaded`, `split_created` → initiated; `financial_entry_created`, `goal_created`, `ocr_document_confirmed` → completed; `agent_response_delivered`, `whatsapp_message_sent` → value_delivered). CTE evita nested aggregate. Sem etapas órfãs.

### `admin_v2_clients_identity(_masked)`
`user_pseudonyms(user_id uuid, pseudo_id uuid)` e `profiles(id uuid, display_name text)` conferem. `SECURITY DEFINER` permite ler `auth.users` (padrão Supabase Cloud). Auditoria via `platform_admin_audit(actor_user_id, target_user_id, action, meta)` — colunas confirmadas.

### `admin_v2_audit_list`
Colunas de `platform_admin_audit` conferem exatamente (`action text`, `actor_user_id uuid`, `target_user_id uuid`, `meta jsonb`, `created_at timestamptz`). Join com `auth.users` válido em SECURITY DEFINER.

### Grants
Bloco `DO $$ ... $$` itera `pg_proc` de `admin_v2_%` revogando `PUBLIC` e `anon`, e concedendo `EXECUTE` a `authenticated` e `service_role`. `REVOKE ... FROM anon` está dentro de `BEGIN...EXCEPTION WHEN OTHERS THEN NULL` — não quebra se o papel estiver ausente.

## 4. Idempotência e riscos
- Permissões: `ON CONFLICT DO UPDATE` — reaplicável.
- `DROP FUNCTION IF EXISTS ... ()`: alvo único e conhecido.
- `CREATE OR REPLACE FUNCTION`: mantém a mesma assinatura de retorno (`jsonb`) já usada nos consumidores.
- Loop de grants: só depende de `authenticated` e `service_role` (padrão Supabase) — sem risco.
- Sem `INSERT ... ON CONFLICT` que dependa de constraint inexistente.
- Execução parcial pouco provável (uma transação DDL); rollback pelo próprio Postgres se qualquer statement falhar.
- Sem alteração destrutiva de dados. Sem necessidade obrigatória de regenerar `types.ts` (assinaturas RPC já existiam), mas recomendado após aplicar para pegar overloads finais.

## 5. Compatibilidade frontend/backend

| RPC | Retorno da migration | Uso no frontend | Compatível? | Gap |
|---|---|---|---|---|
| `admin_v2_operations_health(_hours)` | `services[]`, `agent{runs,runs_ok,runs_error,success_rate,p50_ms,p95_ms}`, `measurement_started_at`, `timezone`, `formula_version` | `Saude.tsx` (chama sem argumento hoje; passará a default 24h) | Sim | Chamadas sem args continuam válidas (default) |
| `admin_v2_ia_ocr_metrics(_days)` | `totals{...}`, `daily[]`, `source_kind`, `timezone`, `formula_version` | `IaOcr.tsx` | Sim | — |
| `admin_v2_whatsapp_monitor(_days)` | `receipts_available`, `last_inbound_at`, `last_outbound_at`, `totals{...}`, `daily[]` | `operacao/WhatsApp.tsx` (banner já preparado para `receipts_available:false`) | Sim | — |
| `admin_v2_growth_funnel(_days)` | `funnel[]{feature,step,users,events}`, `source_quality{live,backfill,proxy}` | `Crescimento.tsx` | Sim | — |
| `admin_v2_clients_identity(uuid[])` | `clients[]{pseudo_id,display_name,email}` | `Clientes.tsx` (owner/admin) | Sim | — |
| `admin_v2_clients_identity_masked(uuid[])` | `clients[]{pseudo_id,display_name,email}` mascarados | `Clientes.tsx` (support) | Sim | — |
| `admin_v2_audit_list(_limit)` | `events[]`, `instrumentation_started_at`, `formula_version` | `GovernancaAuditoria.tsx` | Sim | — |

## 6. Correções necessárias antes de aplicar
Nenhuma. A migration é aplicável como está.

## 7. Sequência futura de execução (não executar agora)
1. Confirmar sync da `main` (SHA descende de `dbe8e77`).
2. Aplicar apenas `20260724180000_admin_control_center_contract_repair.sql` via ferramenta de migration.
3. Verificar registro em `supabase_migrations.schema_migrations` (`SELECT` da versão).
4. Regenerar tipos Supabase (automático após approve).
5. Smoke tests autenticados como `platform_owner`:
   - `admin_v2_operations_health(24)`
   - `admin_v2_ia_ocr_metrics(30)`
   - `admin_v2_whatsapp_monitor(14)`
   - `admin_v2_growth_funnel(30)`
   - `admin_v2_audit_list(200)`
   - `admin_v2_clients_list(200)` + `admin_v2_clients_identity([...])`
   - `admin_v2_clients_identity_masked([...])` como support
   - Confirmar negação para analyst em `clients.identity.*` e para anon em qualquer `admin_v2_*`.
6. Validar rotas no preview: `/admin/crescimento`, `/admin/inteligencia-produto`, `/admin/operacao/{saude,mensageria,ia-ocr,whatsapp}`, `/admin/clientes`, `/admin/governanca/auditoria` — sem erros de console, sem 4xx/5xx, sem PII indevida, estados vazios honestos, responsividade mobile.
7. Não publicar. Entregar relatório e aguardar autorização.

## 8. Critérios de aceite
- Versão `20260724180000` gravada em `schema_migrations`.
- Nenhum overload duplicado de `admin_v2_operations_health` (`pg_proc` retorna apenas `(_hours integer)`).
- `has_function_privilege('anon', 'public.admin_v2_operations_health(integer)', 'EXECUTE')` = false; `authenticated` = true.
- Todas as 7 RPCs retornam envelope esperado para o owner nos smoke tests.
- Rotas admin abrem sem erro e refletem dados reais (ou estado vazio honesto).

## 9. Decisão final
**`READY_TO_APPLY`** — migration pendente, sem correções necessárias, dependências satisfeitas, sem drift.

---

Esta etapa realizou somente inspeção em Plan Mode. Nenhuma migration foi aplicada. Nenhum código funcional, RPC, tabela, policy, grant, edge function ou configuração foi alterado. Nenhum build, teste, deploy ou publicação foi executado. A aplicação permanece aguardando autorização explícita.
