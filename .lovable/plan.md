# Nino — Autoridade Semântica de Leitura + Workflows Duráveis de Escrita

Patch único, em cima do `semantic_ir_v3` atual. Sem quarto pipeline, sem reescrita.

## O que muda para quem usa

- "Quanto eu gasto com alimentação por mês?" passa a ser respondido como pergunta de hábito: média típica dos últimos 6 meses fechados, com a premissa declarada na resposta ("Nos últimos 6 meses completos..."), e nunca mais com o parcial do mês corrente nem com um resumo geral.
- O Nino assume o padrão do assessor quando é seguro, em vez de perguntar. Só pergunta quando a dúvida muda o número de verdade (dois cartões com o mesmo nome, três metas plausíveis).
- Quando não existe cálculo canônico para a pergunta, ele diz isso. Nunca responde uma pergunta parecida.
- No WhatsApp, tarefas de várias mensagens passam a se concluir: "quero criar um rolê" → "Jantar" → "300" → "João e Maria" → prévia → "Salvar". O mesmo para meta, meta conjunta, aporte, dívida, transferência e pagamento de fatura.

## Estado real do código (verificado neste turno)

| Item | Situação no HEAD |
| --- | --- |
| Contrato do IR | `FinancialQueryIR.ts` — v1 e `financial_query_ir.v2` (multi-query, `MAX_IR_QUERIES=4`, ordem topológica). Query = metric × operation × group_by × filters × limit. **Não existe** `time.aspect`, `grain`, `reduce`/`statistic`. Período é um único `{from,to}` no envelope, não por query. |
| Filtros | `IRCapabilityAdapter.ts:39-46` já propaga `category/card/account/payment_method`; `onlyFilters` já faz fail-closed. **Bug F já corrigido** — só falta teste de regressão. |
| Mapeamento | `IRCapabilityAdapter.capabilityFromFinancialIR` ainda exige `queries.length === 1` (linha 199); `mappingsFromIR` já é por query. |
| Concorrência de rota | `IntentResolver.ts:126-151`, `CapabilityRouter.ts:84-440` ainda apontam `get_financial_snapshot` como `required_tool` para vários intents; `AgentCore.ts:1120-1170` mantém `rescue`, `canonical_fallback` e `executed_by: legacy_router` em `compiler_failed`. `TruthValidator` rescue (linhas 1951-2012) pode reexecutar tool escolhida fora do IR. |
| Tempo | `_shared/analytics/periodResolver.ts` (`resolvePeriodPt`, `resolvePeriodRolesPt`) cobre "mês passado", "últimos N dias/meses", "mesmo período do mês passado". **Não tem aspecto habitual/typical**, nem "N meses completos", nem `exclude_partial`. |
| Grounding | `GroundingGateV3.ts` valida número/percentual/ranking/direção/ausência. Não existe comparação `requested_ir` × `executed_ir`. Tools não devolvem `executed_ir`. |
| Estado de tópico | `ConversationTopicState.ts` guarda `ir`, `period`, `entities`, `pending_clarification`, `status`. Faltam `executed_ir`, `failed_slots`, `preserved_slots`, `repair_count`. |
| Escrita | Tools reais: `create_split_expense_draft`, `create_transaction_draft`, `create_transfer_draft`, `pay_credit_card_bill_draft`, `create_goal_draft`, `add_goal_contribution_draft`, `create_debt_draft`, `create_shared_goal_draft`, `add_shared_goal_contribution_draft`, `draft_transaction_update`, `draft_transaction_delete`, `confirm_pending_action`, `cancel_pending_action`. **Não existe** draft canônico para: meta de gasto por categoria, recorrência, investimento, marcar recebível pago, pagamento de dívida. |
| Workflow multi-turn | Não existe. Há `ConversationExpectation` (kind `entry_slot`, TTL 12h) e `ConfirmationFastPath`/`PendingConfirmations` (T0, transacional). Estado durável disponível: `agent_sessions.state` jsonb. |

### Conflitos com a especificação

1. O IR atual não tem os slots `time.aspect/grain/reduce/statistic`. Exige **`financial_query_ir.v3`** com canonicalizer v1/v2 → v3 e período **por query**. É a única mudança de contrato de verdade do patch.
2. `executed_ir` real exige mudar a superfície de retorno das engines de leitura. Faremos por envelope no `ToolRuntime`, com as engines alcançadas pelo READ semântico declarando os defaults efetivos — nunca inferido pelo nome da tool.
3. A meta "não perguntar demais" (D) e "fail closed" (A) só coexistem com uma **tabela de defaults de assessor** declarada em código; sem ela, rigor viraria hesitação.
4. Cobertura WhatsApp completa dos 5 domínios sem draft canônico exigiria novos drafts. Proposta: entram no patch os que reaproveitam RPC/serviço já existente do app (pagamento de dívida, marcar recebível pago, meta de gasto por categoria); recorrência e investimento ficam **fora** com gap declarado, porque não têm caminho de escrita canônico reutilizável e inventar INSERT seria violar o ledger.

## Implementação, arquivo por arquivo

### Fase 1 — Contrato canônico (base de tudo)

- `core/FinancialQueryIR.ts`: adicionar `financial_query_ir.v3`. Por query: `metric`, `filters`, `time: {aspect: point_in_time|mtd|calendar|rolling|last_n_complete|habitual|projection|trend, window, from, to, n, exclude_partial}`, `grain: none|day|month`, `reduce: none|sum|typical|mean|median|rate`, `group_by`, `limit`, `depends_on`. `normalizeToV3()` canonicaliza v1/v2 (período do envelope → `time` de cada query, `operation` → par `reduce`/`aspect`). `validateFinancialIRv3()` com combinações proibidas (`habitual` sem `grain=month`, `typical` sem janela múltipla, etc.). v2 continua existindo só como entrada do canonicalizer.
- `core/SemanticIRCompat.ts` (novo): ponte v3 → forma legada que adapters/validator consomem hoje, para migrar por etapas sem duas semânticas vivas.

### Fase 2 — Resolvers canônicos

- `_shared/analytics/periodResolver.ts`: adicionar `resolveTimeAspectPt(text, now)` retornando `time` v3 + `assumption` textual + `ambiguous`. Regras exatas da especificação C, incluindo `last_n_complete` n=6, `exclude_partial`, mediana como típico, `mean` explícita em "média", `ambiguous` em vez de default silencioso para MTD.
- `core/resolvers/TimeAspectResolver.ts` (novo): wrapper que aplica precedência resolver > LLM em todo READ financeiro, incluindo fast paths.
- `core/resolvers/CategoryResolver.ts`, `InstrumentResolver.ts`, `NamedEntityResolver.ts` (novos): resolvem contra dados reais do usuário (categorias com globais, contas/cartões, metas/dívidas/rolês), retornam `resolved | ambiguous | missing`; `missing` é fail closed, nunca "primeiro item".
- `core/resolvers/AssessorDefaults.ts` (novo): defaults declarados de baixo risco (janela habitual, mediana, moeda, escopo de despesa) com texto de premissa. Requisito D vive aqui.

### Fase 3 — Preservação como type-check único

- `core/SemanticPreservation.ts` (novo): função pura `requestedSubsumesExecuted(requested, executed)` comparando metric, filtros (perdido → reject; extra → reject salvo política de narrowing declarada), aspect, janela, from/to, grain, reduce/statistic, group_by. Aplicada **por query e no agregado** do plano.
- `core/FinancialPlanValidator.ts`: chamar a mesma função antes de executar (plano) e rejeitar mapeamento incompatível em vez de aproximar.
- `core/GroundingGateV3.ts` e `core/EvidenceClaims.ts`: reutilizar a mesma função depois da execução; claim de domínio não pedido (saldo, dívida, cartão) não é gerado. Sem segundo juiz, sem LLM-as-judge.
- `core/EvidencePack.ts`: passar a carregar `requested_ir`, `executed_ir`, `allowed_claims` e proveniência.

### Fase 4 — `executed_ir` real

- `core/ToolRuntime.ts`: `ToolExecution` ganha `executed_ir | null`; envelope compõe args normalizados + o que a engine declarou.
- `tools.ts` (engines de leitura alcançadas pelo READ semântico: `analyze_spending`, `analyze_merchants`, `compare_periods`, `compare_financial_metric`, `explain_spending_change`, `spending_timeseries_daily`, `spending_average_daily_trend`, `forecast_month_close`, `analyze_longitudinal_trajectory`, `get_financial_snapshot`, `get_net_worth`, `get_debt_status`, `get_goals_overview`, `get_future_installments`, `assess_financial_health`): cada uma devolve `executed_ir` com metric, filtros resolvidos, janela efetiva, grain, reduce e `partial`. Engine que aplica default interno devolve o default usado.
- `core/IRCapabilityAdapter.ts`: mapear por query (remover a exigência de `queries.length === 1` em `capabilityFromFinancialIR`), receber `time` por query e ampliar `EXECUTABLE_ONTOLOGY` com o shape habitual.

### Fase 5 — Shape handler típico mensal

- `core/handlers/TypicalMonthlyHandler.ts` (novo): dispara pelo **shape do IR** (`expense_amount` + filtros opcionais + `grain=month` + `last_n_complete` + `reduce=typical`). Política v1 exatamente como especificada: 6 meses completos, mês corrente fora, mínimo 3 meses com ressalva abaixo disso, mediana principal, `mean` quando pedido, mean auxiliar sempre, divergência ≥20% mencionada com os dois números, mês sem cobertura ≠ mês zero real. Leitura agregada única por mês de competência (usando `reportingCompetenceDate` e `fetchAllPages`), não 6 RTTs; benchmark p50/p95 no teste.
- `core/SemanticAnswerFormatter.ts`: formato que declara a premissa e a ressalva.

### Fase 6 — Autoridade única no hot path

- `core/AgentCore.ts`: em READ financeiro, antes do IR só rodam auth/canal/idempotência, dialogue act, READ/WRITE/casual e confirmação. Bloquear comportamento concorrente: `IntentResolver`/`CapabilityRouter` não definem tool/métrica/período/categoria/snapshot; `rescue` e `canonical_fallback` (linhas 1120-1170) só podem produzir falha honesta ou motor derivado do próprio IR; rescue do TruthValidator (1951-2012) restrito a reexecutar a tool já autorizada pelo IR. Snapshot só quando o IR pediu `balance`/`financial_health`.
- `core/ProtectedAnalyticalRouting.ts`: estender a allowlist para incluir o shape habitual e o novo handler.
- `core/AdaptiveExecutionRouter.ts` / `TurnComplexityClassifier.ts`: early-exit passa a olhar o shape do IR; `complexity_score` fica telemetria. Nenhum fast path pula Time/Entity resolvers.

### Fase 7 — Repair por slot

- `core/ConversationTopicState.ts`: topic ganha `requested_ir`, `executed_ir`, `failed_slots`, `preserved_slots`, `repair_count` (só semântica, nunca valor financeiro). Persistência no state já existente da sessão.
- `core/SemanticTurnPipeline.ts` / `core/SemanticCompiler.ts`: em `repair`, diff requested × executed, reabrir só o slot falho, congelar os corretos como prior, restatement explícito ("não era alimentação, era transporte") vence o freeze, e nunca herdar o default que falhou.
- `core/SemanticClarificationOptions.ts` / `ClarificationResponse.ts`: clarificação sempre por slot com opções reais; proibido "reformule em uma frase curta".

### Fase 8 — Workflows duráveis de escrita

- `core/WriteWorkflowManager.ts` (novo): estado persistido em `agent_sessions.state.write_workflow` — `workflow_type`, `status`, `slots`, `missing_slots`, `last_prompted_slot`, `pending_draft_id`, `source_message`, `created_at`, `updated_at`, `expires_at` (TTL 30 min). Roda **depois** do `ConfirmationFastPath` e **antes** de qualquer roteamento normal quando há workflow ativo.
- `core/WriteWorkflowDefinitions.ts` (novo): definição declarativa de slots por domínio, usando os tool names/schemas reais auditados: split, meta pessoal, meta conjunta, aporte pessoal, aporte conjunto, dívida, transferência, pagamento de fatura, gasto/receita, edição e exclusão de lançamento.
- `core/AgentCore.ts`: integração do manager; resposta curta preenche só o slot esperado; "300" não vira `transaction_entry` com workflow ativo; correção de slot no meio, cancelamento e troca de assunto sem corromper estado; workflow expirado descartado; novo draft não sobrepõe pendência de confirmação; idempotência por `inbound_message_id` e por `pending_confirmations` transacional (reaproveitando o que já existe).
- Gaps de escrita: incluir no patch drafts canônicos só onde há RPC/serviço do app reutilizável (pagamento de dívida, marcar recebível pago, meta de gasto por categoria). **Recorrência e investimento ficam declarados como gap**, sem INSERT inventado.

### Fase 9 — Telemetria

- `core/ExecutionTrace.ts` / `core/Observability.ts` / `core/AiStageMetrics.ts`: trace por READ com `dialogue_act`, `requested_ir`, `executed_ir`, `compatible`, `semantic_path/handler`, decisões dos resolvers, `ambiguous_slots`, `repair_slots`, resultado do grounding, `structural_mismatch`, `repair_after_answer_rate`, e latências de compiler/resolvers/engine/backend/critical path.
- Migration: **apenas aditiva** em `agent_runs` para as novas colunas de trace, via repositório. Nenhuma tabela nova (workflow vive no state da sessão). Nenhuma alteração manual no painel e nenhum dado real tocado.

## Testes e critérios de aceite

Novos arquivos: `src/test/nino-semantic-authority.test.ts`, `src/test/nino-typical-monthly.test.ts`, `src/test/nino-preservation-gate.test.ts`, `src/test/nino-write-workflow.test.ts`; extensão de `nino-protected-analytical.test.ts` e do benchmark existente.

Golden semânticos (todos obrigatórios): habitual alimentação (proibido `current_month_mtd` e `get_financial_snapshot`); repair "a pergunta não foi essa" sem repetir o MTD e preservando Alimentação; MTD explícito com soma; "média mensal" com mean; "em agosto?" herdando categoria; "últimos 90 dias" sem perder filtro/ranking; filtro category/card/account/payment_method nunca desaparece; execução com filtro extra é incompatível; multi-query validada query a query e no agregado.

E2E de workflow: rolê completo até "Salvar"; meta pessoal; meta conjunta; aporte; dívida; transferência; pagamento de fatura; correção de slot no meio; cancelamento; workflow expirado; inbound duplicado; confirmação repetida idempotente; duas mensagens concorrentes sem dois drafts; nenhuma resposta curta caindo em `transaction_entry`/`general` com workflow ativo.

Performance: sem segunda LLM no hot path, sem LLM-as-judge, prompt global sem crescimento relevante, benchmark p50/p95 do shape habitual e das rotas T0/T1 sem regressão.

Fechamento: typecheck, build, `test:deploy-contract`, `test:perf-arch`, suíte completa. Flags novas nascem desligadas (`semantic_ir_v4_authority`, `write_workflow_v1`) e **nenhuma publicação sem autorização explícita**.
