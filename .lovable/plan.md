# Correção do NINO_CHANGE_AGENT_V1 — fechar as 10 lacunas auditadas

Esta é uma correção da implementação anterior, não uma reinterpretação de escopo. Nada de arquitetura paralela, nada de apagar dados, nenhuma nova fórmula de dinheiro.

## Estado verificado agora (antes de planejar)

- `changeLoop.ts:160-162` — a revalidação compara somente `truth_gate.blocked`, `stage` e `goal_id`. Confirmado: 800 → 300 no mesmo estágio/meta hoje passa e vira compromisso.
- `pipeline.ts:195` — `markSelectedChangeFollowups()` roda dentro do bloco `persist`, logo após `allocateAttention`, ANTES de `pending_proactive_suggestions` e antes do dispatcher. Confirmado: check-in e `next_check_at` avançam mesmo quando o dispatcher bloqueia (quiet hours, cap, defer).
- Migration `20260901110548` — `nino_change_commitments` tem só `CREATE INDEX (user_id, status, next_check_at)`; não existe unique parcial de `status='active'` e nenhuma das quatro tabelas novas tem `CHECK`.
- `changeLoop.ts` grava `strategy: 'reinforce'` na criação e nunca a altera; não existem `strategy_reason`, `intervention_attempts`, `last_outcome`, `last_strategy_change_at`.
- `behavioralPrinciples.ts` expõe `principlesForStage()`, usado apenas para persistir a lista em recomendação/compromisso — não há função de intervenção nem contexto de princípio chegando à camada conversacional.
- `admin_v3_ai_history` consulta `ai_usage_ledger` sem filtro de `workload` (mistura `AGENT_CONVERSATION` com `CATEGORY_BACKGROUND`) e monta a série iterando os dias de `admin_v2_ai_history` — dias que só existem no ledger são perdidos. Não há `coverage`.
- A migration não contém backfill de `agent_memory` para `nino_learning_events`.
- `communication_deliveries` já é a verdade de entrega: o dispatcher grava `recordDelivery(... status: 'delivered' ...)` com `suggestion_id` + `channel` (upsert idempotente por `suggestion_id,channel`), e `candidateFor()` propaga `change_commitment_id` em `evidence` — a ligação necessária já existe e será usada.

## O que será corrigido

### 1. Revalidação material da recomendação
Nova função pura `hasMaterialRecommendationChange(previous, current)` em `changeLoop.ts` (exportada e testada isoladamente), comparando: `stage`, `stage_reason` quando muda a segurança da orientação, `goal_id`, `route`/ação, `amount_role`, `truth_gate.blocked`, capacidade sustentável, `projected_month_end_available` e `monthly_debt_installments` quando afetam prioridade. Materialidade de valor: diferença > `max(R$ 20, 10%)`. Havendo mudança material: recomendação antiga vira `superseded`, a nova é persistida, nenhum compromisso nasce da antiga, e a resposta explica que o cenário mudou.

### 2. Lifecycle do check-in preso à entrega real
- Remover a chamada de `markSelectedChangeFollowups()` do momento do ranking em `pipeline.ts`.
- Nova função `confirmChangeFollowupDelivery(sb, userId, { suggestionId, evidence })` chamada pelo dispatcher **apenas** quando `recordDelivery` registra `status = 'delivered'`.
- Idempotência em duas camadas: `dedup_key` do check-in derivado de `commitment_id + delivery day + suggestion_id`, com unique index; e verificação em `communication_deliveries` para não reprocessar retry da mesma entrega.
- `next_check_at`, `last_check_at`, `last_progress_score` e conclusão do compromisso passam a avançar somente nesse ponto.

### 3. Um compromisso ativo garantido pelo banco
`CREATE UNIQUE INDEX ... ON nino_change_commitments(user_id) WHERE status = 'active'`. A aplicação continua fazendo supersede antes de inserir; em colisão de corrida, o insert falha, o código relê o ativo vigente e devolve esse compromisso (idempotente), sem criar duplicata.

### 4. Motor real de estratégia de intervenção
Nova função pura `resolveChangeStrategy({ outcome, history, dismissals, userRequestedStop, learningProfile })` → `reinforce | remind | reframe | pause`, com regras determinísticas: completed/progress → reinforce; primeiro stall → remind; stall repetido → reframe; regressed → reframe; 2 dispensas → reframe ou pause; pedido explícito → pause. Persistidos: `strategy`, `strategy_reason`, `intervention_attempts`, `dismissals`, `last_outcome`, `last_strategy_change_at`. Reframe só muda linguagem e fricção; qualquer novo valor vem do motor canônico ou de regra determinística registrada — a LLM nunca calcula valor.

### 5. Learning ledger que influencia decisão
Nova camada `buildChangeLearningProfile(userId)` agregando apenas comportamento observado no produto: tipos de intervenção aceitos/ignorados, taxa de sucesso por princípio e por estágio, dispensas, tempo médio até agir, concluídos e abandonados. Consumida por `resolveChangeStrategy` antes de escolher a abordagem. Sem perfil psicológico, sem personalidade, sem diagnóstico emocional. `agent_memory` segue como estado consolidado; o ledger segue como evidência.

### 6. Princípios comportamentais como comportamento de produto
Nova função `resolveBehavioralIntervention({ stage, outcome, learningProfile, principles, financialFacts })` retornando `{ principle, strategy, communication_goal, prohibited_patterns, context_for_llm }`. O `context_for_llm` é injetado explicitamente na camada conversacional (mesmo caminho de contexto que o agente já usa), sem frases prontas de livro e sem cálculo de dinheiro. Ex.: `stabilize_cash` + `margin_of_safety` proíbe mensagem celebratória de investimento.

### 7. `admin_v3_ai_history` correta
Nova versão da RPC: `ai_usage_ledger` filtrado por `workload::text = 'AGENT_CONVERSATION'` (outros workloads apenas via filtro explícito); calendário por UNION dos dias de `agent_runs` e do ledger, com left join nas duas fontes; `agent_runs` continua fonte de runs/path/capability/no_llm_rate/latência E2E; ledger fornece tokens, modelo, custo, `llm_calls` e latência de chamada LLM. Ausência de telemetria permanece `null`, nunca 0. Novo bloco `coverage` com `end_to_end_latency_source`, `token_source`, `first_agent_run_telemetry`, `first_ai_usage_ledger_telemetry`. No frontend, `AiEfficiencyHistoryBoard.tsx`: tokens da série de tokens, latência do gráfico principal rotulada como E2E, latência de chamada LLM (se exibida) com nome próprio.

### 8. Backfill de aprendizado
Na migration, backfill idempotente de `agent_memory` → `nino_learning_events` como `memory_snapshot`, somente metadata segura (`kind`, `source`, `confidence`, `use_count`, timestamps, `subject_key` quando seguro), sem texto livre, `dedup_key = 'backfill:memory:<id>'`. Nenhuma linha de `agent_memory` é alterada ou apagada.

### 9. Constraints e guardrails
Auditoria das linhas atuais antes de criar constraints; normalização só de valores claramente inválidos, com relato do que foi corrigido. Depois: `confidence`/`progress_score`/`last_progress_score` entre 0 e 1, `cadence_days >= 1`, `dismissals >= 0`, e listas fechadas de `status`, `strategy` e `outcome` conforme especificado.

### 10. Aba Aprendizado como prova de evolução
`admin_nino_learning_overview` estendida e `NinoLearningBoard.tsx` ampliado: último evento, estratégia atual, mudanças de estratégia, distribuição de outcomes, princípios mais usados, taxa de aceitação de recomendações, compromissos aceitos/concluídos, recomendações superseded, follow-ups entregues e follow-ups bloqueados/deferred. Nenhum “AI score” inventado.

## Testes

Os testes de string atuais ficam como contract smoke. Novos testes funcionais com mock fiel do cliente de banco cobrindo A–M do pedido: revalidação 800→300 e 800→798, follow-up selecionado mas não entregue, follow-up entregue (um único check-in, `next_check_at` avança uma vez), retry idempotente, dois commits concorrentes com unique ativo, dois stalls → reframe, completed → compromisso concluído e próximo passo recalculável, correção → learning event, perfil de aprendizado mudando a estratégia, série admin_v3 com dia só em `agent_runs` e dia só no ledger, `CATEGORY_BACKGROUND` fora do gráfico de conversa, backfill gerando `memory_snapshot` uma única vez.

## Migration e deploy

Uma migration nova (nenhuma antiga editada), idempotente: constraints, unique parcial de compromisso ativo, campos de estratégia, backfill seguro, substituição de `admin_v3_ai_history`, atualização de `admin_nino_learning_overview`, `NOTIFY pgrst, 'reload schema'`. Depois: suíte completa, typecheck, build, `check:agent-dependents`, mirror do `finance-core`, bump de `AGENT_RUNTIME_VERSION` e redeploy atômico das 9 funções de `DEPENDENTS.md`.

## Smoke test end-to-end

Executarei a sequência de 9 passos pedida (próximo passo → aceite → status → check-in vencido com delivery bloqueada e depois entregue → rejeições mudando estratégia → correção → aba Aprendizado → IA & Inteligência → limites 20/100), consultando o banco a cada passo.

## Formato do fechamento

Reporto causa por problema, arquivo alterado, migration criada, queries executadas, resultado do backfill e contagem de learning events, definição do unique index, resultado das constraints, exemplo de recomendação invalidada por mudança material, exemplo de reframe, prova de check-in pós-delivery e de idempotência, série admin_v3 com dias das duas fontes, confirmação da exclusão de `CATEGORY_BACKGROUND`, resultado dos testes/suíte/build/typecheck, funções publicadas — e qualquer item não concluído declarado explicitamente.
