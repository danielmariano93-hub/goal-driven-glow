## Plano — Fatias finais: Backfill Runner + Rotas de templates

Encerra o rollout do PR #2. Duas frentes cirúrgicas.

### 1) Fatia D fase 2 — `finance-backfill-runner`
Nova Edge Function que executa o backfill canônico em lotes idempotentes, usando a coluna `phase` já existente em `financial_backfill_checkpoints`.

- `supabase/functions/finance-backfill-runner/index.ts`:
  - Autenticação via header `x-internal-secret` = `INTERNAL_CRON_SECRET` (mesmo padrão de `split-reminders-dispatch`).
  - Loop por `user_id` pendente:
    - `phase='baseline'` → recalcula `financial_daily_facts` + `financial_daily_category_facts` para o intervalo do checkpoint em lotes de 30 dias, avança `phase='backfill'`.
    - `phase='backfill'` → aplica `is_behavioral_consumption` v2 sobre `transactions` do usuário no intervalo, marca `phase='dual_read'`.
    - `phase='dual_read'` → compara agregados canônicos vs. legado (grava `financial_metric_diffs` se divergir >R$0,01), se sem diffs marca `phase='cutover'`.
  - Timebox de 25s por invocação (poll do cron), `EdgeRuntime.waitUntil` para persistir heartbeat.
  - `job_heartbeats.job_key='finance-backfill-runner'` com `processed/failed/last_ok`.
- Sem cron novo agendado (evita mexer em `pg_cron` sem necessidade); a função fica disponível para invocação manual/curl e para agendamento futuro. Documentado em `.lovable/migration-reconciliation.md`.

### 2) Fatia E parte 2 — Rotas Zod de templates no roteamento visual
Não vamos inflar o `IntentRouter.ts` (que é hoje apenas um wrapper); vamos adicionar as rotas onde o `generate_chart_artifact` já é acionado, mantendo o prompt como fonte de verdade e um fallback determinístico.

- `supabase/functions/_shared/agent/templates/reportTemplates.ts` (novo):
  - Schema Zod para cada `template_key`: `spending_trend`, `monthly_comparison`, `weekly_one_page`.
  - `matchTemplate(text)` retorna `{ template_key, params }` por regex determinística (tendência/evolução → `spending_trend`; "compara"/"vs mês passado" → `monthly_comparison`; "one page"/"resumo semanal" → `weekly_one_page`).
  - `buildArtifactFromTemplate(userId, template_key, params)` chama os motores existentes (`analytics/timeseries`, `analytics/compare`, `analytics/dailyAverage`) e devolve um `ChartArtifact`.
- `supabase/functions/_shared/agent/tools.ts` (`generate_chart_artifact`):
  - Antes do LLM escolher `kind`, tenta `matchTemplate` no texto original; se casar e template `active=true` em `financial_report_templates`, usa `buildArtifactFromTemplate` (bypass determinístico). Caso contrário, mantém o comportamento atual.
- `AppAdapter.ts` / `WhatsAppAdapter.ts`: sem mudança — o artefato já flui pelo mesmo canal.

### Testes
- `src/test/backfill-runner.test.ts`: unit da máquina de estados (`baseline→backfill→dual_read→cutover`), com mock do supabase client.
- `src/test/report-templates.test.ts`: `matchTemplate` para as 3 chaves + negativos (não deve casar frases genéricas como "quanto gastei").
- Reexecução completa do vitest (esperado 528+5 = 533 passes).

### Deploy e verificação
- Deploy: `finance-backfill-runner` (novo) + redeploy de `agent-chat` (usa `tools.ts` alterado).
- `curl` no runner com `x-internal-secret` para 1 usuário de teste → confere `financial_metric_diffs` sem linhas novas e `phase='cutover'`.
- Verificação manual dos 3 templates por texto ("mostra evolução dos meus gastos", "compara com o mês passado", "me dá um one page da semana") — cada um deve gerar `ChartArtifact` pelo caminho determinístico (sem custo LLM).

### Fora de escopo
- Não altera schema (colunas `phase`, tabelas de fatos e templates já existem).
- Não agenda cron novo.
- Não mexe em RLS, prompts do agente ou UI.
- Não altera migrations já aplicadas.
