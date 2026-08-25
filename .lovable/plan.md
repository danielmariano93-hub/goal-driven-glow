# Plano fechado — contenção estrutural de consumo de IA do Nino

## 1. Diagnóstico comprovado

Leituras feitas em código, cron e banco confirmam a hipótese principal, com um agravante:

- O cron `nino-category-truth-v2-worker` está ativo a cada minuto e chama `category-engine` com `process_queue_global` e `limit=100`.
- `category-engine/index.ts` chama `inferWithAi()` para todo lote que sobra como `leave_unresolved` depois do determinístico.
- O fallback de IA é uma chamada por usuário/lote, não uma chamada por merchant deduplicado. O prompt envia todas as categorias do usuário/tipo e até ~100 itens.
- `persistDecision()` grava uma decisão mesmo quando o resultado é `leave_unresolved`, depois atualiza a própria `transactions` com `category_id=null`, `category_source=null`, `category_review_status='needs_review'`, `category_engine_version` e `category_decision_id`.
- O trigger `transactions_enqueue_categorization` escuta `UPDATE OF category_id, category_source, description, friendly_description, normalized_description, type, movement_kind, status`. Mesmo quando o valor semântico não muda, o `SET` feito pelo worker participa do trigger.
- A função `claim_category_classification_batch` tem uma etapa de “self-heal” que reabre `completed` para `queued`, zera `attempts` e põe `available_at=now()` sempre que `transaction_needs_categorization()` ainda retorna true.
- `transaction_needs_categorization()` considera que uma transação sem categoria confiável ainda “precisa categorizar”; ela ignora `category_review_status='needs_review'`, `category_engine_version`, tentativa anterior e evidência já tentada.

Conclusão: `needs_review` hoje não é terminal. O ciclo real é:

```text
transaction sem categoria confiável
→ fila
→ worker
→ determinístico não resolve
→ IA tenta
→ baixa confiança/null/saída inválida ou sem category confiável
→ persistDecision grava needs_review + metadados
→ trigger/claim self-heal reabre a mesma transaction
→ próxima execução repete com a mesma evidência
```

## 2. Evidência quantitativa de hoje

- Desde 00:00 UTC de 25/08 até a auditoria: `100.425` decisões de categorização para apenas `242` transações.
- Média: `~415` decisões por transação; p50 `436`; p95 `~507`; máximo `511`.
- `97.369` decisões terminaram como `leave_unresolved`.
- `0` decisões foram persistidas com `source='llm'`, apesar de o Gateway ter sido chamado: a IA foi acionada, mas a resposta não virou decisão confiável.
- Top transações aparecem com uma decisão por minuto durante horas.
- O loop não começou hoje: há ~6.000 decisões/hora desde 21/08. A diferença de hoje foi a IA voltar a estar disponível/cobrando, transformando um loop barato em loop caro.
- `agent_runs` do agente principal hoje confirma a auditoria externa: 9 runs, 67.664 tokens in, 1.429 tokens out, custo estimado interno `~US$0,010`.
- `document_imports` não mostrou importação relevante hoje no intervalo auditado.
- AI Gateway logs hoje mostraram 659 chamadas até 16:42 UTC; 643 eram `google/gemini-3.6-flash`. Uma amostra detalhada confirmou prompt de categorização com ~97 itens e categorias completas.

Estimativa honesta de custo: sem export agregada do Gateway não dá para reconciliar centavo a centavo. O comprovado é que o agente normal explica ~US$0,01. A amostra das chamadas do `category-engine` variou de ~0,004 a ~0,05 crédito por chamada; 643 chamadas colocam a contribuição provável do loop em ordem de grandeza compatível com a queda de ~US$11. O gasto exato deve ser fechado após o ledger único proposto abaixo.

## 3. Causa raiz técnica

A causa não é “cron frequente” isoladamente. A causa é falta de idempotência semântica:

1. Não existe `evidence_hash` persistido para dizer “esta evidência já foi tentada nesta versão do motor”.
2. `needs_review` não é tratado como estado terminal temporário.
3. O claim reabre `completed` automaticamente enquanto a transação seguir sem categoria confiável.
4. O trigger reage a updates técnicos do próprio worker.
5. `inferWithAi()` não consulta cache/tentativa anterior antes de gastar IA.
6. O category-engine não registra tokens/custo em um ledger unificado e não tem budget próprio.

## 4. Hotfix estrutural escolhido

Desenho simples e robusto:

- Criar uma chave semântica por evidência: `evidence_hash = sha256(user_id + transaction_id + type + normalized merchant/description + movement_kind + category taxonomy version + engine_version + relevant preference/consensus version)`.
- Criar tabela de tentativas semânticas com unicidade em `(transaction_id, evidence_hash, engine_version)`.
- Quando uma tentativa termina `leave_unresolved` ou `suggest_review`, gravar estado terminal temporário: `needs_review_until_new_evidence`.
- O worker só pode reprocessar se:
  - `evidence_hash` mudou; ou
  - `engine_version`/regra categórica mudou; ou
  - preferência pessoal/consenso global relevante mudou; ou
  - usuário pediu retry explícito; ou
  - houve falha técnica retryable ainda dentro do limite.
- `claim_category_classification_batch` deixa de reabrir `completed` sem nova evidência.
- Trigger passa a usar `IS DISTINCT FROM` e `evidence_hash`; updates técnicos do worker não reenfileiram.
- `persistDecision()` deixa de fazer update destrutivo/ruidoso quando não há mudança semântica. Para unresolved, grava status e tentativa, mas não dispara novo ciclo.

## 5. IA no category-engine: nova regra conservadora

`inferWithAi()` só roda se todos forem verdadeiros:

- descrição/merchant tem informação mínima útil após normalização;
- item é elegível e não é transferência, fatura, investimento, refund técnico ou split;
- não existe tentativa AI anterior para o mesmo `(user_id, type, merchant_key, semantic_context_hash, engine_version)`;
- candidatos estão restritos ao tipo correto e em lista pequena/útil;
- não há preferência pessoal, alias, histórico confiável, conhecimento global verificado ou regra determinística suficiente;
- workload `CATEGORY_BACKGROUND` está dentro de budget e circuito fechado;
- lote foi deduplicado por merchant/contexto.

Se a IA responde null, baixa confiança, schema inválido ou “não sei”: não há retry automático. O item fica `needs_review` até nova evidência.

## 6. Batching e cache de inferência

Substituir o lote “100 transações brutas” por lote semântico:

- agrupar por `user_id + type`;
- normalizar `merchant_key`;
- deduplicar merchants repetidos dentro do lote;
- chamar IA no máximo uma vez por `user_id + type + merchant_key + semantic_context_hash + engine_version`;
- cachear em `category_ai_inference_cache` com resultado, confiança, prompt hash, modelo, tokens e status;
- TTL padrão: 90 dias para `null/low_confidence`, 180 dias para sugestão útil;
- invalidar quando usuário confirma/corrige, categoria relevante muda, regra nova entra, consenso global muda ou engine_version muda.

Resultado esperado: 100 transações com 10 merchants desconhecidos geram no máximo 10 inferências; se forem as mesmas evidências já tentadas, geram 0.

## 7. Ledger único de uso de IA

Criar um ledger de todo uso de IA do projeto, não só `agent_runs`.

Tabela proposta: `ai_usage_ledger`.

Campos principais:

- `occurred_at`, `workload`, `function_name`, `operation`, `user_id`, `run_id`;
- `model`, `provider`, `operation_type`;
- `input_tokens`, `output_tokens`, `cached_tokens`;
- `estimated_cost_usd`, `provider_cost_usd` nullable;
- `success`, `http_status`, `error_code`, `latency_ms`;
- `batch_size`, `unique_items`, `idempotency_key`, `retry_number`;
- `reason_for_ai_call`, `prompt_hash`, `payload_bytes`;
- `metadata` para dimensões não financeiras.

Não inventar custo de provedor. Quando só houver tokens, estimar por tabela interna e marcar como estimado.

Workloads obrigatórios no ledger:

- `AGENT_CONVERSATION`
- `CATEGORY_BACKGROUND`
- `CATEGORY_ONDEMAND`
- `DOCUMENT_INGEST`
- `PROACTIVE`
- `INSIGHTS`
- `ADVISOR_REPORTS`
- `AUDIO_TRANSCRIPTION_APP`
- `AUDIO_TRANSCRIPTION_WHATSAPP`
- `ANTICIPATION`
- `OTHER_AI`

## 8. Budgets e circuit breakers por workload

Criar `ai_workload_budgets` e `ai_workload_circuits`.

Configurações por workload:

- `max_ai_calls_per_hour`
- `max_ai_calls_per_day`
- `max_estimated_cost_per_hour`
- `max_estimated_cost_per_day`
- `max_items_per_run`
- `max_retries_per_evidence`
- `priority`
- `enabled`

Default inicial recomendado:

- `AGENT_CONVERSATION`: prioridade máxima, budget separado.
- `CATEGORY_BACKGROUND`: baixo e conservador; ao estourar, pausa só categorização em background.
- `CATEGORY_ONDEMAND`: maior que background, mas ainda limitado por usuário.
- `DOCUMENT_INGEST`: budget por documento + por dia.
- `PROACTIVE/INSIGHTS/ADVISOR`: budgets próprios e fallback determinístico.

Circuit breakers automáticos:

- mesma transação/evidência > 2 tentativas;
- unresolved rate > 80% por 3 batches;
- chamadas/minuto > 5x baseline;
- custo/hora > threshold;
- mesmo merchant repetido > N vezes;
- schema inválido repetido do modelo;
- 402/403 pausa workload e gateway global conforme semântica existente;
- 429/5xx usa backoff limitado e estaciona até próxima janela.

Se `CATEGORY_BACKGROUND` abrir circuito, o agente conversacional continua usando IA normalmente.

## 9. Política de retry

- Falha técnica HTTP/provider (`429`, `5xx`, timeout): retry limitado, backoff exponencial com jitter, máximo configurável, ledger com `retry_number`.
- Falha semântica (`null`, baixa confiança, schema sem confiança, “não sei”): sem retry automático; estado `needs_review` até nova evidência.
- Mudança semântica real: novo `evidence_hash`; nova tentativa permitida dentro do budget.

## 10. Backfills

Backfill de categorização passa a exigir:

- dry-run/count antes;
- teto absoluto de itens;
- checkpoint persistido;
- budget explícito;
- idempotency por evidence hash;
- opção `ai_enabled=false` por padrão;
- execução manual/admin explícita para backfill com IA;
- nunca reabrir tentativa terminal sem nova evidência.

## 11. Saneamento seguro do estado atual

Sem DELETE cego.

Após aprovação:

1. Congelar somente o workload `CATEGORY_BACKGROUND` via circuito próprio.
2. Marcar filas repetidas como `completed`/terminal quando a transação está `needs_review` e a evidência atual já tem decisão repetida.
3. Criar tentativas semânticas retroativas a partir de `category_decisions` repetidas, preservando auditoria.
4. Consolidar contadores por transação/evidência para análise admin.
5. Liberar filas apenas quando `evidence_hash` atual não tiver tentativa terminal.
6. Não alterar categorias válidas, lançamentos, valores, saldos, dívidas ou fórmulas financeiras.

## 12. Mapa de workloads e risco

- CRITICAL: `category-engine` background. Cron 1 minuto, loop confirmado, sem budget, sem ledger, sem terminal state.
- HIGH: `assistant-ingest-document`. Fan-out por fragmento/documento, retry estrito e custo proporcional ao arquivo; precisa ledger/budget por documento.
- HIGH: áudio WhatsApp. Entrada externa; precisa rate/budget por telefone/usuário e ledger.
- MEDIUM: agente conversacional/tool loop. Já tem boa telemetria em `agent_runs`, mas deve entrar no ledger único e budget prioritário.
- MEDIUM: `insights-generate`. Limitado a uma reescrita por lote e fallback determinístico, mas precisa ledger/budget por workload.
- MEDIUM: `financial-reports-generate`. Idempotente e com guardrail, mas usa modelo caro e precisa ledger/budget.
- LOW: `native-audio-transcribe`. Sob demanda, limites de tamanho/duração e circuito existente; falta ledger.

## 13. Alterações exatas por arquivo

Banco/migrations:

- Criar `ai_usage_ledger`.
- Criar `ai_workload_budgets`.
- Criar `ai_workload_circuits`.
- Criar `category_classification_attempts`.
- Criar `category_ai_inference_cache`.
- Adicionar `evidence_hash`, `terminal_reason`, `last_semantic_attempt_at` à fila, se necessário.
- Atualizar `transaction_needs_categorization()`.
- Atualizar `claim_category_classification_batch()`.
- Atualizar `enqueue_transaction_categorization_after()`.
- Ajustar trigger `transactions_enqueue_categorization` para semântica real.
- Criar RPCs admin/read-model para custo por workload.

Código:

- `supabase/functions/category-engine/index.ts`: evidence hash, terminal state, cache, budgets, ledger, retry policy, dedup por merchant.
- `supabase/functions/_shared/categorization/engine.ts`: critérios conservadores e metadata de decisão.
- `supabase/functions/_shared/aiUsageLedger.ts` novo helper.
- `supabase/functions/_shared/aiWorkloadBudget.ts` novo helper.
- `supabase/functions/_shared/aiCircuit.ts`: manter circuito global para 402/403, adicionar circuitos por workload sem derrubar conversa.
- `supabase/functions/assistant-ingest-document/index.ts`: ledger/budget por documento/fragmento.
- `supabase/functions/insights-generate/index.ts`: ledger/budget.
- `supabase/functions/financial-reports-generate/index.ts`: ledger/budget.
- `supabase/functions/native-audio-transcribe/index.ts`: ledger/budget.
- `supabase/functions/_shared/messaging/wahaMedia.ts`: ledger/budget/rate para áudio WhatsApp.
- `supabase/functions/_shared/agent/llm.ts` e `AgentCore.ts`: espelhar chamadas no ledger único mantendo `agent_runs`.
- Admin `Nino & IA / Custo e uso`: incluir Background AI, custos por workload, AI calls/item, unresolved rate, retry rate, circuit state e alertas.

## 14. Admin e alertas

Painel deve mostrar custo real do projeto separado por:

- Conversational Agent
- Category Engine
- Documents
- Proactive
- Insights/Advisor
- Audio
- Other AI

Métricas:

- tokens in/out/cached;
- chamadas;
- custo estimado;
- custo provider quando houver;
- itens processados;
- AI calls/item;
- unresolved rate;
- retry rate;
- circuit status;
- top idempotency keys/merchants/transações por custo.

Alertas internos configuráveis:

- background AI > US$0,50/h;
- category engine > US$2/dia;
- >2 AI attempts para mesma evidência;
- spike 5x baseline;
- unresolved >80% por vários batches.

Alertas vão para Admin/observabilidade, não para usuário final.

## 15. Testes obrigatórios

- Unresolved tenta uma vez, vira `needs_review`, não volta à fila com mesma evidência.
- Mesmo cron 100 vezes: 0 novas AI calls para item já tentado.
- Description muda: novo hash, 1 nova tentativa permitida.
- Timeout/provider: retry técnico limitado + backoff.
- Baixa confiança/null: sem retry automático.
- 100 transações/10 merchants: dedup por merchant/contexto.
- Circuito `CATEGORY_BACKGROUND` aberto: agente conversacional continua.
- Budget horário atingido: category AI pausa sem perda de dados.
- Toda chamada AI aparece no ledger.
- Nenhuma fórmula financeira muda.
- Backfill dry-run/checkpoint/teto/idempotência.

## 16. Rollout

1. Migration estrutural sem mudar fórmulas financeiras.
2. Deploy do helper de ledger/budget.
3. Deploy do `category-engine` com circuito de background inicialmente em modo conservador.
4. Saneamento seguro da fila atual.
5. Deploy dos demais workloads com ledger/budget.
6. Atualização do Admin.
7. Validação com dados reais: custo/hora, chamadas/minuto, unresolved rate, agent conversation funcionando.
8. Reabrir `CATEGORY_BACKGROUND` com budget pequeno e monitoramento.

## 17. Rollback

- Feature flags para desativar IA do category background mantendo determinístico.
- Manter tabelas de ledger/attempts como auditoria; rollback não apaga histórico.
- Reverter trigger/funções para versão anterior somente se necessário, mas nunca remover o circuito de emergência.
- Se houver regressão, category-engine fica deterministic-only e itens ambíguos permanecem `needs_review`.

## 18. Impacto esperado

- Repetição infinita da mesma evidência: eliminada.
- Category background: de centenas de chamadas repetidas para no máximo uma tentativa por evidência/merchant/contexto.
- `needs_review`: passa a ser terminal até nova evidência.
- Conversa do Nino: preservada e isolada de budgets secundários.
- Admin: deixa de mostrar só `agent_runs` e passa a representar todo o custo de IA do projeto.
- Qualidade: preserva hierarquia correta — escolha do usuário, preferência pessoal, alias/histórico, conhecimento global, regras determinísticas, IA útil, e pendência quando não houver segurança.

## Critérios de aceite

- [ ] Mesma transaction/evidence não chama IA indefinidamente.
- [ ] `unresolved/needs_review` é terminal até nova evidência.
- [ ] Worker de categoria é idempotente.
- [ ] Category background tem budget próprio.
- [ ] Circuit breaker por workload funciona.
- [ ] IA conversacional não é afetada por budget de categoria.
- [ ] Todos os workloads registram tokens/custo no ledger.
- [ ] Admin mostra custo completo do projeto.
- [ ] Retries técnicos são limitados.
- [ ] Retries semânticos dependem de nova evidência.
- [ ] Backfills têm teto, checkpoint e dry-run.
- [ ] Nenhuma fórmula financeira é alterada.
- [ ] Qualidade de categorização é preservada.
- [ ] Testes cobrem regressão do loop.
