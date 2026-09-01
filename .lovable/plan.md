# Orçamento de atenção com override por relevância (`nino_comm_priority.v1`)

## O que está acontecendo hoje (verificado)

- `decideCommunication` (`supabase/functions/_shared/intelligence/communicationPolicy.ts`) aplica `daily_frequency_cap` e `weekly_frequency_cap` a **tudo que não é `severity = critical`**, contando mensagens por unidade (uma mensagem leve pesa igual a uma decisão patrimonial). Não existe nenhuma leitura de `priority_score` nessa policy.
- O `priority_score` existe e é real: `proactive/ranking.ts` calcula e grava em `proactive_situations.priority_score`, e o candidato leva o valor em `evidence.priority_score` (`proactive/pipeline.ts`). Consulta ao banco confirma scores altos vivos hoje (164,5 / 148 / 131,78). A escala **não é limitada a 100** — os cortes 75/90 continuam válidos como piso, não como percentual.
- O bloqueio é o gargalo real: em `communication_deliveries`, `weekly_frequency_cap` é o motivo de supressão nº 1 (82 ocorrências), seguido por `kind_cooldown_24h` (30) e `daily_frequency_cap` (12).
- Os limites do Admin vêm de `proactive_global_limits` (singleton, 1/dia e 3/semana) e são editados em `src/components/admin/messaging/RulesBoard.tsx` via `admin_proactive_limits` / `admin_proactive_limits_update`.
- Cap temporário já devolve `temporary: true` + `retryAt`, e o dispatcher já sabe adiar (`status = deferred`, `next_attempt_at`) — a infraestrutura de defer existe e será reaproveitada, não recriada.

## O que vai mudar

Uma única policy, a existente, passa de **cap rígido por contagem** para **orçamento de atenção com peso + override por relevância**, tudo configurável no Admin.

### 1. Configuração no banco (migration nova)

Tabela singleton `public.communication_policy_settings`:

- `pilot_mode` (bool, ON no piloto)
- `high_priority_threshold` (default 75)
- `critical_priority_threshold` (default 90)
- `allow_high_priority_override` (bool, ON)
- `high_priority_kinds` (text[], default: `wealth_building_action`, `cash_flow_imbalance`, `debt_pressure`, `bill_due`, `goal_feasibility`, `change_progress`, `change_reframe`, `recommendation_changed`, `high_priority_financial_action`)
- `cap_behavior` (`defer` | `suppress`, default `defer`)
- `quiet_hours_high_priority_behavior` (`defer` | `immediate`, default `defer`)
- `attention_weights` (jsonb: care 1, informational 2, financial 4)
- `pilot_budget_multiplier` (default 3)

Idempotente (`create table if not exists` + upsert do registro único), com GRANTs, RLS de leitura para admin de plataforma e nenhum ID de usuário hardcodado. RPCs `admin_communication_policy` e `admin_communication_policy_update` (padrão dos RPCs admin já existentes, com `_require_perm`).

### 2. Policy: prioridade, peso e override

Em `communicationPolicy.ts` (mesma função, sem policy paralela):

- `decideCommunication` recebe `policy` (as configurações acima) e passa a ler o score do candidato (`evidence.priority_score`, com o `value_score` do ranking como reserva).
- Faixas: `<50` respeita cap; `50–74` cap vale, mas o bloqueio vira **defer** (`medium_priority_frequency_defer`); `>=75` (threshold) fura cap diário/semanal quando o override está ON ou quando o `kind` está na lista de alta relevância; `>=90` idem, e o quiet hours segue a configuração (default defer).
- **Orçamento de atenção com peso:** o cap do Admin continua o guardrail, mas é convertido em pontos (`cap × peso financeiro`) e cada entrega histórica consome o peso do seu tipo. Duas mensagens leves (cuidado/engajamento) deixam de consumir a vez de uma recomendação patrimonial. Em `pilot_mode`, o orçamento é multiplicado pelo `pilot_budget_multiplier`.
- A decisão passa a devolver `cap_override: boolean` e `cap_original_reason` (ex.: `weekly_frequency_cap`) para auditoria.

Continuam intactos e antes do override: opt-out (financeiro, emocional, dicas, WhatsApp, antecipação), `muted_proactive_kinds`, canal desabilitado no catálogo, sensibilidade, `dedup_key_14d`, `kind_cooldown_24h`, dedup lógico do dispatcher e quiet hours.

### 3. Dispatcher e defer

`CommunicationDispatcherV3.ts` passa a carregar as configurações, injetar o score no candidato e, quando `cap_behavior = defer`, registrar `status = deferred` + `next_attempt_at` + `defer_reason` em vez de descartar. Quando houver override, grava em `communication_deliveries.block_context`: `priority_score`, `cap_override`, `cap_original_reason`, `pilot_mode`, pesos aplicados.

### 4. Aprendizado

Cada entrega por override também gera evento em `nino_learning_events` com `priority_score`, `cap_original_reason`, e depois liga com o que já é registrado hoje: `delivered_at`, dispensa, ação, compromisso criado. Isso responde depois “mensagem que furou o cap gerou valor ou incomodou?”.

### 5. Admin

Em Mensagens › Regras (`RulesBoard.tsx`), nova seção **Modo piloto e prioridade**: liga/desliga piloto e override, edita os dois thresholds, a lista de kinds e o comportamento ao atingir o cap e em quiet hours. E um bloco de métricas: bloqueadas por cap, deferidas, entregues por override, override por faixa de score, dismiss rate, action rate, compromissos originados, por cliente e por kind (RPC nova sobre `communication_deliveries` + `nino_learning_events`).

### 6. Testes (`src/test/nino-comm-priority-override.test.ts`)

Casos A–J do pedido: score 40 com cap (suppress/defer conforme policy), 70 (defer), 80 com override ON (elegível), 95 (não bloqueia por cap), 95 em quiet hours (defer), 95 com opt-out (bloqueia), 95 duplicado (bloqueia), `wealth_building_action` score 91 com cap semanal atingido (não bloqueia), piloto OFF (conservador) e piloto ON (override). Os testes existentes de policy/catálogo continuam verdes com a policy conservadora por padrão.

### 7. Deploy

Alteração em `_shared/agent` e `_shared/intelligence` exige bump de `AGENT_RUNTIME_VERSION` e redeploy do lote inteiro de `supabase/functions/_shared/agent/DEPENDENTS.md` (9 funções) no mesmo lote.

## Caso real esperado ao final

`wealth_building_action`, score 91,18, confiança 0,92, caixa estável, cap semanal atingido → **entregue com `cap_override`** no app e no WhatsApp; se estiver em quiet hours, **deferido** até o fim do silêncio. Nunca mais suprimido por `weekly_frequency_cap`.

## Notas técnicas

- Nada de policy paralela: a mudança é dentro de `decideCommunication` + carga de configuração no dispatcher.
- Escala do `priority_score` não é 0–100; thresholds são pisos absolutos e ficam editáveis para calibração.
- Reversível 100% pelo Admin: piloto OFF + override OFF restaura exatamente o comportamento atual.
- Migration nova e idempotente; nenhuma migration antiga é editada.
