# Nino Change Agent v1

Contrato: `nino_change_agent.v1`

## Objetivo

O Nino deixa de encerrar a jornada em “qual é o próximo passo?” e passa a fechar o ciclo:

`verdade → próxima ação → compromisso → acompanhamento → reforço/reframe → aprendizado → nova decisão`

## Guardrails

- O Nino não movimenta dinheiro automaticamente.
- Compromisso só nasce da recomendação canônica mais recente.
- Antes de aceitar, a recomendação é recalculada.
- Truth gate bloqueado invalida recomendação antiga.
- Progresso vem de fatos: caixa, parcela, aporte em meta ou aplicação registrada.
- Hipótese comportamental não confirmada não vira fato.
- Follow-up disputa o mesmo orçamento de atenção dos demais riscos.
- Duas mensagens não viram dois “cérebros”: o governador proativo continua único.
- Princípios comportamentais moldam a comunicação; não calculam dinheiro.
- Sem culpa, vergonha ou moralização de consumo.

## Estágios

Mantém `nino_behavior_wealth.v1` como decisão financeira e adiciona persistência de mudança sobre:
- repair_truth
- stabilize_cash
- reduce_debt_pressure
- fund_goal
- build_wealth
- protect_progress

## Admin

- Limites globais de mensagens deixam de ter teto hardcoded.
- `admin_v3_ai_history` combina telemetria moderna (`ai_usage_ledger`) com histórico de `agent_runs`.
- Aprendizado passa a ter ledger `nino_learning_events` e visão auditável por usuário.
