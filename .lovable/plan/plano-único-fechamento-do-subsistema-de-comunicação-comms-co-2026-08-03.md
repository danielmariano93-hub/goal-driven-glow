# Plano único — Fechamento do Subsistema de Comunicação (`comms_contract.v2`)

## 1. Diagnóstico verificado agora (banco + código)

A rodada anterior do `comms_contract.v1` já está no ar e resolveu boa parte do escopo. Verificado hoje:

- **Motor proativo:** `ProactiveEngine.ts` e `ProactiveEngineV2.ts` já usam `started_at` em `agent_runs`. As demais ocorrências de `created_at` no arquivo são de outras tabelas (`emotional_checkins`, `xp_events`, `document_imports`), legítimas.
- **Schema de `reminder_jobs`:** já tem `policy_version`, `retry_count`, `next_attempt_at`, `deliver_after`, `delivery_status`, `sent_at`, `delivered_at`, `read_at`, `cancel_reason`, `superseded_by`.
- **Contadores do participante:** já existem `attempts`, `queued_count`, `sent_count`, `delivered_count`, `read_count`, `last_attempted_at`, `last_sent_at`, `last_delivered_at`, `communication_status`. O trigger `trg_sync_reminder_delivery` em `outbound_messages` já propaga o estado real.
- **Funções transacionais:** `apply_split_reminder_policy`, `reconcile_split_reminder_jobs`, `admin_reconcile_split_reminders` e `schedule_split_due_reminders` existem.
- **`user_insights`:** já tem `formula_version`, `as_of`, `validity_until`, `eligible_channels`, `logical_dedup_key`, `source_snapshot_id`.
- **Caso Festival/Frasao — RESOLVIDO.** O participante segue `pending` (R$ 135,31, telefone `+55…7091`), e há dois jobs `due_today` com `delivery_status = delivered`, `delivered_count = 2`, `last_delivered_at = 03/08 14:40Z`. Nenhum reenvio é necessário; o plano abaixo apenas evita duplicação futura.

Lacunas que **permanecem abertas** (foco desta rodada):

1. **Dois consumidores da fila.** `split-reminders-dispatch-v2` ainda chama `whatsapp-send` por HTTP (linha 438) além do cron `whatsapp-send-dispatch-1m`.
2. **Job `overdue` duplicado para o mesmo horário.** Frasao tem dois jobs `overdue` em `2026-08-04 12:00Z`: um `skipped/participant_replied` e um `queued`. O índice parcial permite isso porque só cobre estados vivos, mas a régua de política pode gerar par redundante `queued` + `skipped` no mesmo slot.
3. **Insight canônico não consumido de ponta a ponta.** `insights-generate` não grava `logical_dedup_key`, `formula_version`, `as_of` nem `eligible_channels`, então Home e motor proativo continuam podendo divergir.
4. **Relatório × revisão semanal ainda podem duplicar.** O cron `financial-reports-weekly` (seg 10:00) notifica com `dedup_key = financial_report:<id>`, enquanto o estágio `advisor` e a sugestão “revisão semanal” usam chaves próprias.
5. **Telemetria por estágio incompleta.** Os `*_tick` gravam heartbeat pelo sucesso do `net.http_post`; as Edge Functions gravam apenas ok/erro, sem os estágios do ciclo.
6. **Segredo de cron divergente.** Nas migrations coexistem `INTERNAL_CRON_SECRET` (14), `meunino_cron_secret` (17) e `nocontrole_cron_secret` (13).
7. **Sem cron de reconciliação.** `reconcile_split_reminder_jobs` existe mas nenhum job do `cron.job` a executa periodicamente.
8. **Sem teste de contrato de schema.** Nada impede uma nova consulta a coluna inexistente.

## 2. Causas raiz remanescentes

- Produtor da fila com atalho de entrega (wake-up direto) mantido por conveniência.
- Chaves de deduplicação definidas por superfície, não por comunicação lógica.
- Heartbeat medindo o disparo do cron, não o resultado do trabalho.
- Ausência de verificação automatizada de colunas usadas contra `information_schema`.

## 3. Execução (uma única rodada)

### Migration A — `comms_contract.v2`
- `communication_deliveries`/`notifications`: garantir `logical_dedup_key` + índice único parcial por `(user_id, logical_dedup_key)` em janela de período, para relatório, revisão e sugestão colidirem em uma só comunicação.
- `reminder_jobs`: índice único parcial adicional por `(shared_expense_id, participant_id, kind, date(scheduled_for))` restrito a estados vivos, impedindo par redundante no mesmo slot; `schedule_split_due_reminders` e `apply_split_reminder_policy` passam a `ON CONFLICT … DO UPDATE`.
- `job_heartbeats`: coluna `stages jsonb` (contadores por estágio: `request_enqueued → generated → persisted → eligible → scheduled → queued → provider_accepted → sent → delivered → read → clicked → failed → dismissed → useful/not_useful`).
- Padronização do segredo: todas as funções `*_tick` passam a resolver `INTERNAL_CRON_SECRET` primeiro, com os dois nomes legados como alias e `RAISE NOTICE` quando o alias for usado.
- Novo cron `split-reminders-reconcile-15m` chamando `reconcile_split_reminder_jobs()`.

### Migration B — funções
- `reconcile_split_reminder_jobs()`: passa a também colapsar slots duplicados (mantém o job vivo, marca o irmão como `superseded_by`) e a retornar cobertura por participante.
- Gatilhos de reconciliação: ao criar/editar rolê, ao mudar política e ao registrar pagamento (já cobertos por `split_update`/`split_cancel`/pagamento — revisar e completar as chamadas ausentes).
- `insights_upsert_canonical(...)`: função única usada por `insights-generate` e pelo motor proativo, gravando `type`, `facts`, `evidence`, `formula_version`, `as_of`, `validity_until`, `eligible_channels`, `logical_dedup_key`, `source_snapshot_id`.

### Código
- `split-reminders-dispatch-v2`: remover a chamada HTTP a `whatsapp-send`; produtor apenas enfileira em `outbound_messages`. `whatsapp_send_dispatch_tick` fica o único consumidor. O campo `outbound_kicked` do contrato passa a refletir “fila acordada pelo cron”, mantendo a resposta compatível com `src/lib/split/dispatch.ts`.
- `insights-generate`: passa a usar `insights_upsert_canonical`, com `logical_dedup_key` por tipo+período e `eligible_channels` vindos do `communication_catalog`.
- `financial-reports-generate` + estágio `advisor` + sugestão “revisão semanal”: uma única `logical_dedup_key` por período (`weekly_review:<user>:<iso_week>`), uma notificação e destino único `/app/assessor/acompanhamento`.
- `_shared/heartbeats.ts`: aceitar `stages` e mesclar por `job_key`; cada Edge Function final grava o próprio `job_key` com os estágios reais.
- Novo `_shared/intelligence/schemaContract.ts`: mapa declarado de tabela → colunas consultadas pelo motor de comunicação.

### UI e Admin
- `DivisaoDoRoleDetalhe`: exibir “próxima tentativa prevista” e “telefone inválido” além dos estados já implementados de entrega/leitura; manter separação `payment_status` × `communication_status`.
- `SplitReminderJourney` (admin): coluna de cobertura por participante, motivo real de bloqueio, distinção `deferred` × `dismissed`, e heartbeats por estágio.

### Correção de dados
1. Colapsar os slots duplicados existentes de `reminder_jobs` (caso `overdue 04/08 12:00Z` do Frasao) preservando auditoria via `superseded_by`.
2. Backfill de `logical_dedup_key` em `user_insights`, `notifications` e `communication_deliveries` a partir de tipo + período.
3. Backfill de `job_heartbeats.stages` com os contadores conhecidos (sem inventar histórico ausente).
4. Nenhum reenvio para o caso Frasao: os lembretes de 03/08 estão `delivered`; o reparo é apenas anti-duplicação. Copy do lembrete permanece a aprovada: “Oi, Frasao! Passando só para lembrar da sua parte de R$ 135,31 do Festival 💛 / Se você já tiver feito o pagamento, pode desconsiderar esta mensagem e avisar o Daniel para ele atualizar por lá. / Se ainda não, os dados do Pix estão no link do rolê.”

### Regras consolidadas (reafirmadas e testadas)
- **Retentativa:** backoff exponencial com `retry_count` limitado; `ack` desconhecido não gera reenvio imediato; falha terminal avisa o dono no app.
- **Idempotência:** `idempotency_key` no job + `logical_dedup_key` na comunicação; reprocessar um tick nunca duplica entrega.
- **Canal:** definido pelo `communication_catalog` (tipo, sensibilidade, severidade, preferência, consentimento), nunca só por severidade.
- **Audiência:** exclui `is_test`, sandbox, contas em exclusão, onboarding incompleto e sem dados mínimos; rotação justa por `last_proactive_scan_at`; perfis de teste só em `dry_run` com flag admin.
- **Quiet hours:** timezone do usuário → `profiles.timezone` → `America/Sao_Paulo`; bloqueio temporário vira `deferred + next_attempt_at`.
- **Frequência:** cap por comunicação lógica, não por entrega de canal.
- **Janela de recuperação:** `due_today` até o fim do dia local, `overdue` por N dias configuráveis, `invite`/`payment_confirmation` imediatos; fora da janela → alerta ao dono, sem envio tardio.

### Testes (somados aos 964 atuais)
Contrato de schema (`agent_runs` e demais colunas consultadas); slot duplicado é colapsado e não bloqueia; um único consumidor da fila (produtor não chama `whatsapp-send`); relatório + revisão + sugestão geram uma só comunicação por período; insight idêntico em Home, app e WhatsApp; heartbeat reflete estágio real; alias de segredo de cron aceito e sinalizado; contador só sobe em `sent`/`delivered`/`read`; participante pago cancela futuros; rolê cancelado não envia; erro de um usuário não interrompe os demais; idempotência de reprocessamento; concorrência e lease; layout mobile.

## 4. Ordem de implantação
1. Migration A (schema, índices, cron, segredo).
2. Migration B (funções e reconciliador).
3. Código das Edge Functions e do frontend.
4. Correção de dados e backfills.
5. Suíte de testes + typecheck.
6. Deploy das Edge Functions: `split-reminders-dispatch-v2`, `whatsapp-send`, `whatsapp-ack-watchdog`, `agent-proactive-tick`, `insights-generate`, `financial-reports-generate`.
7. Publicação do frontend somente após validação (com sua autorização explícita).

## 5. Validação pós-deploy e aceite
- `agent-proactive-tick` com `last_tick_errors` vazio e ao menos uma entrega registrada.
- `reconcile_split_reminder_jobs()` retornando `participants_without_job = 0` e `conflicts = 0`.
- Nenhum `reminder_jobs` vivo duplicado no mesmo slot.
- Uma única comunicação por `logical_dedup_key` e período para relatório/revisão.
- `job_heartbeats` com estágios preenchidos por Edge Function, não pelo cron.
- Frasao segue `pending` sem novo envio duplicado; UI do dono mostra “Entregue no WhatsApp”.

## 6. Rollback
Cada migration acompanha bloco reverso (drop dos índices novos, restauração das funções na versão anterior via `CREATE OR REPLACE`); a remoção do wake-up direto é revertida por redeploy da função anterior. Nenhuma etapa exige trabalho manual posterior.
