# Plano único — Subsistema de Comunicação do Meu Nino (`comms_contract.v1`)

## 1. Diagnóstico verificado (banco + código, hoje)

- **Motor proativo quebrado para 100% dos usuários.** `agent_settings.last_tick_at = 2026-08-03 13:17`, `last_tick_users = 6`, e os 6 registros de `last_tick_errors` são `proactive:agent_runs:column agent_runs.created_at does not exist`. A tabela `agent_runs` tem `started_at`/`ended_at`, **não** `created_at`. Ocorrências: `ProactiveEngineV2.ts` (linhas 125, 127, 148) e `ProactiveEngine.ts` (38, 40, 57). O `for` do `agent-proactive-tick` já isola erro por usuário (try/catch por estágio), mas o estágio `proactive` morre para todos.
- **Audiência sem filtro de teste.** `_shared/intelligence/proactiveAudience.ts` une 4 fontes (runs, transactions, user_pseudonyms, product_events) com `limit` e ordem fixa, **sem** excluir `is_test`, sandbox, contas em exclusão ou onboarding incompleto, e sem rotação justa (nada de `last_proactive_scan_at`).
- **Lembretes do Rolê bloqueados.** Índice `split_jobs_idempotent_uniq (shared_expense_id, participant_id, kind, scheduled_for)` + `ON CONFLICT DO NOTHING` em `schedule_split_due_reminders`. `admin_split_reminder_policy_update` marca os antigos como `skipped/policy_replaced_due_plus_one` **antes** de garantir substituto, e o `INSERT` só cria com `scheduled_for > now()`. Resultado real: no rolê **Festival** (`c15bca45…`), o participante **Frasao** (`744b6d0f…`, pending, R$ 135,31, `+5511962297091`) tem `due_today` (03/08 12:00Z) e `overdue d1/d3` todos `skipped` e nenhum job ativo — a recriação é impossível (conflito de tupla + horário passado).
- **Entrega sem confirmação.** As duas tentativas para Frasao (`9d379e2e…` convite, `dbd0beea…` lembrete) têm `sent_at` preenchido, `provider_message_id` presente e `status=failed / last_error=ack_stalled_no_delivery`. O watchdog marca `failed` e para: não consulta a WAHA pelo `provider_message_id`, não faz backoff, não avisa o dono, e o `reminder_jobs` correspondente segue `enqueued`.
- **Contador antes da entrega.** `split-reminders-dispatch-v2` incrementa `reminder_count`/`last_reminded_at` logo após o insert em `outbound_messages` (linhas 402‑407). Frasao tem `reminder_count = 1` sem nenhuma entrega confirmada.
- **Dois consumidores da fila.** `whatsapp_send_dispatch_tick` (cron 1 min) e chamada direta a `whatsapp-send` no fim de todo tick do split (linhas 437‑451).
- **Segredos de cron divergentes.** No vault existe **apenas** `nocontrole_cron_secret`. `split_message_pipeline_tick` aceita 3 nomes; `whatsapp_send_dispatch_tick` aceita só o legado; as Edge Functions leem `INTERNAL_CRON_SECRET`/`CRON_SECRET`.
- **Política proativa.** `CommunicationDispatcherV3` grava `dismissed` para bloqueios temporários (quiet hours, caps); `channel_ready` é definido só por severidade (`critical → both`, resto `app`), o que anula `whatsapp_proactive`; `communicationPolicy.ts` fixa `America/Sao_Paulo` e conta cap **por entrega de canal**, não por comunicação lógica.
- **Duplicidade e divergência.** Crons `financial-reports-weekly` (seg 10:00) + estágio `advisor` + sugestão “revisão semanal” geram até 3 avisos do mesmo artefato. `user_insights` e `pending_proactive_suggestions` são objetos distintos, sem `formula_version`/`as_of` compartilhados.
- **Telemetria falsa.** Os `*_tick` gravam heartbeat pelo sucesso do `net.http_post`; a Edge Function final não atualiza o mesmo `job_key`.

## 2. Causas raiz

1. Consulta a coluna inexistente (sem teste de contrato de schema).
2. Unicidade de job por tupla de agendamento, com jobs terminais bloqueando substitutos.
3. Troca de política não transacional (cancela antes de criar).
4. Estado do job desacoplado do estado real da entrega.
5. Política de canal derivada de severidade, e caps contados por canal.
6. Ausência de reconciliador e de recuperação por janela.

## 3. Execução (uma única rodada)

### Migration A — `comms_contract.v1` (schema)
- `reminder_jobs`: novas colunas `policy_version`, `retry_count`, `next_attempt_at`, `deliver_after`, `delivery_status`, `sent_at`, `delivered_at`, `read_at`, `cancel_reason`, `superseded_by`. Substituir `split_jobs_idempotent_uniq` por índice único **parcial** cobrindo apenas estados vivos (`queued|processing|enqueued`), preservando histórico.
- `shared_expense_participants`: `attempts`, `queued_count`, `sent_count`, `delivered_count`, `read_count`, `last_attempted_at`, `last_sent_at`, `last_delivered_at`, `communication_status`.
- `pending_proactive_suggestions`: status ganha `deferred`/`awaiting_approval`, mais `next_attempt_at`, `defer_reason`, `logical_dedup_key`.
- `communication_catalog`: `default_channels`, `sensitivity`, `fallback_policy`, `min_severity_for_whatsapp`.
- `profiles`/`notification_preferences`: `timezone` (fallback `America/Sao_Paulo`), `quiet_behavior` (`defer|silent|immediate`).
- `user_insights`: `formula_version`, `as_of`, `validity_until`, `eligible_channels`, `logical_dedup_key`, `source_snapshot_id`.
- Índices de fila: `reminder_jobs (status, scheduled_for)`, `outbound_messages (status, next_attempt_at)`, `communication_deliveries (user_id, logical_dedup_key, created_at)`.

### Migration B — funções transacionais
- `apply_split_reminder_policy()`: calcula elegíveis → cria/reativa (zera `attempts`, limpa `last_error`, `outbound_message_id`, `lease_expires_at`, grava `policy_version`) → valida cobertura → **só então** cancela antigos; nunca reativa job com `delivered_at`/`read_at`; retorna `{created, reactivated, kept, cancelled, conflicts, participants_without_job}`.
- `schedule_split_due_reminders()`: `ON CONFLICT … DO UPDATE` nos jobs vivos e recuperação por janela: `due_today` até o fim do dia local, `overdue` por N dias configuráveis, `invite`/`payment_confirmation` imediatos; fora da janela → alerta ao dono, não envio tardio.
- `reconcile_split_reminder_jobs()`: audita pendentes × esperados × ausentes/bloqueados/cancelados indevidamente e repara; chamada por cron 15 min, ao criar/editar rolê, ao mudar política, ao registrar pagamento e sob demanda no admin.
- `mark_reminder_delivery(job_id, state)` + trigger em `outbound_messages`: propaga `provider_accepted|sent|delivered|read|failed_retryable|failed_terminal` para `reminder_jobs.delivery_status` e incrementa os contadores do participante **apenas** em `sent`/`delivered`/`read`.
- Padronizar segredo: `INTERNAL_CRON_SECRET` no vault, aliases legados aceitos com log de uso.

### Código
- `ProactiveEngineV2.ts` / `ProactiveEngine.ts`: `started_at` como coluna canônica.
- Novo `_shared/intelligence/schemaContract.ts` + teste que valida colunas usadas contra `information_schema`.
- `proactiveAudience.ts`: exclui `is_test`, sandbox, contas em exclusão, sem onboarding e sem dados mínimos; rotação justa por `last_proactive_scan_at`/`next_proactive_scan_at`, priorizando nunca processados e severidade crítica; flag admin `include_test_users` só em `dry_run`.
- `communicationPolicy.ts`: timezone do usuário → profile → fallback; cap por **comunicação lógica**; retorna `deferred + next_attempt_at` em bloqueio temporário.
- `CommunicationDispatcherV3.ts`: canal vindo do catálogo (tipo, sensibilidade, severidade, preferência, consentimento); `deferred`/`awaiting_approval`/`dismissed` distintos; fallback de canal por tipo (participante externo com WhatsApp falho → notificação ao dono).
- `split-reminders-dispatch-v2`: deixa de chamar `whatsapp-send`; produtor apenas enfileira. `whatsapp_send_dispatch_tick` fica o único consumidor.
- `whatsapp-ack-watchdog`: consulta a WAHA por `provider_message_id`, classifica recuperável/definitivo/desconhecido, backoff exponencial com `retry_count` limitado, sem reenvio imediato, e notifica o dono quando o participante não recebeu.
- Unificação relatório/revisão: um artefato por período, uma `logical_dedup_key`, uma notificação, destino único `/app/assessor/acompanhamento`; `insights-generate` e o motor proativo passam a consumir o mesmo insight canônico (`type`, `facts`, `evidence`, `formula_version`, `as_of`, `validity`, `eligible_channels`).
- Cada Edge Function final grava o heartbeat do próprio `job_key` com os estágios (`request_enqueued → generated → persisted → eligible → scheduled → queued → provider_accepted → sent → delivered → read → clicked → failed`).

### UI e Admin
- `DivisaoDoRoleDetalhe`: separa `payment_status` de `communication_status` por participante (pendente, agendado, tentativa feita, enviado, entregue, lido, falhou, telefone inválido, próxima tentativa), mobile-first.
- Admin: painel de cobertura de lembretes com botões “Reconciliar” e “Aplicar política”, fila com motivo real de bloqueio, distinção `deferred` × `dismissed`, e heartbeats por estágio.

### Correção de dados (na mesma rodada)
1. Backfill de `policy_version`, `delivery_status` e contadores a partir de `outbound_messages`.
2. `reminder_jobs` `enqueued` cujo outbound está `failed/dead` → `failed_terminal` com motivo.
3. Corrigir `reminder_count` inflado (ex.: Frasao 1 → 0 entregues confirmados).
4. **Caso Festival/Frasao:** valida pendente + telefone + rolê ativo; se pago, não agenda; recria job vivo `due_today` com a régua de horário — antes das 11h BRT agenda hoje 11h, depois disso o próximo horário seguro do dia, senão o próximo dia permitido; nunca em quiet hours, nunca duplicando mensagem já entregue; registra `shared_expense_events` de auditoria. Copy do lembrete: “Oi, Frasao! Passando só para lembrar da sua parte de R$ 135,31 do Festival 💛 / Se você já tiver feito o pagamento, pode desconsiderar esta mensagem e avisar o Daniel para ele atualizar por lá. / Se ainda não, os dados do Pix estão no link do rolê.”

### Testes (vitest, somados aos 957 atuais)
Job `skipped` não bloqueia substituto; política cobre todos os participantes; recuperação após o horário; outbound `failed` atualiza o job; contador só sobe em `sent`/`delivered`; ausência de ACK não duplica; participante pago cancela futuros; rolê cancelado não envia; test users excluídos; quiet hours adiam (`deferred`); relatório e revisão não duplicam; insight idêntico em todas as superfícies; erro de um usuário não interrompe os demais; contrato de schema de `agent_runs`; idempotência de reprocessamento; concorrência/lease.

### Ordem de implantação
Migration A → Migration B → código + testes + typecheck → backfills e correção de dados → reparo do caso Frasao → deploy de `agent-proactive-tick`, `split-reminders-dispatch-v2`, `whatsapp-send`, `whatsapp-ack-watchdog`, `insights-generate`, `financial-reports-generate`, `agent-chat`, `whatsapp-webhook` → publicação do frontend.

### Validação pós-deploy e aceite
`agent-proactive-tick` com `last_tick_errors = []` e sugestões > 0 sem perfis de teste; `reconcile_split_reminder_jobs()` retornando `participants_without_job = 0`; Frasao com job vivo e, após o envio, `delivery_status` real; nenhum `reminder_jobs.enqueued` com outbound `failed`; heartbeats refletindo a função final; um único aviso por relatório semanal.

### Rollback
Colunas novas são aditivas; índice antigo recriável; funções versionadas (`_v1` mantidas) e crons revertidos por `cron.alter_job`. Reversão de código por deploy anterior, sem perda de dados.

Nada fica para execução manual posterior: migrations, backfills, reparo do caso real, testes, deploys e publicação acontecem na mesma rodada.
