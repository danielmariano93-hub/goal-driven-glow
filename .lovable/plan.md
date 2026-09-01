# Fechamento do Nino Change Agent — conectar os elos que ficaram soltos

Rodada única de fechamento. Escopo travado nos 20 itens cobrados; nada fora disso.

## O que a verificação mostrou (estado real, checado agora)

- `supabase/functions/_shared/proactive/pipeline.ts` empurra a situação de `fund_goal`/`build_wealth` para o ranking **sem** chamar `persistNextActionRecommendation` — a recomendação proativa não existe em `nino_change_recommendations`, então aceitar depois não acha nada.
- `registerChangeDismissal` só aparece em `changeLoop.ts` e no teste: **nenhum caller real**. `dismissals` nunca sai de 0, logo reframe/pause por dispensa nunca dispara.
- `confirmChangeFollowupDelivery` preenche só `communicated` e `dedup_key`; as colunas `delivered_at`, `channel`, `communication_kind` existem na tabela e ficam nulas (dados vão para `evidence.delivery`).
- `next_check_at` é calculado com `isoPlusDays(cadence)` a partir de `Date.now()`, não de `deliveredAt` — entrega reconciliada depois desloca o próximo acompanhamento.
- `buildDueChangeFollowups` monta `body: status.message`; `behavioral_intervention` fica apenas em `evidence` e não chega ao texto entregue.
- Existem as duas assinaturas de `admin_v3_ai_history` no banco (7 e 8 argumentos).
- `AiEfficiencyHistoryBoard.tsx` plota `avg/p50/p95_latency_ms` genéricos e inicia com workload = "todos".
- CHECK de `status` em `nino_change_commitments` aceita `active|paused|completed|superseded|cancelled` — **não** `abandoned`, que é o valor que `buildChangeLearningProfilePure` procura.
- Não há CHECK para `dismissals >= 0` nem `intervention_attempts >= 0`; hoje existem **0 linhas inválidas**.
- Produção: `nino_change_recommendations = 0`, `nino_change_commitments = 0`, `nino_change_checkins = 0` — o fluxo nunca rodou de ponta a ponta.

## O que será feito

### 1. Intervenção comportamental chega à mensagem real
- `changeLoop.ts`: o follow-up passa a carregar `behavioral_intervention` como instrução de comunicação (principle, strategy, communication_goal, prohibited_patterns, context_for_llm) no candidato, não só na evidência.
- `CommunicationDispatcherV3.ts`: ao renderizar o candidato de mudança, a instrução é passada à camada de geração de texto; a moldura determinística (valor, estágio, ação, rota) continua vinda do motor. A camada de linguagem pode adaptar tom e naturalidade e nada mais — proibido recalcular valor, trocar estágio, criar percentual, criar nova recomendação ou violar `prohibited_patterns`. Se a geração falhar ou violar a moldura, cai no texto determinístico atual.
- Vale para reinforce, remind, reframe e acompanhamento de commitment.

### 2. Dispensa real alimenta a estratégia
- Ponto de captura: os feedbacks que já existem no produto (`my_proactive_suggestion_feedback` com `dismissed`, `my_communication_feedback` com `dismissed`, `my_nino_item_feedback` com `dismiss`) e o pedido explícito em conversa ("pare de acompanhar isso").
- No tick proativo, antes do ranking, um reconciliador lê esses feedbacks recentes cuja evidência tem `change_commitment_id` e chama `registerChangeDismissal` — idempotente por `dedup_key` em `nino_learning_events` (`change_dismissal:<commitment>:<feedback>`), sem fila nova.
- Pedido explícito de parar → `pause` imediato, sem esperar contagem.
- Escala mantida: 1 dispensa segue em remind, 2 vira reframe, 4 vira pause.

### 3. Recomendação proativa persistida
- `pipeline.ts`: quando a NextBestAction elegível virar situação, chamar `persistNextActionRecommendation(..., "proactive")` com o mesmo dedup idempotente (nada duplica por tick) e colocar `change_recommendation_id` na evidência da situação.
- `commitLatestRecommendation` passa a achar essa recomendação quando o usuário aceita o que recebeu proativamente.

### 4. Latência: E2E separado de IA
- Gráfico "Latência do Nino" usa exclusivamente `e2e_avg/p50/p95_latency_ms` (origem `agent_runs`). Dia sem E2E mostra ausência de dado, sem coalesce com IA.
- Novo bloco "Latência das chamadas de IA" com `ai_avg/p50/p95_latency_ms`.

### 5. Default de workload
- `AiEfficiencyHistoryBoard.tsx` abre em `AGENT_CONVERSATION`; o admin pode trocar para todos ou outro workload.

### 6. Overload antigo
- Auditar consumidores das 7 posições (frontend, edge, RPCs). Se nenhum depender, `DROP FUNCTION public.admin_v3_ai_history(date,date,text,text,text,text,text)` na migration nova. Se algum depender, migrar o consumidor primeiro e justificar na resposta.

### 7. `abandoned` → `cancelled`
- `buildChangeLearningProfilePure` passa a contar `cancelled` como compromisso encerrado pelo usuário (`commitments_abandoned` mantém o nome do campo ou é renomeado para `commitments_cancelled`, com o frontend acompanhando). Nenhum código fica procurando status impossível.

### 8. Colunas estruturadas e cadência real
- `confirmChangeFollowupDelivery` grava `communicated`, `delivered_at`, `channel`, `communication_kind`, `dedup_key` nas colunas; `evidence` continua como trilha.
- Novo helper `isoPlusDaysFrom(base, days)`: `next_check_at = deliveredAt + cadence_days`.

### 9. Aprendizado influenciando de verdade
- `buildChangeLearningProfile` consome `change_dismissal`, resultados por estratégia, por estágio e por princípio; `resolveChangeStrategy` e `resolveBehavioralIntervention` já leem o perfil e passam a receber esses sinais preenchidos — princípio sem sucesso perde a vez para princípio com sucesso. Sem score arbitrário, sem personalidade, sem diagnóstico emocional.

### 10. Admin — aba Aprendizado
- Exibir/validar: estratégia atual e razão, tentativas, dispensas, último resultado, princípios usados, resultados por estratégia, check-ins com entrega confirmada, dispensas registradas, origem da recomendação (chat/proactive/app) e aceitos/superseded/cancelados.

### 11. Migration nova (nada de editar migration aplicada)
- `CHECK dismissals >= 0` e `CHECK intervention_attempts >= 0` (validado: 0 linhas inválidas hoje).
- Ajuste de semântica `cancelled` se precisar de default/comentário.
- `DROP` do overload antigo, se seguro.
- Sem apagar histórico, learning events, memória ou transações.

### 12. Testes de integração reais
- Suíte nova com cliente de banco fiel (fake com as mesmas restrições: unicidade de commitment ativo, dedup de check-in, CHECKs) cobrindo A–N do pedido: persistência de recomendação, aceite de recomendação proativa, supersede material 800→300 e não-supersede 800→798, único commitment ativo, follow-up sem entrega não gera check-in nem move `next_check_at`, entrega gera 1 check-in com colunas preenchidas e `next_check_at = deliveredAt + cadência`, retry não duplica, 2 stalls → reframe, 4 dispensas → pause, dispensa real registra `change_dismissal`, princípio B ganha do A, E2E só de `agent_runs`, `CATEGORY_BACKGROUND` não contamina `AGENT_CONVERSATION`.

### 13. Runtime e deploy
- Bump de `AGENT_RUNTIME_VERSION`, sincronizar `finance-core` e redeploy atômico das 9 funções de `DEPENDENTS.md` (inclui agente/chat, `agent-proactive-tick`, dispatcher e caminho do LearningLoop).

### 14. Smoke test
- Após o deploy, tentar o ciclo completo em usuário seguro/execução sem efeito financeiro: next best action → recomendação → aceite → commitment → follow-up → entrega em canal controlado → check-in → learning event → leitura no Admin. Sem transação financeira inventada. Se não existir usuário seguro, o teste integrado isolado vale e a resposta dirá explicitamente que produção **não** foi smoke-testada.

## Resposta final
Entrego os 22 itens exigidos: arquivos alterados, migration, mudanças de schema, destino do overload, onde a intervenção entra na comunicação, onde `registerChangeDismissal` é chamado, como a recomendação proativa é persistida com exemplos de recomendação/commitment, query do check-in com `delivered_at`/`channel`/`communication_kind`/`communicated`, prova de `next_check_at`, exemplos de reinforce→reframe, dispensa→pause e troca de princípio, prova do E2E vindo de `agent_runs`, default `AGENT_CONVERSATION`, resultados de teste integrado/suíte/build/typecheck, funções redeployadas e qualquer item não concluído.
