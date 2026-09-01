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

## Hardening (fechamento das 10 lacunas auditadas)

- **Revalidação material**: `hasMaterialRecommendationChange` invalida por estágio, meta, rota, papel do valor, capacidade sustentável, caixa projetado, pressão de dívida (só quando ela define a prioridade) e truth gate. Diferença de valor só conta acima de R$ 20 ou 10%.
- **Check-in só com entrega real**: o ranking não marca nada. `confirmChangeFollowupDelivery` roda no dispatcher após entrega e `reconcileChangeFollowupDeliveries` absorve ack assíncrono. Dedup por `(user_id, dedup_key)`.
- **Proteção física**: índice único parcial garante um único compromisso ativo por pessoa; CHECKs cobrem estágio, status, estratégia, outcome, cadência e notas 0..1.
- **Estratégia real**: `resolveChangeStrategy` alterna reinforce/remind/reframe/pause por evidência, stalls consecutivos, descartes e perfil de aprendizado; pausa após tentativas repetidas sem evidência.
- **Aprendizado influencia**: `buildChangeLearningProfile` alimenta a escolha de princípio e estratégia; `resolveBehavioralIntervention` devolve princípio, objetivo, proibições e contexto — sem calcular dinheiro.
- **Telemetria honesta**: `admin_v3_ai_history` gera série por `generate_series` (dia sem chamada aparece como zero), filtra `p_workload`, separa latência de IA (`ai_usage_ledger`) da latência E2E (`agent_runs`) e declara `tokens_source`/`latency_source`.
- **Backfill executado**: `agent_memory` virou `nino_learning_events` com `source = 'agent_memory_backfill'` (apenas tipo, data, chave e confiança).
