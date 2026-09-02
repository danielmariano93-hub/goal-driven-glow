# Semantic IR v3 — fechar a integração de ponta a ponta

Auditoria do estado atual (verificada no repositório agora):

| Componente | Existe | Chamado no AgentCore |
| --- | --- | --- |
| DialogueAct, SemanticCompiler, SemanticRouting, FinancialQueryIR v2 | sim | sim |
| FinancialPlanValidator, SemanticStatus, IRCapabilityAdapter, SemanticQueryExecutor | sim | sim |
| EvidenceClaims, CompletenessGate, GroundingGateV3, ClarificationResponse, AiStageMetrics | sim | sim |
| **ConversationTopicState** | sim | **não — só em teste** |
| **SemanticInvestigationLoop** | sim | **não — só em teste** |
| **Pending clarification (resolver slot e retomar IR)** | parcial | **não** |
| **Capability rescue via CapabilityRegistry** | registry existe | **não consulta o registry** |
| **IR_REROUTABLE como autorização** | ainda presente (linha 812) | remover conceito |
| Trace completo no agent_run | parcial | completar campos |

## O que será implementado

1. **Topic State no runtime**: carregar da sessão no início do READ, `resolveTopicForTurn` com acts multi-label, definir `active_topic_id` / `resumed_topic_id` / herança, aplicar contexto no IR, persistir (máx. 5 tópicos). Regras: `repair` e `repair+constraint_update` mantêm tópico; `followup` continua se compatível; assunto novo cria tópico; small-talk não cria nem apaga; retomada explícita busca tópico compatível e, com dois plausíveis, vira `clarification_required`. Nunca herdar período/cartão/categoria/conta/meta de tópico incompatível. Números sempre revindos dos engines, nunca da memória.
2. **Pending clarification end-to-end**: persistir `topic_id`, `query_id`, `original_ir`, `slot`, opções canônicas, período; resposta curta resolve o slot, atualiza o IR original, revalida no PlanValidator e continua a execução sem recompilar a conversa. Nenhum engine roda antes da entidade resolvida.
3. **Precedência semântica**: remover `IR_REROUTABLE` como autorização; todo READ financeiro elegível vai a Fast Path (altíssima precisão) ou ao Compiler, sem o CapabilityRouter legado bloquear. Legacy só recupera autoridade em `compiler_failed` ou flag OFF.
4. **Multi-query real** (até 4), ordem topológica, paralelismo entre independentes, `execution.complete = false` quando query obrigatória falha.
5. **Investigation Loop conectado**: aciona em `intent = investigate` ou quando o CompletenessGate aponta lacuna recuperável; replan semântico (só pergunta, IR atual, resumo de execução, alvos faltantes, ontologia e capacidades — sem catálogo de tools), novo IR revalidado, `MAX_REPLANS = 2` absoluto, depois clarification ou resposta explicitamente parcial. Caso "por que gastei mais": q1 delta, q2 breakdown por categoria, q3 opcional por estabelecimento; sem causalidade emocional sem engine comportamental.
6. **Ordem final de gates** garantida: Execution → Claims → Completeness → Response → GroundingGateV3 → TruthValidator → ResponseValidator.
7. **Capability rescue real**: negação de capacidade no texto final consulta IR/PlanValidation/Adapter/**CapabilityRegistry**; engine já executado → reconstruir pela evidência; não executado → executar motor canônico e refazer claims/completeness/grounding; entidade ambígua → clarification. Só o Registry autoriza incapacidade.
8. **Telemetria**: agregados exclusivamente por soma de `metrics.ai_stages` (compiler, replans, response), com `estimated_cost` por estágio e Fast Path puro em `llm_calls = 0`; nenhuma sobrescrita posterior.
9. **Trace no agent_run**: dialogue_state, topic ids, semantic_status, IR, plan_validation, engines e args sanitizados, claims, completeness, grounding, replan_count/reasons, rescue, clarification, final path e fallback reason.
10. **WRITE intocado**: lançamento/receita/meta/confirma/cancela seguem parse → draft → confirmação → execução idempotente → recibo, sem entrar no executor semântico.

## Testes, flags e entrega

- Novos testes end-to-end de runtime cobrindo os 16 cenários da especificação (categorias 90 dias, repair, repair+constraint_update, clarification com 2 cartões, "Nubank", filtro negativo unsupported, compiler_failed, ranking+share, grounding invertido, "por que gastei mais", troca de tópico, retomada, autoridade do executor, legacy incorreto, rescue, WRITE).
- Suíte completa Vitest + build + typecheck + validação de imports e migrations.
- Flags `semantic_ir_v3`, `semantic_ir_multiquery_v1`, `semantic_completeness_v1`, `semantic_allowed_claims_v1`, `semantic_topic_state_v1`, `semantic_investigation_loop_v1`, `semantic_capability_rescue_v1` permanecem `enabled=false`, `rollout_percent=0`, sem piloto; `semantic_ir_v1` não é alterada. Código 100% integrado com flags OFF.
- Migration criada e validada; **sem deploy e sem rollout** nesta entrega.
- Ao final, relatório com a tabela COMPONENTE / IMPLEMENTADO / INTEGRADO / TESTADO E2E / FLAG / STATUS e os números de testes, build, typecheck e gaps remanescentes.
