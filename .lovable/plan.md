
# Rollout pendente do PR #2 — execução consolidada

## Contexto verificado agora
- Arquivo `supabase/migrations/20260724023000_canonical_finance_and_split_delivery_hardening.sql` existe na main (349 linhas) e NÃO foi aplicado ao banco.
- `financial_backfill_checkpoints` e `financial_metric_diffs`: existem, `relrowsecurity = false` → confirma RLS desligada.
- `financial_report_templates` contém apenas `weekly_reflection_v1` (active=true). Faltam `spending_trend`, `monthly_comparison`, `weekly_one_page`.
- `is_behavioral_consumption` já existe (versão anterior sem `financial_daily.v2`) — a migration usa `CREATE OR REPLACE`, então a atualização é idempotente e segura.
- `claim_reminder_jobs` e `claim_reminder_jobs_for_owner` presentes. Cron `split-message-pipeline-1m` ativo e heartbeat saudável (informado pelo usuário e coerente com o estado). Janela 08–22 já removida (confirmado pelas queries anteriores do usuário).
- Frontend na main: `src/pages/DivisaoDoRoleNova.tsx` já usa `dispatchSplitReminders`; `src/lib/split/dispatch.ts` e testes canônicos presentes → apenas Edge Functions + migration faltam ser propagadas.

## Bloqueios / riscos conhecidos antes de executar
- Nenhum bloqueio impeditivo. A migration é aditiva/corretiva e todos os objetos que ela toca já estão em estado compatível (`CREATE OR REPLACE`, `ALTER … ENABLE RLS`, `INSERT … ON CONFLICT`). Vou reconfirmar isso lendo o arquivo inteiro antes de submeter (ver passo 2).
- Não temos permissão de leitura em `supabase_migrations.schema_migrations` via psql da sandbox; a verificação de duplicidade é feita pela ferramenta de migration da Lovable (que registra o arquivo). Isso é aceitável e evita duplicar o arquivo.

## Execução (uma única rodada, sob sua aprovação)

### 1. Validação de histórico e prevenção de duplicidade
- Reutilizar EXATAMENTE o arquivo já versionado `20260724023000_canonical_finance_and_split_delivery_hardening.sql`. Não gerar um novo timestamp.
- Não criar migrations paralelas. A ferramenta Supabase-migration registra o arquivo em `schema_migrations` ao aplicar; se ela detectar que já foi aplicada, aborta sem efeitos.

### 2. Aplicação segura da migration 20260724023000
- Reler o arquivo inteiro (349 linhas) e conferir que cada bloco é idempotente:
  - `ALTER TABLE … ENABLE ROW LEVEL SECURITY` (idempotente).
  - `REVOKE … / GRANT … TO service_role` (idempotente).
  - `CREATE OR REPLACE FUNCTION is_behavioral_consumption`, `refresh_financial_daily_facts` e quaisquer helpers.
  - `INSERT INTO public.financial_report_templates … ON CONFLICT (template_key) DO UPDATE` para `spending_trend`, `monthly_comparison`, `weekly_one_page` e para atualizar `weekly_reflection_v1` se a migration o fizer.
  - Ajustes de `claim_reminder_jobs*` sem a janela 08–22 e com `lease_expires_at = now() + interval '2 minutes'` / `FOR UPDATE SKIP LOCKED`.
- Submeter via ferramenta de migration da Lovable (fluxo de aprovação padrão). Não executar SQL bruto por psql.
- Se algum bloco não for idempotente após a releitura, isolar em `DO $$ … IF NOT EXISTS … END $$` antes de submeter, mantendo o mesmo arquivo.

### 3. Deploy/redeploy de Edge Functions
Somente as que mudaram no PR e dependem de estados do backend acima:
- `split-reminders-dispatch` (usa `claim_reminder_jobs*`, mensagens de reminder 24/7, idempotência `split:{kind}:{participant_id}:{job_id}`).
- `whatsapp-send` (fallback textual determinístico, heartbeat com `mediaFailures`).
- Dependências compartilhadas embarcadas no bundle Deno (não precisam de deploy separado, mas confirmar que foram publicadas junto):
  - `_shared/cors.ts`, `_shared/heartbeats.ts`, `_shared/agent/messageTemplates.ts`, `_shared/messaging/waha.ts`, `_shared/artifacts/*` referenciadas por `artifact-render` (se `artifact-render` mudou, incluir; caso contrário, pular).
- Não redeployar funções não alteradas.

### 4. Confirmação de envio 24/7 e semântica de fila
Após deploy, checar em produção (somente leitura):
- `SELECT prosrc FROM pg_proc WHERE proname='claim_reminder_jobs'` — não deve conter `local_time` nem `make_timestamptz`.
- Idempotência: `SELECT indexdef FROM pg_indexes WHERE tablename='outbound_messages' AND indexdef ILIKE '%idempotency_key%'` (deve existir unique).
- Retry/contagem: `SELECT column_name FROM information_schema.columns WHERE table_name='outbound_messages' AND column_name IN ('attempts','next_attempt_at','claimed_at','lease_expires_at')`.
- Confirmar em código (`whatsapp-send/index.ts`) que o incremento de `attempts` acontece em `claim_outbound_batch` (não duplicar em catch) — validado neste passo por leitura, não por edit.

### 5. Confirmação das fórmulas canônicas
- `SELECT prosrc FROM pg_proc WHERE proname='is_behavioral_consumption'` deve conter: exclusão de `internal_transfer`, `investment_application`, `investment_redemption`, `investment_yield`, `loan_proceeds`; ignorar `p_settles_card_id IS NOT NULL` (fatura); ignorar `status <> 'confirmed'` (planejados); tratar `refund` como `-t.amount` (estorno líquido).
- `SELECT DISTINCT formula_version FROM public.financial_daily_facts` — sem linhas ainda (ok, backfill fora do escopo). O que importa é que a função `refresh_financial_daily_facts` grave `'financial_daily.v2'` quando for chamada.

### 6. RLS/permissões operacionais
- `SELECT relname, relrowsecurity FROM pg_class … WHERE relname IN ('financial_backfill_checkpoints','financial_metric_diffs')` → ambos `t`.
- `SELECT grantee, privilege_type FROM information_schema.role_table_grants WHERE table_name IN ('financial_backfill_checkpoints','financial_metric_diffs')` → apenas `service_role`.

### 7. Templates de relatório
- `SELECT template_key, active FROM public.financial_report_templates` deve retornar 4 linhas:
  - `weekly_reflection_v1` — a migration original define como legado; confirmar se ela o desativa (`active=false`) ou mantém. Se a migration atual não desativa, e a instrução do usuário exige desativar o legado, aplicar SOMENTE no mesmo arquivo antes da submissão (adicionar linha `UPDATE public.financial_report_templates SET active=false WHERE template_key='weekly_reflection_v1';`) — decisão registrada no plano; confirmar comigo se preferir manter ativo.
  - `spending_trend`, `monthly_comparison`, `weekly_one_page` — `active=true`.

### 8. Smoke tests read-only pós-implantação
Executar via `supabase--read_query` (sem escrever nada):
1. Verificações dos passos 4, 5, 6 e 7 acima.
2. `SELECT status, count(*) FROM public.reminder_jobs WHERE created_at > now() - interval '1 day' GROUP BY 1`.
3. `SELECT status, count(*) FROM public.outbound_messages WHERE created_at > now() - interval '1 day' GROUP BY 1`.
4. `SELECT job_key, ok, processed, failed, updated_at FROM public.job_heartbeats WHERE job_key IN ('split-reminders-dispatch','whatsapp-send') ORDER BY updated_at DESC LIMIT 4`.
5. `SELECT count(*) FROM public.financial_metric_diffs` (deve ser 0, backfill fora do escopo).

### 9. Rollback seguro
- **Migration**: não usar `DROP`. Se algum objeto novo introduzir regressão, criar migration corretiva subsequente (`CREATE OR REPLACE` da função à versão anterior + `UPDATE financial_report_templates SET active=false` nos três novos). Nunca reverter RLS on→off nem apagar `financial_daily_facts`.
- **Edge Functions**: manter cópia do bundle anterior; em caso de regressão, `supabase--deploy_edge_functions` da versão prévia do arquivo (git checkout do commit anterior localmente e redeploy). Não é preciso rollback de banco para desfazer o redeploy.
- **Cron**: nenhum cron novo é criado; se necessário, `SELECT cron.unschedule('split-message-pipeline-1m')` fica disponível como último recurso.

## O que este plano NÃO faz
- Não altera design, não cria funcionalidades novas.
- Não modifica dados financeiros de usuários (sem UPDATE em `transactions`, `accounts`, etc.).
- Não liga feature flags de rollout (`use_canonical_financial_snapshot` permanece off).
- Não executa backfill de `financial_daily_facts` / `financial_current_snapshots`.
- Não publica frontend.

## Pergunta única antes de implementar
Confirmar se devo **desativar `weekly_reflection_v1`** (passo 7) na mesma submissão da migration, ou manter os quatro templates ativos até você decidir. Sem a resposta, mantenho os quatro ativos e você só ativa/desativa manualmente depois.
