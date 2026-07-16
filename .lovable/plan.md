
# Fechamento Funcional do Beta — NoControle.ia

Plano organizado por dependências. Implementação nesta mesma rodada após aprovação/continuação automática. Sem publicação. Não reescreve agente LLM, WAHA, auth nem núcleo financeiro — apenas usa/estende.

## 1. Migrations (uma única migration incremental)

Novas tabelas (todas com RLS estrita por `auth.uid()`, GRANTs para authenticated/service_role, `updated_at` trigger onde aplicável):

- `shared_expenses` — owner_user_id, title, description, total_amount numeric(14,2), occurred_at, due_date, split_mode (enum equal|custom), linked_transaction_id, reminder_enabled bool, status (draft|active|settled|cancelled), pix_key text (crypt-safe), timestamps.
- `shared_expense_participants` — shared_expense_id, name, phone_e164, phone_masked (generated), amount_due, amount_paid default 0, status (pending|notified|partial|paid|waived|opted_out), last_reminded_at, reminder_count int default 0, paid_at, opt_out_at.
- `shared_expense_events` — audit trail (created/updated/paid/reminded/settled).
- `reminder_jobs` — shared_expense_id, participant_id, scheduled_for, status (queued|sent|failed|skipped), attempts, last_error, quiet_hours_respected. Consumido pela outbox existente.
- `recurring_rules` — user_id, kind (income|expense), name, amount, account_id, category_id, frequency (daily|weekly|monthly|yearly), day_of_month, weekday, start_date, end_date, status (active|paused|finished), last_generated_at.
- `recurring_occurrences` — recurring_rule_id, user_id, due_date, status (planned|confirmed|skipped), transaction_id, UNIQUE(recurring_rule_id, due_date) para idempotência.
- `challenges_catalog` — slug, title, description, kind (spending_log|goal_contribution|emotion_checkin|pre_spend_review|custom), goal_value, duration_days, xp_reward, active bool. (Admin-gerenciada, leitura pública para authenticated.)
- `user_challenges` — user_id, challenge_slug, status (active|paused|completed|abandoned), started_at, completed_at, current_progress, streak_count, last_progress_at.
- `xp_events` — user_id, source_type, source_id, xp_delta, reason, occurred_at, UNIQUE(user_id, source_type, source_id) para idempotência.
- `user_gamification` — user_id PK, total_xp, level (derivado), current_streak, longest_streak.
- `notifications` — user_id, type (agent_confirmation|recurrence_due|goal_reached|split_reminder|import_done|achievement), title, body, action_url, read_at, dedup_key UNIQUE(user_id, dedup_key).
- `notification_preferences` — user_id PK, por tipo (bool).
- `data_exports` / `account_deletion_requests` — solicitações do usuário com status.

Extensões:
- `transactions.origin` (enum manual|agent|import|recurring|split) + `import_source_id`.
- `emotional_checkins` já existe; adicionar índice por `(user_id, occurred_at)`.

RPCs `SECURITY DEFINER`:
- `split_create`, `split_add_payment`, `split_reverse_payment`, `split_send_reminders` (gera reminder_jobs respeitando cooldown/quiet hours).
- `recurring_generate_due(p_user_id)` — idempotente via UNIQUE.
- `challenge_progress_add(user_id, slug, delta, source_type, source_id)` — usa `xp_events` para dedup.
- `notify_upsert(user_id, type, dedup_key, ...)` — idempotente.
- `user_export_data()` retorna JSON completo do usuário; `user_request_deletion()` marca solicitação.
- `admin_dashboard_stats_v2()` estende métricas.

## 2. Arquivos a criar

Frontend:
- `src/pages/DivisaoDoRole.tsx` (listagem+filtros)
- `src/pages/DivisaoDoRoleDetalhe.tsx` (detalhe/pagamentos/eventos)
- `src/pages/DivisaoDoRoleNova.tsx` (wizard 3 passos)
- `src/pages/Recorrencias.tsx` + `RecorrenciaForm.tsx`
- `src/pages/Relatorios.tsx` (reescrito)
- `src/pages/Desafios.tsx` + `DesafioDetalhe.tsx`
- `src/pages/Notificacoes.tsx`
- `src/components/NotificationBell.tsx` (header)
- `src/pages/admin/AdminDivisao.tsx`, `AdminDesafios.tsx`, `AdminReminderJobs.tsx`
- `src/lib/split/math.ts` (divisão com centavo residual)
- `src/lib/import/csv.ts`, `src/lib/import/ofx.ts`, `src/lib/import/legacy.ts`
- `src/lib/recurring/schedule.ts` (próximas ocorrências, fev/dia-31)
- `src/lib/reports/aggregations.ts`
- `src/lib/notifications/generate.ts`
- `src/lib/emotions/correlations.ts` (com min-sample)
- `src/lib/gamification/rules.ts`

Edge Functions:
- `supabase/functions/split-reminders-dispatch/` — cron-friendly, consome `reminder_jobs`, respeita quiet hours BR e enfileira em `outbound_messages`.
- `supabase/functions/recurring-generate/` — gera occurrences futuras/passadas até hoje.
- `supabase/functions/user-data-export/` — retorna zip/json.
- `supabase/functions/user-delete-account/` — orquestra exclusão.

Testes (`src/test/`):
- `split-math.test.ts` (igual/custom, centavo residual, soma exata)
- `import-legacy.test.ts` (fixture representativa financial_ecosystem_v2)
- `import-csv.test.ts` (datas/valores BR, header mapping)
- `import-ofx.test.ts` (FITID dedup)
- `recurring-schedule.test.ts` (fev, dia 31, timezone SP, no-duplicate)
- `emotions-correlations.test.ts` (amostra mínima → "insuficiente")
- `gamification.test.ts` (idempotência XP)
- `notifications-dedup.test.ts`
- `reports-aggregations.test.ts`

Fixture: `src/test/fixtures/financial_ecosystem_v2.json` com todas as chaves reais (lancamentos, metas, aportes, dividas, investimentos, emocoes, contasFixas, config, categoriasCustom).

## 3. Arquivos a alterar

- `src/App.tsx` — novas rotas lazy.
- `src/pages/MaisMenu.tsx` — links Divisão, Recorrências, Desafios, Relatórios, Importar.
- `src/components/AppLayout.tsx` / `DesktopSidebar.tsx` — NotificationBell no header.
- `src/pages/Emocoes.tsx` — cruzamento factual + amostra mínima.
- `src/pages/Importar.tsx` — abas Legado / CSV / OFX, dry-run, preview, relatório.
- `src/pages/Perfil.tsx` — export, exclusão, preferências de notificação, vínculo WhatsApp.
- `src/pages/admin/Agente.tsx` — link para métricas novas.
- `supabase/functions/_shared/agent/tools.ts` — tools `create_split_draft`, `list_split_pending` (draft-only, sem persistir).
- `index.html` — meta tags NoControle.ia se ainda houver Mindful Money.

## 4. Fluxos e regras críticas

**Divisão do Rolê:** wizard captura → revisão → ativar. Divisão igual usa `floor(total/n)` e distribui resíduo (centavos) ao criador primeiro, depois ordem alfabética; regra visível na UI. Custom valida soma == total. Lembretes só após ação explícita do owner; cooldown 24h/participante, máx N=5, quiet hours 22:00–08:00 America/Sao_Paulo, opt-out link com token. Sem WAHA: reminder_jobs marca `skipped` motivo `provider_not_configured` e UI mostra badge "Envio indisponível". Telefones completos apenas server-side; UI mostra `phone_masked`.

**Importação legado:** parser dedicado em `lib/import/legacy.ts` que reconhece as chaves reais (`lancamentos`, `metas`, `aportes`, `dividas`, `investimentos`, `emocoes`, `contasFixas`, `config`, `categoriasCustom: string[]`) e mapeia enums pt→en (`receita`→income, `despesa`→expense). Dry-run → preview por entidade com contagem, incompatibilidades por linha, hash dedup. Só após confirmação: chama `import_legacy_batch`. Conta "Dados importados" criada apenas se necessário e após consentimento.

**CSV/OFX:** parser client-side (papaparse já disponível; OFX regex simples baseada em SGML). Limite 5MB. Preview + column mapping (CSV) / preview parsed (OFX). Dedup por hash `(account_id, occurred_at, amount, description)` + FITID quando OFX. Confirmação explícita antes de persistir via RPC `import_transactions_batch`.

**Recorrências:** UI cria regra → `recurring-generate` (chamada manual "Processar agora" ou cron) cria `recurring_occurrences` com status `planned` até hoje+30d. Confirmar planned cria `transaction` origin=recurring. Timezone SP; fev/dia-31 → último dia do mês. UNIQUE(rule_id, due_date) impede duplicação.

**Relatórios:** agregações em `lib/reports/aggregations.ts` com dados reais de `transactions`, `goals`, `investments`, `debts`, `recurring_occurrences`. Zero projeção fabricada; recorrências futuras rotuladas "planejado". Exportar CSV filtrado; print via `@media print`.

**Desafios:** seed em migration com 4 desafios iniciais. Progresso via triggers/RPC: cada `transaction`/`goal_contribution`/`emotional_checkin` chama `challenge_progress_add`. `xp_events` UNIQUE evita duplicação. Streak em SP. UI mostra progresso, XP, nível (`floor(sqrt(xp/100))`).

**Emoções:** correlação = agrupamento factual (`GROUP BY mood, category`), mínimo 5 amostras para exibir; senão "amostra insuficiente". Sem linguagem causal.

**Notificações:** geradas por gatilhos (pending_confirmations INSERT, recurring_occurrences próximas 3 dias, goal atingida, split reminder scheduled, import concluído, achievement). `dedup_key` idempotente. Bell no header com badge count.

**Perfil:** export JSON via edge function retorna dump completo; exclusão marca `account_deletion_requests` e chama função que apaga rows do usuário (retenção mínima: logs de auditoria anonimizados).

## 5. Riscos de segurança

- RLS Divisão: proprietário vê tudo; participantes NUNCA acessam o app; opt-out via token não-adivinhável (hash com constant-time compare).
- Pix key: nunca em logs; masked na UI de terceiros.
- Import: validação Zod antes de persistir; sem eval de conteúdo do arquivo; tamanho máximo.
- Gamificação: XP só via RPC SECURITY DEFINER; usuário não faz UPDATE em `xp_events`/`user_gamification`.
- Exclusão de conta: confirmação com digitação de "EXCLUIR MINHA CONTA".
- Admin: `is_current_user_admin()` server-side; nenhuma PII de participantes de terceiros exposta.

## 6. Testes e critérios de aceite

Executar `bun test` + `tsgo` + `bun run build`. Critérios:
- Divisão igual R$100/3 → 33,34/33,33/33,33; custom soma exata; pagamento parcial atualiza saldo; desfazer volta status; lembrete sem WAHA marca skipped.
- Import fixture legado insere todas as entidades sem duplicar em segunda execução.
- CSV BR (`01/02/2026;R$ 1.234,56`) parseia; OFX FITID dedup.
- Recorrência mensal dia 31 em fev gera 28/29; reprocessar não duplica.
- Relatórios refletem transações reais; sem transações → empty state.
- 5 emoções de mesma categoria → mostra correlação; 4 → "insuficiente".
- XP não duplica ao reexecutar `challenge_progress_add` com mesmo source.
- Notificação com mesmo `dedup_key` não duplica.
- Dois usuários: SELECT cruzado retorna 0 rows.

## 7. Ordem de implementação

1. Migration única com todas as tabelas/RPCs/seeds/GRANTs/RLS. (bloqueia tudo)
2. Types regenerados → `src/lib/import/legacy.ts` + fixture + teste.
3. `src/lib/split/math.ts` + testes.
4. Páginas Divisão do Rolê (lista/nova/detalhe) + RPCs.
5. Edge function `split-reminders-dispatch` + integração outbox.
6. Recorrências (lib + página + edge function).
7. Importar.tsx reescrito com 3 abas.
8. Relatórios reescritos.
9. Desafios + gamification lib + página + seed + triggers.
10. Emoções: correlations + UI.
11. Notificações: geração + bell + página + preferências.
12. Perfil: export/exclusão/preferências.
13. Admin: métricas + catálogo desafios + reminder_jobs viewer.
14. Agent tools split (draft-only).
15. Testes finais + build + typecheck.

## 8. Estimativa relativa de créditos

Alta. Rodada grande (~30–40 arquivos novos, 1 migration extensa, 4 edge functions, ~10 arquivos de teste). Usuário autorizou consumir o necessário. Sem pausas por orçamento.

## Detalhes técnicos

- Todas as novas tabelas em `public` seguem o padrão: `CREATE TABLE` → `GRANT SELECT,INSERT,UPDATE,DELETE ... TO authenticated; GRANT ALL ... TO service_role;` → `ENABLE ROW LEVEL SECURITY` → `CREATE POLICY`.
- Lazy-load todas as novas rotas.
- Zod schemas em `src/lib/validation/` para cada entidade nova.
- Toasts via `sonner`.
- Nenhum novo pacote pesado; usar `papaparse` (já presente ou add leve) para CSV; OFX via parser próprio.
- Design tokens existentes; sem cores hardcoded.
