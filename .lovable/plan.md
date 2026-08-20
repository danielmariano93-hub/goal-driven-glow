# Nino Agente Financeiro Autônomo — auditoria + plano

## 1. Diagnóstico verificado (consultas reais feitas agora)

### P0-A — causa raiz do `confirm_pending_action` (CONFIRMADA)
Não é a `pending_confirmations`: a coluna `payload` existe lá (jsonb), e `agent_execute_transaction_confirmation_v2` a lê corretamente.

O erro vem de um gatilho a jusante. `transactions` tem o trigger `trg_financial_truth_transactions` → `tg_financial_truth_changed()` → `financial_truth_changed()`, que executa:

```sql
UPDATE public.financial_performance_snapshots
   SET invalidated_at = now(),
       payload = COALESCE(payload,'{}'::jsonb) || jsonb_build_object(...)
```

Mas as colunas reais de `financial_performance_snapshots` são: `id, user_id, as_of, mode, headline, methodology, highlights, suppressed, next_action, formula_version, valid_until, invalidated_at, created_at, advisor_stale_at` — **não existe `payload`**. Logo qualquer INSERT/UPDATE/DELETE nessa tabela aborta com `column "payload" does not exist`.

Blast radius (14 tabelas com o mesmo trigger): `transactions, debts, debt_payments, goals, goal_contributions, investments, investment_movements, recurring_entries, recurring_occurrences, credit_card_purchases, credit_card_payments, credit_card_installments, credit_card_statements, document_imports`. Ou seja: **hoje toda escrita financeira do produto está quebrada**, não só o Nino. Evidência em `agent_tool_calls`: 3 falhas (20/08 18:55, 20:34, 21:01), todas `kind='transaction'`.

Correção (sem workaround): recriar `financial_truth_changed` gravando a razão de invalidação em coluna existente (`advisor_stale_at` + `invalidated_at`) ou adicionar `invalidation_reason text` / `invalidation_domains text[]` à tabela — e um teste de contrato que percorre todos os triggers de verdade financeira executando um write real.

### P0-B — `direction = NULL` (hipótese do prompt REFUTADA)
`transactions` confirmadas: 604 no total, **604 com `direction` NULL**, inclusive as 578 já categorizadas. `direction` é coluna de transferência (`transfer_direction`), nunca preenchida em lançamentos comuns, e nenhum motor em `supabase/functions/_shared` filtra por `direction`/`outflow`. Logo `direction` **não** é a causa das 26 sem categoria.

Causa real observada: as 26 sem `category_id` (13 `origin=manual`, 13 `origin=agent`) têm 25 linhas na `category_classification_queue` com `status='completed'`, `last_error='no_longer_eligible'` — o worker as fechou como inelegíveis embora hoje satisfaçam o predicado (`type=expense`, `movement_kind=transaction`, `status=confirmed`, sem transfer/card/split, `category_source` nulo). `completed` é estado terminal e nada as reabre. Falta pinar o predicado exato do RPC de conclusão (passo 1 da implementação) — provável corrida entre o enqueue AFTER INSERT e a varredura de fechamento.

### O que já existe e será reaproveitado (nada de motor paralelo)
`CapabilityRouter`, `ActionPlanner`, `ToolRuntime`, `DeterministicAnswers`, `CompositeExecutor`, `ResponseValidator` (Truth Gate v2), `FinancialContext360`, `ConversationOrchestrator`/`Memory`/`Expectation`, `LearningLoop`, `MemoryStore`, `finance-core` (`canonicalFacts`, `financialComparison`, `financialPerformance`, `categoryProjection`, `cardExposure`, `incomeProjection`, `commitmentAgenda`, `bridges`, `emotionFinance`, `goalStrategy`), proactive `signals/situations/ranking/pipeline`, `merchant*`/`personalHistory`, `brazilianCalendar`/`ninoClock`, `user_advisor_topic_affinity`, `ReplyHumanizer`, `agent_runs`/`agent_tool_calls`.

## 2. Fases

### Fase 0 — P0, complexidade BAIXA/MÉDIA
1. Migration corrigindo `financial_truth_changed` (P0-A) + teste de contrato que faz write real em cada uma das 14 tabelas.
2. Auditoria de escrita ponta a ponta das tools mutáveis (transação, dívida, pagamento, cartão/fatura, meta, aporte, rolê, emoção, recorrência, compromisso, investimento): cada uma passa por REQUEST→PARSE→PLAN→TOOL→DB→VALIDATION→RESPONSE com teste E2E que **relê a linha no banco** antes de o Nino dizer "registrei".
3. Regra dura no `ResponseValidator`: recibo só é emitido com `result.transaction_id` (ou id equivalente) confirmado.

### Fase 1 — ToolOutcome universal + clarificação (P0, MÉDIA)
- Novo `ToolOutcome.ts`: `SUCCESS | NEEDS_INPUT | AMBIGUOUS | NOT_FOUND | EMPTY_STATE | CONFLICT | VALIDATION_ERROR | TECHNICAL_FAILURE`, com `field`, `options[]`, `evidence`. Adaptador retrocompatível com `{ok,result,error}` para não reescrever as ~60 tools de uma vez; tools mutáveis e as de clarificação migram primeiro.
- `ResponseValidator` deixa de converter `NEEDS_INPUT/AMBIGUOUS/EMPTY_STATE` em erro financeiro. `emotion_not_recognized` vira `NEEDS_INPUT(field=emotion)`.
- Slots pendentes: estende `ConversationExpectation`/`StateManager` com `awaiting {operation, slot, partial_payload, expires_at}`; resposta curta preenche o slot em vez de virar nova intenção (vale para cartão, conta, valor, data, categoria, merchant, meta, dívida, recorrência, investimento, compromisso).

### Fase 2 — Capability Registry + Goal Planner (P1, ALTA)
- `CapabilityRegistry.ts`: única fonte declarando por domínio `read/create/update/delete/simulate/execute`, tool, engine, nível de risco e canal. `CapabilityRouter` passa a ler dele (não duplica).
- Matriz FEATURE × CAPABILITY × TOOL × ENGINE × READ × WRITE × TEST × STATUS gerada por script a partir do registry e versionada em `docs/`, cobrindo todos os módulos listados no pedido — é ela que expõe o que existe no app e o Nino ainda não opera.
- `GoalPlanner.ts` acima do router: entende objetivo → monta plano compondo capabilities (sem intent nova por combinação) → executa via `ToolRuntime` → valida. `ActionPlanner` continua dono das rotas determinísticas e do fast path.
- `AutonomyPolicy.ts`: decide executar / executar-e-informar / perguntar / confirmar a partir de confiança, reversibilidade, impacto, ambiguidade e preferência do usuário.
- `ActionReceipts`: recibo curto e uniforme com ações (Editar/Excluir/Desfazer/Pausar) quando o canal permite, reaproveitando `ReceiptBuilder`.

### Fase 3 — Categorização: pipeline + backfill (P0/P1, MÉDIA)
- Unificar o predicado de elegibilidade em **uma** função SQL usada por trigger, claim e complete; `no_longer_eligible` nunca marca `completed` em transação ainda elegível (usa `queued` com backoff) e passa a registrar motivo auditável.
- Backfill idempotente, todos os usuários, respeitando hierarquia: decisão explícita > memória pessoal do merchant > conhecimento global confiável > regra determinística > IA > revisão. Nunca sobrescreve `category_source='user'`. Grava `category_source/confidence/reason/engine_version/classified_at` e emite relatório (analisado, automático, mantido, revisão, erro).
- Merchant intelligence: normalização de variações mantendo prioridade USER EXPLICIT > PERSONAL > GLOBAL.

### Fase 4 — Memória financeira e Advisor Learning (P1, MÉDIA)
- `MemoryStore` ganha campos obrigatórios `source/confidence/updated_at/evidence_count` para merchant→categoria, merchant→conta/cartão, recorrências, salário, hábitos e correções. Inferência nunca vira verdade financeira nem entra em soma.
- Advisor Learning estende `user_advisor_topic_affinity` com sinais de abertura/ignorado/aprofundado/canal/horário/profundidade; afeta apenas ranking, proatividade e forma de resposta.

### Fase 5 — Short Link Service + analytics (P1, BAIXA)
- Tabela `short_links` (`short_code` único imprevisível, `destination`, `user_id`, `source`, `campaign`, `created_at`, `expires_at`, `click_count`, `last_clicked_at`) + `link_clicks`; edge function de resolução em `/r/:code` com autorização validada no destino e zero dado financeiro no código. Todos os canais (WhatsApp, insights, notificações, e-mail) passam a encurtar. Cliques alimentam afinidade com múltiplas evidências (nunca 1 clique = preferência).

### Fase 6 — Relatório do mês como narrativa (P1, ALTA)
Reescrita da experiência em 8 blocos visíveis (resumo/“como estou”, evolução com calendário brasileiro e dias úteis, para onde foi, o que explica a mudança, o que ainda vai acontecer, projeção com faixa e drivers, atenção com poucos highlights, próximas ações), 3–4 gráficos (acumulado vs comparável, composição, entradas × saídas, waterfall da projeção) no design system atual, accordion só para detalhe/metodologia/listas. Todos os números vêm dos engines já existentes — nenhum cálculo novo por canal.

### Fase 7 — Performance, observabilidade e testes (P1, MÉDIA)
- Fast path (registro simples, saldo, "quanto gastei hoje") separado do planned path (afordabilidade, comparações, reorganização de metas); cache de contexto invalidado por mutação.
- `agent_runs` passa a registrar `goal, plan, capabilities, tools, outcomes, confidence, clarifications, execution, validation, latency, final_status`; painel admin responde as 6 perguntas de diagnóstico.
- Suíte agentic com paráfrases (não regex por frase), follow-ups com slot pendente e teste multiusuário A/B garantindo isolamento de aprendizado pessoal.

## 3. Migrations necessárias
1. `financial_truth_changed` corrigida (P0).
2. Elegibilidade única de categorização + reabertura das linhas fechadas indevidamente (P0).
3. `short_links` + `link_clicks` com GRANT/RLS (P1).
4. Extensões de afinidade/memória com `source/confidence/evidence_count` (P1).
5. Colunas de observabilidade em `agent_runs` (P1).

## 4. Riscos, rollout e rollback
- Risco maior: mexer em trigger que hoje intercepta 14 tabelas — mitigado por teste de contrato de write antes do deploy.
- ToolOutcome introduzido por adaptador, migração tool a tool, sem big bang.
- Rollout: Fase 0 → 1 → 3 (backfill em dry-run antes) → 2 → 4/5 → 6 → 7.
- Rollback: migrations reversíveis; backfill idempotente com `category_engine_runs` permitindo desfazer só o que ele escreveu; relatório novo atrás de feature flag.

## 5. Aceite objetivo
Nenhum recibo sem linha persistida; zero `TECHNICAL_FAILURE` em pedidos válidos; "quero registrar minha emoção" → pergunta → "ansioso" conclui; 0 transação confirmada elegível sem categoria após backfill; mesmo número no app, WhatsApp, relatório e insight; relatório responde as 5 perguntas na primeira tela; links curtos em 100% dos canais.
