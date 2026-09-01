# Nino Behavioral Timing — fechar a arquitetura existente (`nino_behavioral_timing.v1`)

## O que a auditoria confirmou (verificado agora)

- `supabase/functions/_shared/agent/behavioralPrinciples.ts` já tem os 9 princípios e `resolveBehavioralIntervention()`. A escolha de princípio hoje vem **só do estágio** (`principlesForStage`) — não existe entrada de evento nem de janela.
- `supabase/functions/_shared/proactive/pipeline.ts` só cria a situação comportamental quando `stage` é `fund_goal`/`build_wealth`, com fingerprint `versão:estágio:as_of` (um por dia, não por evento).
- `supabase/functions/_shared/proactive/ranking.ts` pontua apenas relevância (`insightValue`) + cruzamento de domínio + afinidade. **Não existe `timing_score`.**
- `supabase/functions/_shared/agent/changeLoop.ts` usa `cadenceDays = 7` fixo e `next_check_at = hoje + 7` — follow-up é cadência genérica, não janela de evento.
- Já existe classificação canônica de natureza do movimento em `src/lib/engine/facts.ts` (`movement_kind`: `internal_transfer`, `investment_redemption`, `refund`, `external_transfer_*`) e separação de datas (`occurred_at` comportamental vs competência/caixa). Isso será **reutilizado**, não recriado.
- Já existem `proactive_signals`, `proactive_decisions`, `communication_deliveries`, `nino_learning_events` e o padrão de fila `financial_snapshot_refresh_queue`. Nenhum dispatcher novo será criado.

**Gap real:** o sistema sabe *o que* é relevante, mas não sabe *quando* a decisão ainda pode ser influenciada. Timing hoje = cron + cooldown + vencimento + cadence.

## O que será construído

### 1. Motor determinístico de timing
Novo `supabase/functions/_shared/proactive/behavioralTiming.ts` (contrato `nino_behavioral_timing.v1`), sem LLM, retornando por gatilho:
`{ trigger, window, timing_score, urgency, principle_candidates, eligible_now, defer_until, reason, evidence }`.

Gatilhos: `MONEY_IN`, `LARGE_SPEND`, `FLEXIBLE_SPEND_CLUSTER`, `CREDIT_CARD_CLOSE`, `CREDIT_CARD_DUE_SOON`, `DEBT_INSTALLMENT_DUE`, `GOAL_OPPORTUNITY`, `CASH_RECOVERY`, `CASH_RISK`, `BEHAVIOR_BREAKTHROUGH`, `BEHAVIOR_RELAPSE`, `COMMITMENT_WINDOW`, `PERIOD_TRANSITION`.

`MONEY_IN` classifica a entrada usando o `movement_kind` canônico: `SALARY`/`RECURRING_INCOME`, `OTHER_INCOME`, `TRANSFER_IN`, `INVESTMENT_REDEMPTION`, `REFUND`. Apenas as duas primeiras habilitam `pay_yourself_first`.

Timing comportamental usa `occurred_at` (evento real); caixa continua em posting/competência. Compra de sábado postada segunda pertence a sábado.

### 2. Janelas configuráveis
Tabela nova `nino_behavioral_timing_windows` (janela por gatilho: horas de abertura, horas de validade, evidência mínima, piso relativo) com defaults semeados. Nenhuma política duplicada em vários arquivos; o motor lê a configuração.

### 3. `timing_score` com papel próprio
Fórmula determinística documentada, separada de `priority_score`:

```text
timing_score = clamp(0..100,
    40 * window_position      (dentro da janela e antes do ponto de decisão = 1)
  + 25 * actionability        (existe ação executável agora)
  + 20 * evidence_sufficiency (amostra mínima do gatilho atendida)
  + 15 * learned_window_fit   (taxa de ação histórica trigger×janela)
  - penalidades               (retrospectivo sem ação, repetição, dispensa recente))
```

No governador atual (`ranking.ts`): `effective_score = priority_score * (0.55 + 0.45 * timing_score/100)`; `timing_score < 35` gera decisão `defer` com `defer_until` e razão, em vez de entrega. Risco crítico nunca é deferido por timing.

### 4. Ledger de eventos comportamentais
Tabela nova `nino_behavioral_events` (`user_id`, `event_type`, `economic_event_id`, `occurred_at`, `detected_at`, `materiality`, `payload` reduzido, `dedup_key` único, `processed_at`). Sem cópia de dado financeiro sensível — só IDs e fatos essenciais.

Detecção de evento é derivada do snapshot canônico + leituras já existentes; a escrita é idempotente por `dedup_key`.

### 5. Reação a evento real, sem LLM síncrono
Novos triggers de banco (`transactions`, `credit_card_statements`, `goal_contributions`, `debt_payments`, `investment_movements`, conclusão de import/reconciliação) apenas **marcam o usuário** em `nino_behavioral_events` + fila de reavaliação. `agent-proactive-tick` continua sendo o único executor; passa a processar a fila de eventos antes da varredura por rotação. Nenhuma chamada de IA por transação.

### 6. Princípios ligados a gatilhos (matriz produtizada)
`resolveBehavioralIntervention()` ganha argumento opcional `trigger`/`timing`; `principlesForStage` continua como fallback. `margin_of_safety` vira **bloqueador**: truth gate inseguro, caixa projetado negativo ou pressão de dívida dominante suprimem `pay_yourself_first`/crescimento.

| Princípio | Gatilhos | Condições | Bloqueadores | Estratégia | Métrica |
|---|---|---|---|---|---|
| pay_yourself_first | MONEY_IN, GOAL_OPPORTUNITY | caixa estável + capacidade > 0 + meta/patrimônio | truth/caixa inseguro, transferência/estorno/resgate | nudge | taxa de aporte |
| opportunity_cost | LARGE_SPEND, simulação | impacto material | irrelevante ou já consumado sem ação | contextualizar | decisão/compromisso |
| intentional_spending | FLEXIBLE_SPEND_CLUSTER | concentração fora do padrão | amostra insuficiente | contextualizar | ritmo do ciclo |
| friction_and_nudge | COMMITMENT_WINDOW, MONEY_IN | compromisso pendente, janela aberta | dispensa, pause, repetição | remind/reframe | conclusão |
| identity_reinforcement | BEHAVIOR_BREAKTHROUGH | repetição >= 3 ciclos comprovada | ocorrência isolada | reinforce | persistência |
| margin_of_safety | CASH_RISK, CREDIT_CARD_DUE_SOON, DEBT_INSTALLMENT_DUE | risco evidenciado | — | bloquear crescimento | recuperação de caixa |
| reduce_financial_pressure | DEBT_INSTALLMENT_DUE | pressão define prioridade | — | remind | folga liberada |
| long_term_consistency | PERIOD_TRANSITION, CASH_RECOVERY | dado suficiente | virada sem amostra | reinforce | continuidade |
| protect_progress | ausência de gatilho material | — | — | manter | sem regressão |

### 7. Microcompromisso determinístico
`computeCommitmentAlternative()` em `changeLoop.ts`: quando `strategy = reframe`, a alternativa menor é **recalculada** por capacidade/prazo/meta/impacto pelo motor canônico. LLM nunca escolhe valor.

### 8. Aprendizado de timing
`nino_learning_events` passa a registrar `trigger`, janela, hora de entrega, `acted_at`, dispensa, compromisso e outcome em `metadata`/`subject_key`. Agregados: taxa de ação por gatilho, por janela, dismiss rate, tempo médio até ação, princípio × gatilho. O resultado realimenta `learned_window_fit`.

### 9. Admin auditável
Nova aba em `src/components/admin/NinoLearningBoard.tsx` + RPC `admin_v3_behavioral_timing`: eventos detectados, gatilhos, timing score, elegíveis, deferidos com razão, princípio, estratégia, action/dismiss rate e resultado — respondendo "o Nino está intervindo no momento certo?".

### 10. Testes
Nova suíte `src/test/nino-behavioral-timing.test.ts` cobrindo os 15 casos A–O do pedido (salário elegível, transferência/estorno/resgate ignorados, margin_of_safety vencendo, opportunity_cost, sem sermão retrospectivo, nudge após salário, idempotência tripla, sábado/segunda, 3 ciclos vs 1 ocorrência, defer por janela melhor, priority alta × timing baixo e vice-versa). Depois: suíte completa, typecheck e build.

## Detalhes técnicos

- Migration **nova** (nenhuma existente é editada): `nino_behavioral_events`, `nino_behavioral_timing_windows`, triggers de marcação, GRANTs (`authenticated` leitura própria, `service_role` total), RLS por `user_id`, RPC de admin.
- Arquivos alterados: `proactive/behavioralTiming.ts` (novo), `proactive/contracts.ts`, `proactive/context.ts`, `proactive/signals.ts`, `proactive/situations.ts`, `proactive/ranking.ts`, `proactive/pipeline.ts`, `agent/behavioralPrinciples.ts`, `agent/changeLoop.ts`, `agent/behaviorWealth.ts` (apenas leitura de trigger), `agent-proactive-tick/index.ts`, `core/RuntimeContract.ts` (bump), `src/components/admin/NinoLearningBoard.tsx`.
- Deploy atômico obrigatório das 9 funções de `_shared/agent/DEPENDENTS.md` + bump de `AGENT_RUNTIME_VERSION`.
- Nada de segundo dispatcher, segunda fila ou `BehaviorTimingEngine2`.

## Entrega final

Relatório com: reutilização, gap exato de timing, arquivos alterados, event types, fórmula do `timing_score`, matriz princípio → gatilho, exemplos reais (MONEY_IN, transferência ignorada, pay_yourself_first no momento certo, margin_of_safety bloqueando, opportunity_cost, commitment window, identity reinforcement), prova de dedup, testes, build, typecheck, migrations e funções publicadas.
