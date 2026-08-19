# Motor de Proatividade Multi-Financeira (`proactive_multifinance.v1`)

## 1. Auditoria do estado atual (verificada no código)

| Componente | Onde está hoje | Papel atual | Destino |
|---|---|---|---|
| `agent-proactive-tick/index.ts` (255 linhas) | Edge Function | orquestra `recomputeProfile → behavior → advisor → syncDiagnosisSuggestions + scanUser → dispatchSuggestions`, dry-run, rollout, telemetria em `agent_settings` | **mantido como orquestrador**, com etapas novas no meio |
| `ProactiveEngineV2.scanUser` | `_shared/agent/core` | detectores operacionais/engajamento + lembrete emocional; já exclui `DIAGNOSIS_OWNED_KINDS` | **reutilizado como coletor de sinais** (domínios comportamento/engajamento/dados) |
| `diagnosisToCommunication.ts` | `_shared/intelligence` | lê `nino_intelligence_items` ativos + metas por categoria do snapshot canônico e consolida por `logical_topic_key` | **reutilizado como coletor de sinais** (não mais como gerador final de candidatos) |
| `computeAgentSnapshot` (`_shared/engine/metrics.ts`, espelho de `src/lib/engine/metrics.ts`) | engine canônico v8 | caixa, cartões, metas, dívidas, investimentos, agenda de compromissos, projeção, `reconciliation_id` | **base única do contexto** |
| `financial_situations` / `nino_intelligence_items` / `nino_diagnosis_snapshots` | SQL (`nino_intelligence_tick`) | situações canônicas do diagnóstico | **fonte de sinais**, contrato SQL intocado |
| `anticipation/runner.ts`, `opportunities.ts` | Edge shared | antecipações validadas | **fonte de sinais** |
| `insightValue.ts` | Edge shared | valor do insight (impacto, severidade, confiança, dismissals) | **base do `priority_score`**, evoluído |
| `communicationPolicy.decideCommunication` | Edge shared | opt-in, quiet hours, dedup 14d, cooldown 24h, cotas dia/semana, Care Quota | **preservado**; attention budget entra antes dele |
| `CommunicationDispatcherV3` + `communication_catalog`/`templates` + `communication_deliveries`/`feedback` | Edge shared + tabelas | canal, template, entrega, feedback | **preservados sem alteração de contrato** |
| `logicalDedup.communicationTopicKey` | Edge shared | chave de assunto lógico | **reutilizado** para `logical_topic_key` das situações |
| `proactive_reminder_settings`, `agent_settings`, `notification_preferences` | tabelas | configuração editável no admin | **estendidas** (thresholds versionados + attention budget) |
| Admin `ComunicacaoProativa.tsx`, `AgenteSimulador.tsx`, `RulesBoard`, `RemindersBoard` | app | painel e dry-run | **estendidos** com a visão de pipeline |

**Duplicidades encontradas:** `scanUser` e `diagnosisCandidates` fazem consultas próprias a `transactions`, `goals`, `recurring_occurrences`, `communication_deliveries` e `pending_proactive_suggestions` no mesmo tick, com datas de referência independentes; a priorização hoje é resolvida em dois lugares (`insightValue` + `severity → priority` na policy). Ambas serão unificadas.

**Inputs que ainda não existem:** menor ponto de caixa por horizonte (hoje/24h/3d/7d/resto/próximo ciclo), `days_until_next_income`, aceleração de fatura já cruzada com caixa futuro, materialidade normalizada por baseline pessoal, novelty/fingerprint de situação, attention budget global, outcome pós-alerta (`resolved/improved/worsened`) e relevância personalizada por tipo.

## 2. Contratos propostos (TypeScript, `_shared/proactive/`)

- **`MultiFinanceProactiveContext`**: `{ as_of, reference_date, reconciliation_id, formula_version, cash{available, horizons[NOW,24H,3D,7D,REST_OF_PERIOD,NEXT_CYCLE], lowest_point, days_until_next_income}, income, cards[], commitments, debts, goals, category_goals, investments, spending, behavior, emotions, data_quality, confidence, domain_errors{} }` — construído por `buildMultiFinanceProactiveContext(sb, userId, referenceDate)` a partir de `computeAgentSnapshot` + engines já existentes (`cardExposure`, `commitmentAgenda`, `incomeProjection`, `spendingRhythm`, `recurringDiscovery`, `anomalies`, `emotionFinance`, `debtStatus`, `merchantIntelligence`). Nenhum recálculo próprio.
- **`FinancialSignal`**: exatamente o contrato do pedido (`domain, kind, horizon, subject_type/id, facts, impact_amount, impact_ratio, direction, urgency, confidence, materiality, actionability, source_engine, formula_version, reconciliation_id, evidence, valid_until`).
- **`FinancialSituation`**: `situation_type, primary_domain, related_domains[], signal_ids[], headline_fact, supporting_facts[], financial_impact, horizon, urgency, confidence, actionability, materiality, recommended_action, alternative_actions[], evidence[], logical_topic_key, fingerprint, valid_until`.
- **`ProactiveDecision`**: `should_interrupt, situation_id/type, primary_fact, supporting_facts[], impact_amount, horizon, priority_score, priority_breakdown, confidence, materiality, urgency, actionability, primary_action, alternative_actions[], selected_channel, suppression_reason, evidence, logical_topic_key`.

Tipos de situação da v1: `cash_pressure`, `card_cash_pressure`, `category_commitment_risk`, `debt_payment_risk`, `investment_supporting_consumption`, `behavioral_goal_risk`, `emotional_financial_risk`, `recurring_pressure`, `data_quality_block`, `financial_progress`.

## 3. Pipeline (dentro do `agent-proactive-tick`)

```text
recomputeProfile → buildMultiFinanceProactiveContext → collectFinancialSignals
→ composeFinancialSituations → evaluateSituations (materialidade/urgência/confiança/acionabilidade)
→ rankSituations → applyAttentionPolicy → buildProactiveDecision
→ pending_proactive_suggestions (compat) → dispatchSuggestions → trackOutcome
```

`renderCommunication` monta o texto a partir dos fatos do `ProactiveDecision` (2–5 linhas no WhatsApp: o que está acontecendo, por que importa, o que fazer). Se o humanizador LLM for usado, a saída passa pelo `TruthValidator`/`claimValidator`: número que não existir na evidência derruba o texto para a versão determinística.

**Fórmula de ranking** (determinística, componentes persistidos):
`priority = 34·materiality + 26·urgency + 14·confidence + 14·actionability + 6·user_relevance + 6·novelty + cross_domain_bonus(≤8, só com relação econômica e no máximo uma vez) − fatigue_penalty − repetition_penalty − low_confidence_penalty(quando materiality < high)`, cada fator normalizado 0..1 em `priority_breakdown`.

**Materialidade** (`computeMateriality`, thresholds versionados em `proactive_policy_config`): máximo entre impacto/saldo disponível, impacto/renda, impacto/gasto típico, impacto/teto da meta e desvio do baseline pessoal, com piso absoluto configurável → `none|low|medium|high|critical`.

**Attention budget** (`proactive_policy_config`, editável no admin): WhatsApp 1 interrupção normal/dia e 3/semana, exceção só para `critical` com `actionability ≥ medium`; App 3 itens/dia consolidados por `logical_topic_key`. Aplicado uma única vez, antes de `decideCommunication` (que continua valendo como camada de opt-in/quiet hours/dedup).

**Suppression** (registrada com motivo): `not_material`, `no_change_since_last`, `low_confidence_high_bar`, `no_action_available`, `covered_by_higher_priority`, `attention_budget`, `resolved_by_user`, `data_inconsistent`, `user_marked_not_useful`, `curiosity_only`. Re-alerta só com mudança de severidade, encurtamento material de horizonte, mudança material de impacto, fato novo ou reincidência — controlado por `fingerprint`.

## 4. Migrations

1. `proactive_signals`, `proactive_situations`, `proactive_decisions`, `proactive_situation_outcomes` — RLS por `user_id` (SELECT para `authenticated`), `GRANT` para `authenticated`/`service_role`, escrita apenas por service role.
2. `proactive_policy_config` (singleton versionado): thresholds de materialidade, pesos do ranking, attention budget por canal, horizontes ativos.
3. `proactive_kind_relevance` (aprendizado por usuário × tipo, derivado de `communication_feedback` e ações) — só afeta prioridade, nunca a verdade financeira.
4. `admin_v2_proactive_pipeline(user_id, date)` e extensão de `admin_v2_proactive_summary` para expor sinais → situações → decisões → suprimidas → outcome.
5. Reavaliação por evento: `proactive_reeval_queue` com debounce/idempotência por `(user_id, minuto)`, alimentada por transação relevante, importação confirmada, pagamento de dívida/fatura, nova recorrência, mudança de meta e check-in emocional; consumida pelo tick.

## 5. Admin e dry-run

Nova aba "Inteligência proativa" em `ComunicacaoProativa.tsx` e no simulador por usuário: funil `sinais → situações → relevantes → selecionada → suprimidas`, com drill-down por situação (sinais usados, números/evidência, breakdown do score, motivo da supressão, canal, outcome, taxa de ação). O dry-run passa a retornar `context_summary`, `signals`, `situations`, `decisions`, `suppressed`, `communications` sem nenhuma persistência ou envio.

## 6. Observabilidade

Por execução e por usuário: `run_id`, `as_of`, `reconciliation_id`, tempos por etapa (context/signals/composition/ranking/dispatch), contagens e `errors_by_stage`. Falha de um domínio degrada só as situações que dependem dele (marcadas `data_incomplete` e não publicadas como completas).

## 7. Testes (E2E dos 16 casos obrigatórios)

`src/test/proactive-multifinance-v1.test.ts` cobrindo os casos 1–16 do pedido, mais regressão de: policy atual (cotas, quiet hours, dedup), Care Quota, catálogo/templates, metas por categoria (`commitment` nunca recebe R$/dia) e paridade app × edge via `scripts/sync-finance-core.mjs`.

## 8. Fases de entrega

1. Contratos + `buildMultiFinanceProactiveContext` + testes de contexto.
2. Coletores de sinais (adaptando `scanUser`, `diagnosisCandidates`, antecipações, emotion finance) sem alterar o envio.
3. Composer, avaliação, ranking, attention budget, decisão + migrations.
4. Integração real no `agent-proactive-tick` (shadow → live), renderização e dispatch.
5. Outcome/aprendizado, admin e dry-run.
6. Matriz final requisito → implementação → arquivo → engine → teste → resultado → evidência.

Detectores legados só serão desligados após o painel demonstrar que cada `kind` antigo foi absorvido por uma situação equivalente.
