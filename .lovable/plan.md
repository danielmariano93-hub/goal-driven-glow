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
- Precedência: `rawDeterministic` + allowlist `IR_REROUTABLE` impedem o compiler de ver parte dos READs financeiros.

**Não existe**
- Plan Validator, multi-query (validador exige exatamente 1 query), Completeness Gate real, Allowed Claims, grounding semântico (ranking/entidade), pilha de tópicos, investigation loop/replan, `semantic_status` explícito, acumuladores `ai_stages`, autoridade de execução semântica separada do ActionPlanner.

**Novos contratos introduzidos**
`financial_query_ir.v2`, `SemanticStatus`, `PlanValidation`, `SemanticExecutionResult`, `EvidenceClaims`, `CompletenessResult`, `ClaimValidation`, `ConversationTopicState`, `DialogueState` (multi-label), `PendingClarification`.

## 2. Autoridade de execução do Semantic Path (regra central)

Com `semantic_status = executable`, o ActionPlanner/LLM **não** volta a escolher ferramentas e **não** recebe catálogo de tools para executar um IR já validado. O pipeline obrigatório de READ semântico é:

```text
Semantic Compiler
 → Financial Query IR
 → FinancialPlanValidator
 → IRCapabilityAdapter / semantic registry
 → SemanticQueryExecutor
 → deterministic engines
 → Evidence Claims
 → Completeness Gate
 → Response Generator / formatter determinístico
 → Grounding Gate
 → Final Response Validator
```

O ActionPlanner continua vivo e inalterado para legado, WRITE, conversação, fluxos fora da cobertura do IR e contratos existentes — mas nunca como autoridade de execução de um IR financeiro validado. Na geração de resposta do caminho semântico, a LLM recebe apenas evidência + claims autorizados, sem tool catalog.

## 3. Precedência de roteamento na V3

```text
WRITE / confirm / cancel / conversational  → contratos próprios existentes
READ financeiro                            → Fast Path (só match de altíssima precisão)
                                           → senão, Semantic Compiler
Legacy                                     → só com flag OFF ou semantic_status = compiler_failed
```

`rawDeterministic` e a allowlist `IR_REROUTABLE` deixam de bloquear a análise semântica de um READ financeiro elegível. Com `executable`, `clarification_required` ou `unsupported`, o legado não pode sobrescrever a decisão semântica.

**Política do Fast Path (alta precisão).** Só executa com: métrica canônica única; nenhum `group_by` extra; zero filtros; zero comparação; nenhum "por quê"/investigação; entidade inexistente ou única e já resolvida; nenhum repair. Falso negativo é aceitável; falso positivo não. Qualquer ambiguidade vai ao Semantic Compiler.

## 4. Dialogue Act multi-label

O Dialogue Act deixa de ser enum único: passa a `acts[]` (`new_query`, `repair`, `clarification`, `followup`, `constraint_update`, `write`, `conversational`), materializado como `DialogueState` próprio e referenciado pelo IR em `dialogue`. Combinações obrigatórias: `repair + constraint_update`, `repair + followup`, `clarification + constraint_update`. "Não foi isso, eu queria por cartão nos últimos 90 dias" preserva o repair e aplica a nova restrição (dimensão card + período novo).

## 5. Entrega por fases (P0 → P4)

### P0 — comportamento
1. `SemanticStatus` = `executable | clarification_required | unsupported | compiler_failed`, derivado no Core. Só `compiler_failed` libera legado.
2. `ClarificationResponse.ts`: pergunta determinística por tipo de ambiguidade (cartão, conta, período, meta), opções vindas dos resolvers/dados reais, máximo 5. Zero chamada de engine financeiro antes da escolha.
3. Telemetria acumulativa: `metrics.ai_stages` (`semantic_compiler`, `investigation_replan`, `response_generator`), agregados somados; corrigir a sobrescrita em `AgentCore.ts`.
4. Capability rescue como **última defesa** (ver §9), não mecanismo principal de execução.
5. Precedência e Dialogue State multi-label (§3 e §4).

### P1 — IR v2, validação e execução
6. `financial_query_ir.v2`: `dialogue { acts[], topic_id, inherits_from_topic_id }`, `queries[]` com `depends_on`, `completeness_targets` como objetos (`id`, `query_id`, `claim`, `required`). Leitura da v1 preservada por normalização. Máximo 4 queries; validar ciclos, dependência inexistente, IDs duplicados, query duplicada, filtro inválido, combinação metric/operation/dimension inválida, `compare` sem `comparison_period`, `explain` sem base. Inconsistência = IR inválido, nunca correção silenciosa.
7. `FinancialPlanValidator.ts` — determinístico (sem LLM-as-judge): `{ ok, errors, unsupported_queries, clarification_required }`. Query obrigatória sem mapping impede o turno inteiro.
8. `SemanticQueryExecutor.ts` — ordem topológica, paralelismo só entre leituras independentes, `SemanticExecutionResult` com status/engine/args/result/duration por query, `complete`, `failed_queries` e evidência agregada. WRITE nunca passa por aqui.
9. `CompletenessGate.ts` — IR + execução + claims ⇒ `fulfilled_targets`/`missing_targets`/`failed_queries`. Target faltante só é aceito se derivável deterministicamente; senão replan (quando habilitado) ou resposta explicitamente parcial. Nunca A+B respondido como completo com só A.

### P2 — evidência e grounding
10. `EvidenceClaims.ts` — camada sobre o `EvidencePack` (não substitui): `period`, `currency`, `allowed_derivations` fechado (`rounded_money`, `difference`, `ratio`, `percentage_share`, `rank_position`) e `claims[]` com os tipos que o Grounding precisa validar: `money`, `percentage`, `rank`, `entity`, `absence`, `count`, `period`, `direction`. Sem recálculo de verdade financeira.
11. Grounding V3 complementando `TruthValidator.ts`: valida dinheiro, percentual, ranking, entidade (categoria/cartão/conta/meta/dívida), contagem, período, direção e ausência. Classificação `exact | derived_allowed | unbacked | semantic_mismatch`. Trocar ranking (dizer Transporte quando Alimentação é #1) é bloqueado mesmo com o número presente.

### P3 — estado conversacional por tópico
12. `ConversationTopicState.ts` sobre o `StateManager` atual (sem tabela nova): `active_topic_id` + até 5 tópicos com `subject`, queries original/última, dialogue state, IR resumido, período, entidades, resumo de execução, `evidence_reference`, `pending_clarification`, `status`, `updated_at` próprio. `evidence_reference` guarda apenas identificadores rastreáveis de run/tool call — nunca verdade financeira.
13. Regras de herança explícitas: repair mantém `topic_id`; repair herda período e entidades salvo override explícito; follow-up pode continuar o `topic_id`; assunto novo cria `topic_id` novo; small-talk não cria nem limpa tópico; retomada explícita recupera tópico anterior; empate entre tópicos plausíveis exige clarificação; período não vaza para tópico independente; entidade nunca é herdada silenciosamente entre tópicos incompatíveis.
14. `PendingClarification` persiste `topic_id`, IR original, slot não resolvido, opções canônicas, período e `query_id` relacionada. A resposta "Nubank" não recompila pergunta nova quando desnecessário: resolve só o slot, revalida o IR e continua. Resposta ainda ambígua ⇒ pergunta de novo.

### P4 — investigação
15. `SemanticInvestigationLoop.ts` — plan → execute → observe → replan, `MAX_REPLANS = 2`, timeout global; o replan recebe pergunta original, IR atual, resumo de execução, targets faltantes e ontologia, e só pode emitir um IR revisado (nunca tool, nunca resposta), revalidado pelo PlanValidator.
16. Primeira investigação útil de "por que gastei mais este mês?": total atual vs anterior → breakdown por categoria dos dois períodos → opcionalmente merchants da categoria que mais explica o delta. Drivers só quando os dados provam contribuição; zero causalidade inventada.

## 6. Ordem obrigatória dos gates

```text
Execution → EvidenceClaims → CompletenessGate → Response Generation
          → GroundingGate → ResponseValidator → saída
```

Completeness verifica se há evidência suficiente para responder tudo que foi pedido. Grounding verifica se a resposta gerada respeitou exatamente essa evidência. Gates diferentes, ambos obrigatórios.

## 7. Limites explícitos
`MAX_IR_QUERIES = 4`, `MAX_REPLANS = 2`, `MAX_TOPIC_STATE = 5`, `MAX_CLARIFICATION_OPTIONS = 5`, timeout do compiler mantido, timeout global de investigação — ao estourar, resposta segura e nenhuma execução em background.

## 8. Feature flags e migration
Flags independentes, todas nascendo `enabled=false`, `rollout_percent=0`, `pilot_user_ids=[]`: `semantic_ir_v3`, `semantic_ir_multiquery_v1`, `semantic_completeness_v1`, `semantic_allowed_claims_v1`, `semantic_topic_state_v1`, `semantic_investigation_loop_v1`, `semantic_capability_rescue_v1`. Migration idempotente em `agent_runtime_flags`, **criada e validada, não aplicada**: nenhuma alteração em produção ou na configuração do banco sem autorização explícita, e a configuração atual de `semantic_ir_v1` fica intocada. Estado de tópicos reaproveita o JSON de `agent_sessions.state` — sem tabela nova.

## 9. Capability rescue como última defesa
Com `executable`, a execução determinística já ocorre antes da geração de resposta, então a arquitetura normal é a responsável por rodar o motor. O `CapabilityAvailabilityGuard` fica como rede de segurança: ao detectar frase de incapacidade, consulta IR + adapter, reconstrói pela evidência já produzida, executa o motor se por algum caminho ainda não rodou, ou clarifica. Só o registry autoriza mensagem de incapacidade.

## 10. Observabilidade
Persistir no trace do run: dialogue acts, `active_topic_id`, `resumed_topic_id`, versão do IR, IR, `plan_validation`, clarificação, queries e engines mapeados, args sanitizados, status de execução, claims, targets e resultado de completude, grounding, `replan_count` e razões, capability rescue, `semantic_status`, motivo de fallback e caminho final. Sem dados sensíveis desnecessários.

## 11. WRITE preservado
Dialogue State separa WRITE antes do READ semântico; pipeline parse → draft → confirmação → execução idempotente → recibo intacto, com testes garantindo que "gastei 50 no mercado hoje", "crie uma meta de 5 mil", "confirma" e "cancela" não são interceptados.

## 12. Testes e validação
Suíte golden expandindo `nino-semantic-ir` com os 20 casos do escopo (ranking 90 dias, repair, repair por cartão, sum do mês, ranking+share, comparação com delta, clarificação de cartão, resposta "Nubank", filtro negativo unsupported, investigação com replan ≤ 2, novo tópico, retomada de tópico, dois falsos-repair, mismatch de ranking, completude parcial, capability rescue, unsupported sem legado, compiler_failed com legado, WRITE intacto) **mais dois testes arquiteturais decisivos**:
- IR executável ⇒ `SemanticQueryExecutor` executou o motor e o ActionPlanner **não** foi usado para selecionar tool;
- READ financeiro fora do Fast Path ⇒ Semantic Compiler é chamado mesmo quando o roteador legado classificaria a mensagem como outra capability.

Mais testes de telemetria (compiler 1000/50 + response 2000/100 ⇒ `llm_calls=2`, `tokens_in=3000`, `tokens_out=150`; fast path puro ⇒ `llm_calls=0`) e de limites. Validação final: suíte Vitest completa, build, typecheck, migration criada e validada, e verificação end-to-end de cada gate (comportamento, não só existência de campo).

## 13. Entrega
Relatório técnico final com os 25 itens pedidos e a tabela COMPONENTE | IMPLEMENTADO | TESTADO | FLAG | RISCO RESIDUAL. Nenhum deploy, nenhuma migration aplicada e nenhum rollout sem autorização; roteadores legados permanecem no lugar.
