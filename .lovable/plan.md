# Fechar o loop de autoaprendizado, invalidação e integração do Advisor

## Auditoria — o que encontrei de fato

Confirmado por leitura de código e consulta ao banco:

- `user_advisor_topic_affinity` tem **0 linhas**; `financial_performance_snapshots` tem 1 linha, `invalidated_at = null`.
- `registerTopicSignal()` é chamado em **um único lugar**: `src/components/home/AcompanhamentoCard.tsx` (`opened` ao expandir, `acted` no CTA). Nenhuma outra superfície registra sinal.
- A RPC `advisor_register_topic_signal(_topic_key, _signal)` existe, aplica delta, clampa em -1..+1 e só é executável por `authenticated` — ou seja, **o WhatsApp (service_role, sem sessão) não tem caminho de escrita**, e nada no `_shared/agent` chama a função. Por isso a tabela está vazia.
- `engineTools.ts` **lê** afinidade (`loadTopicAffinity`) para ordenar highlights, mas nunca escreve.
- Invalidação de snapshot existe apenas no cliente (`src/lib/db/invalidation.ts` → update em `financial_performance_snapshots`). Nenhum arquivo em `supabase/functions/` toca essa tabela. Logo: transação criada por WhatsApp/FastLog/importação/cron **não invalida nada** — bug real confirmado.
- Motor proativo (`_shared/proactive/`) monta contexto → `collectFinancialSignals` → situações → `scoreSituations` (usa `insightValue` + aprendizado por `communication_kind`) → `allocateAttention`. **Não consome** `FinancialPerformanceHighlight` nem `user_advisor_topic_affinity`.
- Persona: `PERSONA_INVERSION_RX` em `ResponseValidator.ts` cobre "Ah/Oi/Obrigado, Nino" mas **não cobre "Certo, Nino!" / "Sim, Nino!" / "Beleza, Nino"** — daí o bug passar. O prompt já proíbe, mas sem rede de segurança o modelo escapa.
- `LearningLoop.ts` aprende correções e merchants, sem qualquer ligação com tópicos/afinidade.

## O que vou construir (mudanças mínimas, sem nova arquitetura)

### 1. Camada única de aprendizado (`advisor_learning.v1`)
- `supabase/functions/_shared/finance-core/advisorTopics.ts`: `resolveAdvisorTopicKey()` canônico (`performance:expense`, `performance:category:<slug>`, `card:invoice`, `goal:category`, `debt`, `subscriptions`, `behavior`, `emotion_finance`, …) + normalização de chaves legadas.
- `supabase/functions/_shared/agent/core/AdvisorInteractionLearning.ts`: recebe um evento (`source`, `topic_key`, `signal`, refs) e decide positivo/negativo/neutro/no-learning; grava via RPC de serviço. Sinais e pesos revisados: `acted +0.30`, `asked_more/followed_up +0.20`, `explicit_positive +0.35`, `opened +0.08`, `ignored -0.03` (só com exposição comprovada), `dismissed -0.20`, `marked_not_useful -0.35`; cap de ±0.35 de movimento por dia por tópico para evitar extremos com poucos eventos.
- Espelho no front: `src/lib/nino/advisorLearning.ts`, mesma tabela de pesos, usado por Home, relatórios, insights e CTAs.

### 2. Aprendizado no AgentCore (App + WhatsApp)
- Ao fim de cada turno (`AgentCore.ts`, junto de `learnFromTurn`): derivar tópico do que **realmente aconteceu** — capability executada, tool chamada, escopo de merchant/categoria resolvido, `current_topic` da memória, continuation aceita — e registrar `followed_up`/`asked_more` quando o turno é follow-up do tópico anterior, e sinal forte quando há feedback explícito ("útil", "não quero receber isso", "pare de falar disso").
- Exposição espontânea do Nino **não** gera afinidade (registro apenas em `advisor_interaction_events` com `signal = exposed`, delta 0).
- `preferred_comparison_mode` aprendido por frequência + recência quando o usuário pede recorte ("mesmos dias úteis", "últimos 30 dias", "mesmo ponto do ciclo"); guardado em `agent_memory` (kind `advisor_preference`). Quando aplicado, a resposta **sempre declara a metodologia** (linha de evidência já existente em `answer_format`).
- `LearningLoop.ts`: correções de recorte ("prefiro dias úteis") passam a atualizar a preferência de comparação.

### 3. Histórico auditável + invalidação de ranking
- Nova tabela `advisor_interaction_events` (user, topic_key, signal, source, refs, delta, score_before, score_after, metadata, created_at) com RLS de leitura própria.
- Nova RPC `advisor_register_topic_signal_v2` (`SECURITY DEFINER`, aceita `_user_id` para service_role) que escreve evento + score atomicamente e retorna before/after. A RPC antiga passa a delegar.
- Mudança de afinidade invalida **apenas o ranking do Advisor** (coluna `advisor_stale_at` no snapshot), nunca recalcula comparação financeira.

### 4. Invalidação canônica (`financial_truth_invalidation.v1`)
- Função de banco `financial_truth_changed(_user_id, _reason, _domains[])`: marca `financial_performance_snapshots.invalidated_at`, limpa contexto proativo dependente e registra motivo (auditável).
- Chamada por **trigger** em `transactions` (insert/update/delete), pagamentos/estornos de fatura, faturas, parcelamentos, dívidas e pagamentos, metas, recorrências, compromissos, investimentos/resgates e importações confirmadas — assim App, WhatsApp, FastLog, cron e importação produzem o mesmo efeito, sem depender do cliente.
- `src/lib/db/invalidation.ts` passa a chamar a mesma RPC (uma verdade só) e mantém a limpeza do React Query.

### 5. Performance Highlights → Multi-Finance
- `_shared/proactive/signals.ts` ganha uma fonte adicional que **reaproveita** os highlights já calculados por `financialPerformance` (sem recalcular): `expense_improvement`, `expense_deterioration`, `net_improvement`, `category_deterioration/improvement`, `fixed_cost_increase`, `behavior_improvement`, `timing_effect`, `card_cycle_improvement`.
- Highlight não vira mensagem: continua passando por materialidade → prioridade → attention budget → canal/silêncio.
- `scoreSituations` passa a receber afinidade por tópico e aplicar ajuste de ±25% **apenas em itens opcionais**; `critical` e vencimento ignoram preferência (regra importância financeira > preferência preservada).
- Aprendizado de canal: quando houver evidência suficiente em `communication_deliveries`, ajusta escolha de canal — sem aumentar volume (cota de atenção inalterada).

### 6. Persona
- Ampliar `PERSONA_INVERSION_RX` para os vocativos faltantes (certo/sim/beleza/ok/tá/claro/perfeito/pode/entendi + "Nino") e endereçamento genérico "…, Nino" em final de frase.
- Nome do usuário só do perfil/memória canônica; sem nome disponível, resposta sem nome. Guarda no humanizer para remover vocativo inventado.

### 7. Admin — o que o Nino aprendeu
- Estender `admin_v2_advisor_observability` e `AdvisorObservabilityBoard.tsx`: afinidade (score, sinais, último sinal, score com decaimento), últimos eventos de interação (source, signal, delta, before/after), comparação preferida (modo, confiança, nº de evidências), leitura em linguagem simples ("mais interesse em…", "temas rejeitados…", "comparação preferida…"), e o dry-run mostrando peso financeiro → ajuste de afinidade → relevância final → selecionado/suprimido → canal (sem efeitos colaterais).

## Testes
- Unitários (`src/test/`): 8 casos de learning do pedido (exposição não gera interesse, opened, follow-up, repetição progressiva, "não é útil", "não quero receber isso", tema crítico com afinidade negativa segue elegível, decaimento), pesos/limites e `resolveAdvisorTopicKey`.
- Integração: turno WhatsApp real (Educação → "quais categorias precisam de atenção?" → "faça isso") gerando os tópicos corretos e nenhum tópico aleatório; `preferred_comparison_mode` aprendido e metodologia declarada.
- Invalidação: transação App, WhatsApp, FastLog, importação, edição, exclusão, estorno, dívida e pagamento de fatura — todos invalidando as dependências certas.
- E2E: snapshot vigente → gasto pelo FastLog → snapshot invalidado → nova leitura recalcula refletindo o gasto; e o fluxo completo pergunta → highlight → follow-up → afinidade → novo ranking → admin exibe.

## Depois de implementar
Rodo o cenário real (evolução → categorias que precisam de atenção → oportunidades) e mostro as linhas de `user_advisor_topic_affinity` e `advisor_interaction_events` com topic_key, signal, delta, score final e evidência, mais a tabela REQUISITO / ANTES / IMPLEMENTAÇÃO / ARQUIVO / TESTE / EVIDÊNCIA e o BEFORE vs AFTER dos cinco eixos.

## Arquivos e migrations
Novos: `advisorTopics.ts`, `AdvisorInteractionLearning.ts`, `src/lib/nino/advisorLearning.ts`, testes.
Editados: `AgentCore.ts`, `LearningLoop.ts`, `engineTools.ts`, `ResponseValidator.ts`, `ReplyHumanizer.ts`, `proactive/{signals,ranking,pipeline,contracts}.ts`, `src/lib/db/invalidation.ts`, `AdvisorObservabilityBoard.tsx`, `advisor-dry-run`.
Migrations: `advisor_interaction_events` + grants/RLS, `advisor_register_topic_signal_v2`, `advisor_stale_at`, `financial_truth_changed()` + triggers, extensão da RPC de observabilidade.
