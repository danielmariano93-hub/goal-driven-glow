# Patch Consolidado — Fatias B a J (execução única)

Fatia A (hardening de telefone) já está em produção. Este plano executa as demais fatias do patch consolidado em ordem segura, com testes e deploys por bloco.

## B. Entrega semântica (ACK + watchdog)

**Objetivo:** distinguir `queued → sent → delivered → read → failed` e reagir a ACKs travados.

- Migration aditiva:
  - `outbound_messages`: adicionar `accepted_at timestamptz`, `delivered_at timestamptz`, `read_at timestamptz`, `last_ack_at timestamptz`, `ack_state text check in ('queued','accepted','sent','delivered','read','failed')`, `retry_count int default 0`.
  - Índice parcial `(ack_state, sent_at)` para watchdog.
- `_shared/messaging/waha.ts`: mapear callbacks WAHA (`ack=1,2,3,-1`) para os novos estados via `updateAckState()`.
- Nova função `whatsapp-ack-watchdog`:
  - Roda a cada 5 min via `pg_cron`.
  - Reprocessa mensagens `sent` sem `delivered_at` há > 10 min (retry até 2x, depois `failed` + alerta).
- `split-reminders-dispatch`: consultar `ack_state != 'failed'` para idempotência real.
- Testes: `waha-ack-mapping.test.ts`, `ack-watchdog.test.ts`.

## C. Pipeline 24/7 + idempotência de reenvio manual

- Auditar `split-reminders-dispatch`, `reminder-dispatcher` e queries associadas: remover qualquer filtro por `local_time` / hora do dia (já parcialmente feito no PR#2 — reconfirmar).
- Reenvio manual (`POST /split/:id/remind`): chave de idempotência `(shared_expense_id, participant_id, day_bucket)` em `idempotency_keys` com TTL 24h.
- Rate-limit por participante: máx 1 lembrete a cada 6h, exceto ação explícita do dono.
- Testes: `split-reminder-idempotency.test.ts`.

## D. Fundação canônica — dual-read + backfill

- Migration:
  - `financial_backfill_checkpoints` (já existe): adicionar coluna `phase text` (`baseline|backfill|dual_read|cutover`).
  - Função `run_financial_backfill(batch_size int, since date)`: itera transações → recomputa `financial_daily_facts`/`financial_daily_category_facts` v2 → grava diffs em `financial_metric_diffs`.
- Edge Function `finance-backfill-runner` (cron a cada 15 min): processa 1 lote, atualiza checkpoint, para quando `remaining=0`.
- Dual-read no motor analítico (`_shared/analytics/facts.ts`):
  - Feature flag `financial.canonical_read` (via `financial_feature_flags`).
  - Quando ativa, ler canônico + comparar contra legado; divergência > 1 centavo grava em `financial_metric_diffs` e retorna legado.
- Painel admin: card "Divergências financeiras (últimas 24h)" lendo `financial_metric_diffs`.
- Cutover manual: quando divergências = 0 por 48h, flip da flag.
- Testes: `backfill-idempotency.test.ts`, `dual-read-parity.test.ts`.

## E. Templates + gráficos (integração real no roteador)

- `AgentCore/IntentRouter.ts`: rotas explícitas para `spending_trend`, `monthly_comparison`, `weekly_one_page` → carregam template de `financial_report_templates` e chamam motor com params validados (Zod).
- `_shared/analytics/charts/*`: garantir `curve: 'monotone'` em todas as séries temporais (Recharts + Satori/canvas PNG).
- `AssessorPanel.tsx` + `ChartArtifactRenderer.tsx`: renderer único; WhatsApp continua via `artifact-render`.
- Fallback determinístico se motor falhar: texto tabelado (já existe) + telemetria `chart_fallback_used`.
- Testes: `report-templates-routing.test.ts`, `chart-curve-monotone.test.ts`.

## F. Redeploy coordenado

Após B–E aplicados, redeploy destas 6 funções (compartilham `_shared/`):
`agent-chat`, `whatsapp-webhook`, `whatsapp-send`, `split-reminders-dispatch`, `artifact-render`, `assistant-ingest-document`.

Um único `supabase functions deploy` por lote, verificando heartbeats depois.

## G. Reconciliação de migrations

- Auditar `supabase/migrations/` vs `supabase_migrations.schema_migrations`.
- Para timestamps divergentes já aplicados: adicionar a `.lovable/migration-reconciliation.md` como registro; **não** renomear arquivos aplicados.
- Novas migrations deste patch usam timestamps monotônicos a partir de `20260724030000`.

## H. Segurança (SECURITY DEFINER, search_path, RLS)

- Rodar `supabase--linter` e revisar cada função `SECURITY DEFINER`:
  - Garantir `SET search_path = public, pg_temp` explícito.
  - Confirmar que o dono é o role de serviço.
- RLS: verificar tabelas operacionais criadas pelo PR#2 (`financial_backfill_checkpoints`, `financial_metric_diffs`, `idempotency_keys`, `job_heartbeats`) — todas com RLS e grants alinhados ao uso (service_role only ou authenticated read).
- Adicionar política de leitura restrita a `platform_admins` para `financial_metric_diffs` no painel admin.

## I. Suíte de testes

Além dos testes por fatia, criar/atualizar:
- `src/test/phone.test.ts` (existe) — cobrir edge cases DDD 0/9.
- `src/test/waha-contract.test.ts` — payloads sendText/sendImage validados.
- `src/test/financial-parity.test.ts` — legado vs canônico em fixtures.
- `src/test/rls-permissions.test.ts` — smoke via `supabase.rpc` autenticado como `authenticated`/`anon`.

Meta: manter suíte verde (atual 518/518) + ~40 novos casos.

## J. Critérios de aceite

Checklist verificável antes de fechar:
- [ ] `outbound_messages.ack_state` populado em 100% das mensagens novas por 24h.
- [ ] Watchdog reprocessa e loga; nenhum registro `sent` > 30 min sem transição.
- [ ] Reenvio manual duplicado retorna 409 idempotente.
- [ ] `finance-backfill-runner` conclui backfill histórico; `financial_metric_diffs` estabiliza em 0 divergências por 48h.
- [ ] Feature flag `financial.canonical_read` ligada em produção sem regressão.
- [ ] Rotas de template geram gráfico real no App e PNG no WhatsApp com curva monotone.
- [ ] 6 funções redeployadas e heartbeat verde.
- [ ] Linter Supabase sem warnings novos.

## Ordem de execução (uma rodada, com gates)

1. Migration B (ACK) + código WAHA + watchdog + testes.
2. C: idempotência de reenvio + testes.
3. Migration D (backfill infra) + runner + dual-read atrás de flag OFF + testes.
4. E: rotas de template + curvas + testes.
5. F: redeploy coordenado das 6 funções.
6. Verificação de heartbeats + linter (H) + reconciliação G.
7. Ativar backfill runner (D fase 2). Monitorar 24h.
8. Ligar flag `financial.canonical_read` após 48h de divergências zero.

## Arquivos afetados (resumo)

- Migrations novas: `20260724030000_ack_semantics.sql`, `20260724030500_backfill_infra.sql`, `20260724031000_security_hardening.sql`.
- Code: `_shared/messaging/waha.ts`, `_shared/analytics/facts.ts`, `_shared/analytics/charts/*`, `AgentCore/IntentRouter.ts`, `AssessorPanel.tsx`, `ChartArtifactRenderer.tsx`.
- Novas funções: `whatsapp-ack-watchdog`, `finance-backfill-runner`.
- Admin: card de divergências.
- Testes: ~5 novos arquivos.

## Riscos e mitigação

- **Backfill pesado:** batch pequeno (500 linhas) + checkpoint + cron 15 min; abortável.
- **Flip da flag canônica:** só após 48h com diffs=0; rollback = desligar flag.
- **Redeploy simultâneo:** validar heartbeat função a função antes da próxima.
- **ACK do WAHA instável:** watchdog garante convergência; estado `failed` alerta admin.
