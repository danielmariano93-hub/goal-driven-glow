# Motor de Antecipação Comportamental Financeira (`anticipation_contract.v1`)

Hoje o Nino explica o passado. Este plano acrescenta uma camada que descobre padrões pessoais, prevê quando eles podem se repetir e avisa **antes**, dentro da janela em que o usuário ainda pode agir — no app, na central de notificações, em página detalhada e no WhatsApp autorizado.

## 1. Diagnóstico do estado atual (verificado no HEAD e no banco)

Reutilizável como está:
- `CommunicationDispatcherV3` já decide canal pelo **catálogo** (`default_channels`, `sensitivity`, `min_severity_for_whatsapp`), aplica templates editáveis, dedup lógico (`logical_dedup_key`), adiamento (`deferred` + `next_attempt_at`) e enfileira WhatsApp com `context_type/context_id`.
- `communicationPolicy.decideCommunication` já tem quiet hours com timezone, cooldown 24h por tipo, dedup 14 dias e cap por comunicação lógica (app+WhatsApp contam 1).
- Fila WhatsApp completa: `outbound_messages` → `whatsapp-send` → WAHA → `whatsapp-ack-watchdog` (cron 10min) e `whatsapp-send-dispatch-1m`.
- Núcleo financeiro canônico (`finance-core/facts.ts`, `bridges.ts`, `movement_kind`) já classifica transferências, `card_payment`, investimentos, `refund`.

Precisa mudar:
- `ProactiveEngineV2` é retrospectivo: janela fixa de 75 dias, `.limit(1000)`, e **sobrescreve o canal** com `channel_ready: severity === "critical" ? "both" : "app"` (linha 231) — e `communicationPolicy` ainda barra por `channel_ready` (linha 120), anulando o catálogo. Detectores atuais (`InsightsEngine`/`ProactiveDetectors`): aumento de gasto, concentração, duplicidade, meta em risco, conta a vencer, recorrência, queda de engajamento — nenhum preditivo.
- `pending_proactive_suggestions` não tem janela temporal (só `expires_at`/`next_attempt_at`), nem `opportunity_date`, `optimal_send_at`, `timezone`, `stale_policy`.
- Entrega no app é registrada como `delivered` ao inserir em `notifications` — não é entrega real fora do app (não há push).
- `transactions.occurred_at` é **date** (sem hora), `posted_at` também date. Existe `posted_at_source`; **não existe** hora/timezone/precisão. Padrões por horário não são possíveis com o dado atual.
- Cron único `agent-proactive-hourly` (17 * * * *) faz perfil + comportamento + revisões + scan + dispatch no mesmo tick.
- `whatsapp-webhook` não recupera contexto de `context_type` — respostas a alertas não voltam ao objeto de origem.

Consolidar/descontinuar: `ProactiveEngine.ts` (v1), `CommunicationDispatcherV2.ts`, `AdvisorReviewService.ts` (v1) marcados como deprecated e removidos das importações; `NotificationDispatcher` permanece como fachada de V3.

## 2. Arquitetura nova

```text
transactions (intocadas)
  → behavioral_transaction_facts / behavioral_daily_facts / behavioral_cycle_facts
  → BehavioralPatternEngine  → behavioral_patterns
  → AnticipationOpportunityEngine → anticipation_opportunities
  → UtilityScorer + OptimalSendTimeResolver + AttentionOrchestrator
  → CommunicationDispatcherV3 (reuso) → notifications / outbound_messages → WAHA
  → respostas + feedback → anticipation_outcomes → confiança do padrão
```

Nenhum novo caminho de escrita financeira. Nada de gravação em `transactions`, saldos, faturas ou bridges.

## 3. Modelo de dados (migrations)

1. **`behavioral_transaction_facts`** — grão transação, campos conforme especificado (local_date, weekday, week_start, month_phase, card_cycle_id/day, merchant_normalized/canonical, category_confidence, movement_kind, behavioral_class, amount_gross/net, flags `is_consumption/is_adjustable/is_fixed/is_exceptional/is_planned/is_refund/is_transfer/is_card_payment/is_debt_principal`, data_confidence, occurred_at_precision, formula_version, source_snapshot_id). PK `(user_id, transaction_id, formula_version)`.
2. **`behavioral_daily_facts`** — grão dia; totais consumo/ajustável/fixo/cartão/alimentação/lazer/small_spend, coberturas, `is_payday_window`, `is_holiday`, `is_exceptional_day`.
3. **`behavioral_cycle_facts`** — grão (semana | mês | ciclo de cartão | janela de pagamento).
4. **`behavioral_patterns`**, **`anticipation_opportunities`**, **`anticipation_outcomes`** — todos os campos e estados listados no pedido, com `formula_version`, `evidence`, `exclusions` e chaves de dedup lógico.
5. **`anticipation_detector_config`** — thresholds versionados por detector (janela mínima, uplift mínimo, valor absoluto mínimo, hit_rate, confiança, cobertura), com `version` e `active`.
6. **Colunas de tempo em `transactions`** (aditivas, nullable, sem alterar contabilidade): `occurred_at_time time`, `occurred_at_timezone text`, `occurred_at_precision text check (day|hour|minute)`, `local_occurred_at timestamptz`. Preenchidas apenas quando a origem traz hora (OCR/importação/agente); nunca inventadas. Detectores de horário só ligam quando `precision <> 'day'` em amostra suficiente.
7. **`notification_deliveries_state`**: adicionar em `communication_deliveries` os estados reais `created | available_in_app | push_queued | push_sent | push_delivered | viewed | opened | acted` — app passa a gravar `available_in_app` (não `delivered`).
8. **Catálogo**: inserir os 7 novos `kind` em `communication_catalog` com `active=false` (dry run), `allowed_channels`, `default_channels=['app']`, `sensitivity`, `min_severity_for_whatsapp`, cooldowns, `fallback_policy`, `stale_policy`, janela padrão; + `communication_templates` app/WhatsApp por tipo.
9. **`notification_preferences`**: `anticipation_enabled`, `anticipation_whatsapp`, `anticipation_kinds jsonb` (comportamento, cartão, vencimentos, metas, compromissos, recorrências), `muted_pattern_ids uuid[]`.
10. **`financial_feature_flags`**: `use_anticipation_engine`, `anticipation_dry_run`, `anticipation_whatsapp_enabled`; rollout por `user_id` e percentual em `agent_settings`.

RLS: dono lê (`auth.uid() = user_id`), escrita apenas `service_role`; GRANTs explícitos (`authenticated` select, `service_role` all) em todas as tabelas novas. Índices por `(user_id, local_date)`, `(user_id, status, eligible_from)`, `(user_id, kind, status)`, únicos parciais em `logical_dedup_key` para estados vivos.

## 4. Serviços novos (Deno, `_shared/anticipation/`)

- `facts.ts` — construção dos fatos comportamentais **reutilizando** `finance-core/facts.ts` e `bridges.ts` para classificar movimentos; exclui transferência, aplicação, resgate, pagamento de fatura, principal de dívida, estorno (líquido), ajuste, saldo inicial e planejado não ocorrido.
- `qualityGates.ts` — cobertura de categorização ≥85%, confiança média, valor sem categoria, merchant normalizado, ausência de conflitos.
- `BehavioralPatternEngine.ts` — descoberta/validação/enfraquecimento/expiração; mediana, exclusão de outliers (IQR), dias extraordinários fora, dias úteis vs fim de semana, janelas por detector (dia da semana 12–26 semanas; fase do mês 4–6 meses; cartão 3–6 ciclos; recorrência 3–12 meses; pós-salário ≥4 entradas).
- `AnticipationOpportunityEngine.ts` — gera oportunidades futuras com janela e revalidação obrigatória antes do envio.
- `utility.ts` — `utility_score` determinístico e auditável (confiança × impacto normalizado × consistência × acionabilidade × relevância temporal × receptividade − custo de interrupção − fadiga), com breakdown persistido.
- `OptimalSendTimeResolver.ts` — regras (sem modelo opaco): timezone, quiet hours, horário histórico, janela de ação, hora habitual de abertura.
- `AttentionOrchestrator.ts` — prioridade 1..8 do pedido, escolhe **uma** principal por janela; demais só no app ou adiadas.
- `staleness.ts` — `drop_after_window | convert_to_in_app | send_summary_later | recompute_before_send`.
- Detectores: `weekday_spending_risk`, `weekend_spending_risk`, `card_cycle_acceleration`, `upcoming_cash_pressure`, `expected_recurring_payment`, `small_spend_acceleration` (+ `month_phase_spending_risk` no catálogo, ativado na fase 5).

`communicationPolicy` passa a ignorar `channel_ready` quando o candidato vem com `channel_source = 'catalog'`; `ProactiveEngineV2` para de sobrescrever canal por severidade.

## 5. Edge Functions e cron

| Função | Cron | Papel |
|---|---|---|
| `behavioral-facts-refresh` | `20 3 * * *` + gatilho pós-importação | fatos incrementais, idempotentes |
| `behavioral-pattern-discovery` | `40 3 * * *` | descobre/revalida padrões vencidos |
| `anticipation-opportunity-scheduler` | `0 4 * * *` + após padrão atualizado | cria oportunidades futuras |
| `anticipation-dispatch-tick` | `*/10 * * * *` | revalida, aplica política, despacha, expira |
| `anticipation-outcome-evaluator` | `30 5 * * *` | compara previsto × real, ajusta confiança |
| `anticipation-watchdog` | `*/30 * * * *` | oportunidades perdidas, presas, estados inconsistentes |

Todas com `INTERNAL_CRON_SECRET` via `_cron_secret()`, lease, `job_heartbeats` + `record_job_stages` (funil real, não só `net.http_post`), isolamento de falha por usuário, replay seguro. `agent-proactive-tick` continua funcionando (motor retrospectivo) e perde apenas a responsabilidade de canal.

## 6. UI

- **Home**: `AnticipationCard` ("Hoje merece atenção"), visível só na janela, com CTAs Definir limite de hoje / Ver padrão / Não foi útil / Não me avise sobre isso.
- **Central de notificações** e **`/app/antecipacoes/:opportunityId`**: padrão, amostra, período, baseline, previsto, diferença, categorias, confiança, dados excluídos, ação, silenciar, feedback.
- **Preferências**: seção "Antecipações financeiras" com opt-in por tipo e opt-in separado para WhatsApp.
- **Admin** (`/admin/comunicacao-proativa` + nova aba Antecipação): usuários elegíveis, padrões candidato/validado/ativo, uplift, amostra, oportunidades futuras, janela, canal, motivo de seleção/bloqueio, preview, simulação por usuário e por data (ex.: sexta-feira), toggle de detector, threshold, template, rollout, reprocessar, cancelar.
- Copy: sem juízo de valor, sem linguagem diagnóstica, sem certeza; sempre amostra + período.

## 7. Dry run e rollout

Fase 1 dry run total (nenhuma `notifications`/`outbound_messages`/delivery produtiva) → Fase 2 admin e usuários de teste, app only → Fase 3 app por `user_id` → Fase 4 WhatsApp opt-in, **máx. 1 antecipação/semana** → Fase 5 expansão. Flags por engine, detector, canal, usuário e percentual.

## 8. Backfill

`behavioral_transaction_facts` e `behavioral_daily_facts` para 12 meses, paginado, retomável, idempotente, com `formula_version` e `source_snapshot_id`; padrões históricos recalculados; **oportunidades só futuras**; comunicação desligada durante o backfill; execução registrada. Rollback: `delete` por `formula_version` + flags off (nada financeiro é tocado).

## 9. Testes (Vitest + contrato de schema)

Cobrindo integralmente as seções 22.1–22.7 do pedido: exclusões financeiras, estornos líquidos, timezone/precisão, dia extraordinário; amostra insuficiente, uplift alto com valor baixo, outlier, padrão desaparecido, dois cartões; janela, revalidação, expiração, stale policy, concorrência; app/WhatsApp/ambos, sem consentimento, quiet hours, caps, ACK desconhecido, expirado antes da entrega; resposta ao alerta com recuperação por `opportunity_id`; outcomes fortalecendo/enfraquecendo padrão; regressão de Home, relatórios, Pulso, metas, cartão, saldo, patrimônio, Divisão do Rolê e insights atuais.

## 10. Ordem de execução e critérios de aceite

1. Migrations (tabelas, colunas, catálogo, preferências, flags, RLS/GRANTs, crons). 2. Serviços `_shared/anticipation/*` + ajustes em `communicationPolicy`/`ProactiveEngineV2`/`CommunicationDispatcherV3`. 3. Edge Functions novas + `whatsapp-webhook` recuperando `context_type = anticipation_opportunity`. 4. UI app + admin. 5. Testes. 6. Backfill. 7. Deploy das funções. 8. Ativação dos crons em dry run. 9. Publicação do frontend. 10. Validação pós-produção: funil em `job_heartbeats`, zero envio real na fase 1, comparação de totais financeiros antes/depois (Home, relatórios, patrimônio) e nenhuma transação duplicada.

Aceite = os 30 critérios do pedido, verificados um a um na validação pós-deploy.
