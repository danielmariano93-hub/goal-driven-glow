# Nino Semantic IR v3 — completar a arquitetura semântica

Princípio mantido: LLM entende, software controla, motores calculam, evidência fundamenta, software valida, LLM comunica. Nada de recalcular verdade financeira fora dos motores canônicos.

## 1. Auditoria do estado atual (verificada no repositório)

**Já existe e será reaproveitado**
- `SemanticCompiler.ts` — function calling forçado, timeout 8s, ledger de IA via `recordGatewayCall`, fast path.
- `FinancialQueryIR.ts` — contrato `financial_query_ir.v1`, validação estrutural, `fastFinancialIR`, `withCanonicalPeriods`.
- `IRCapabilityAdapter.ts` — mapeamento IR→ferramenta com regra "filtro não suportado = unsupported"; `capabilityExistsForIR`; `isFalseCapabilityDenial`.
- `DialogueAct.ts` — repair/clarification/write/conversational + `findRepairBaseQuery`/`repairEffectiveQuery`.
- `ConversationMemory.ts` — estado único (tópico, período, `last_analysis`, `awaiting`), TTL 6h, sobre `StateManager` (JSON em `agent_sessions.state`).
- `EvidencePack.ts`, `TruthValidator.ts` (números/percentuais/período/direção + proveniência), `ResponseValidator.ts`, `AnalysisGates.ts`, `AnswerCompleteness.ts` (completude por requisitos de metas), `CapabilityRegistry.ts`, `CompositeExecutor.ts`, `FeatureFlags.ts` com `rolloutDecision` determinístico.
- `AgentCore.ts` linhas ~786-830: bloco Semantic IR v2 com `IR_REROUTABLE` e telemetria em `context_layers.semantic_ir`.

**Existe parcialmente**
- `needs_clarification`: campo no IR e no schema do compiler, mas o AgentCore adapta e executa mesmo assim (não bloqueia). Já existe mecanismo de clarificação de capability (`capability.clarification`) para reaproveitar.
- `unsupported`: reconhecido, porém sem capability mapeada o Core apenas mantém a rota legada (fail-open na prática).
- `completeness_targets`: array de strings, nunca verificado.
- Capability guard: só repara depois da resposta e só se a ferramenta já rodou.
- Telemetria: o compiler soma em `metrics`, mas `AgentCore.ts:1221-1223` sobrescreve `tokens_in/tokens_out/llm_calls` com os valores do planner — bug confirmado.

**Não existe**
- Plan Validator, multi-query (validador exige exatamente 1 query), Completeness Gate real, Allowed Claims, grounding semântico (ranking/entidade), pilha de tópicos, investigation loop/replan, `semantic_status` explícito, acumuladores `ai_stages`.

**Novos contratos introduzidos**
`financial_query_ir.v2`, `SemanticStatus`, `PlanValidation`, `SemanticExecutionResult`, `EvidenceClaims`, `CompletenessResult`, `ClaimValidation`, `ConversationTopicState`.

## 2. Entrega por fases (P0 → P4)

### P0 — correções de comportamento
1. `SemanticStatus` = `executable | clarification_required | unsupported | compiler_failed`, derivado no Core. `unsupported` e `clarification_required` nunca caem no legado; só `compiler_failed` permite fallback.
2. `ClarificationResponse.ts`: pergunta determinística por tipo de ambiguidade (cartão, conta, período, meta), com opções vindas dos resolvers/dados reais, máximo 5 opções. Zero chamada de engine financeiro antes da escolha. `pending_clarification` persistido na memória e retomado quando o usuário responde ("Nubank") — mesmo IR, só a entidade pendente resolvida.
3. Telemetria acumulativa: `metrics.ai_stages` (`semantic_compiler`, `investigation_replan`, `response_generator`) e agregados somados em vez de atribuídos; corrigir a sobrescrita em `AgentCore.ts`.
4. Capability rescue: `CapabilityAvailabilityGuard` que, ao detectar frase de incapacidade, consulta IR + adapter; executa o engine se ainda não rodou, reconstrói pela evidência se já rodou, ou clarifica. Só o registry autoriza mensagem de incapacidade.

### P1 — IR v2, validação e execução
5. `financial_query_ir.v2`: envelope com `dialogue {act, topic_id, inherits_from_topic_id}`, `queries[]` com `depends_on`, `completeness_targets` como objetos (`id`, `query_id`, `claim`, `required`). Leitura da v1 preservada por normalização. Máximo 4 queries; validar ciclos, dependência inexistente, IDs duplicados, query duplicada, filtro inválido, combinação metric/operation/dimension inválida, `compare` sem `comparison_period`, `explain` sem base. Inconsistência = IR inválido, nunca correção silenciosa.
6. `FinancialPlanValidator.ts` — determinístico (sem LLM-as-judge): retorna `{ ok, errors, unsupported_queries, clarification_required }`. Query obrigatória sem mapping impede o turno inteiro.
7. `SemanticQueryExecutor.ts` — executa as queries validadas em ordem topológica, paraleliza só leituras independentes, devolve `SemanticExecutionResult` com status/engine/args/result/duration por query, `complete`, `failed_queries` e evidência agregada. WRITE nunca passa por aqui.
8. `CompletenessGate.ts` — opera sobre IR + execução + claims; devolve `fulfilled_targets`/`missing_targets`/`failed_queries`. Target faltante só é aceito se derivável deterministicamente; senão replan (quando habilitado) ou resposta explicitamente parcial. Nunca A+B respondido como completo com só A.

### P2 — evidência e grounding
9. `EvidenceClaims.ts` — camada sobre o `EvidencePack` (não substitui): `period`, `currency`, `claims[]` tipados (money, percent, rank com entidade e posição) e `allowed_derivations` fechado (`rounded_money`, `difference`, `ratio`, `percentage_share`, `rank_position`). Sem recálculo de verdade financeira.
10. Grounding V3 complementando `TruthValidator.ts`: valida dinheiro, percentual, ranking, entidade (categoria/cartão/conta/meta/dívida), período, direção e ausência. Classificação `exact | derived_allowed | unbacked | semantic_mismatch`. Trocar ranking (dizer Transporte quando Alimentação é #1) é bloqueado mesmo com o número presente.

### P3 — estado conversacional por tópico
11. `ConversationTopicState.ts` sobre o `StateManager` atual (sem tabela nova): `active_topic_id` + até 5 tópicos com `subject`, queries original/última, `dialogue_act`, IR resumido, período, entidades, resumo de execução, referência de evidência, `pending_clarification`, `status`, `updated_at` próprio. Só referências e resumos — nunca fonte de verdade financeira; ao retomar, os números vêm do engine/evidência.
12. Resolução de tópico por sinais explícitos de retomada + entidades + tópico anterior + similaridade limitada. Empate plausível ⇒ clarificar. Repair mantém o mesmo `topic_id` e a pergunta original.

### P4 — investigação
13. `SemanticInvestigationLoop.ts` — plan → execute → observe → replan, `MAX_REPLANS = 2`, timeout global; replan recebe pergunta original, IR atual, resumo de execução, targets faltantes e ontologia, e só pode emitir um IR revisado (nunca tool, nunca resposta), revalidado pelo PlanValidator.
14. Primeira investigação útil de "por que gastei mais este mês?": total atual vs anterior → breakdown por categoria dos dois períodos → opcionalmente merchants da categoria que mais explica o delta. Drivers apenas quando os dados provam contribuição; zero causalidade inventada.

## 3. Limites explícitos
`MAX_IR_QUERIES = 4`, `MAX_REPLANS = 2`, `MAX_TOPIC_STATE = 5`, `MAX_CLARIFICATION_OPTIONS = 5`, timeout do compiler mantido, timeout global de investigação — ao estourar, resposta segura e nenhuma execução em background.

## 4. Feature flags e migration
Flags independentes, todas nascendo `enabled=false`, `rollout_percent=0`, `pilot_user_ids=[]`: `semantic_ir_v3`, `semantic_ir_multiquery_v1`, `semantic_completeness_v1`, `semantic_allowed_claims_v1`, `semantic_topic_state_v1`, `semantic_investigation_loop_v1`, `semantic_capability_rescue_v1`. Migration idempotente em `agent_runtime_flags`, sem tocar na configuração atual de `semantic_ir_v1` nem adicionar piloto. Estado de tópicos reaproveita o JSON de `agent_sessions.state` — sem tabela nova.

## 5. Observabilidade
Persistir no trace do run: dialogue act, `active_topic_id`, `resumed_topic_id`, versão do IR, IR, `plan_validation`, clarificação, queries e engines mapeados, args sanitizados, status de execução, claims, targets e resultado de completude, grounding, `replan_count` e razões, capability rescue, `semantic_status`, motivo de fallback e caminho final. Sem dados sensíveis desnecessários.

## 6. WRITE preservado
Dialogue Act separa WRITE antes do READ semântico; pipeline parse → draft → confirmação → execução idempotente → recibo intacto, com testes garantindo que "gastei 50 no mercado hoje", "crie uma meta de 5 mil", "confirma" e "cancela" não são interceptados.

## 7. Testes e validação
Nova suíte golden expandindo `nino-semantic-ir` com os 20 casos do escopo (ranking 90 dias, repair, repair por cartão, sum do mês, ranking+share, comparação com delta, clarificação de cartão, resposta "Nubank", filtro negativo unsupported, investigação com replan ≤ 2, novo tópico, retomada de tópico, dois falsos-repair, mismatch de ranking, completude parcial, capability rescue, unsupported sem legado, compiler_failed com legado, WRITE intacto) + testes de telemetria (compiler 1000/50 + response 2000/100 ⇒ `llm_calls=2`, `tokens_in=3000`, `tokens_out=150`; fast path puro ⇒ `llm_calls=0`) e de limites. Validação final: suíte Vitest completa, build, typecheck, migration aplicada, e verificação end-to-end de cada gate (comportamento, não só existência de campo).

## 8. Entrega
Relatório técnico final com os 25 itens pedidos e a tabela COMPONENTE | IMPLEMENTADO | TESTADO | FLAG | RISCO RESIDUAL. Nenhum deploy e nenhum rollout sem autorização; roteadores legados permanecem no lugar.
