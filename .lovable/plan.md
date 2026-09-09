# Nino: mesmo cérebro para todos (universalização da arquitetura semântica)

Objetivo: liberar a arquitetura semântica v3 para 100% dos usuários elegíveis, eliminar
duplicação de execução e latência desnecessária, sem mudar tom/narrativa nem tocar em
fatos financeiros canônicos. Mais a correção da mensagem de cobrança do rolê (print).

## 1. Matriz de rollout (estado verificado agora)

| Feature | Enabled | Rollout | Pilotos | Quem recebe hoje | Ação |
| --- | --- | --- | --- | --- | --- |
| semantic_ir_v3 | sim | 0% | 2 | só 2 usuários | rollout 100, limpar pilotos |
| semantic_ir_multiquery_v1 | sim | 0% | 2 | só 2 usuários | rollout 100, limpar pilotos |
| semantic_completeness_v1 | sim | 0% | 2 | só 2 usuários | rollout 100, limpar pilotos |
| semantic_allowed_claims_v1 | sim | 0% | 2 | só 2 usuários | rollout 100, limpar pilotos |
| semantic_topic_state_v1 | sim | 0% | 2 | só 2 usuários | rollout 100, limpar pilotos |
| semantic_investigation_loop_v1 | sim | 0% | 2 | só 2 usuários | rollout 100, limpar pilotos |
| semantic_capability_rescue_v1 | sim | 0% | 2 | só 2 usuários | rollout 100, limpar pilotos |
| semantic_ir_v1 | sim | 100% | 2 | todos (caminho legado) | depreciar: só entra se v3 não decidiu |
| evidence_pack / deterministic_first / progressive_tools / context_budget / model_routing / document_efficiency | sim | 100% | 0 | todos | nada |
| Política de comunicação (`communication_policy_settings`) | pilot_mode ligado, lista de pilotos vazia | — | 0 | multiplicador de orçamento não chega a ninguém | decidir: desligar modo piloto para valer para todos |
| Preferências por usuário (`notification_preferences`), consentimentos, quiet hours, limites/dia | por usuário | — | — | respeitado hoje | preservar integralmente |

Auditoria completa das outras tabelas de gating (`agent_settings`, `financial_feature_flags`,
`nino_diagnosis_config`, gating por plano/ambiente e flags hardcoded) entra como primeiro passo
da execução e é entregue como matriz final, listando o que ainda ficar fora de 100%.

## 2. Um único cérebro por turno

- Rollout 100% + `pilot_user_ids` esvaziado para as 7 features (a decisão de rollout já trata
  100% como "todos", então nenhum usuário elegível passa a depender de lista de pilotos).
- `semantic_ir_v1` deixa de ser um segundo cérebro: só pode rodar quando a v3 não produziu
  decisão (`compiler_failed`) e nunca no mesmo turno em que a v3 teve autoridade. Depreciação
  documentada em `DEPENDENTS.md` e no contrato de runtime.
- Escada única de decisão do turno: v3 (executável) → resgate de capability → motor canônico do
  roteador → falha honesta. Sem executor paralelo.

## 3. Cache de execução por turno (fim da tool duplicada)

- Cache de evidência por turno com chave `capability + tool + parâmetros normalizados + período`.
  Toda execução (pipeline semântico, resgate, investigação, fallback, planner) passa pelo mesmo
  cache e reutiliza o resultado em vez de reexecutar.
- Regra absoluta de WRITE: ferramenta que altera estado (lançamento, pagamento, meta, check-in
  emocional, edição de categoria) nunca é reexecutada por resgate, completude, investigação ou
  fallback. Sucesso já obtido é reutilizado; nunca "reconfirmado".
- Contagem de reuso e de duplicatas evitadas gravada na telemetria do turno.

## 4. Atalho de follow-up simples

Quando o turno anterior é inequívoco e a mensagem é continuação curta ("sim", "e no mês passado?",
"essas categorias"), o turno reaproveita escopo e evidências do estado de tópico e evita
recompilação completa. Sem perder escopo: nunca amplia silenciosamente para visão global.

## 5. Gates: falso positivo e falso negativo

- Completude: reconhece evidência já existente antes de acusar resposta parcial; só aciona
  investigação com alvo faltante nomeado.
- Claims permitidas: aceita número/data/percentual que veio da ferramenta canônica executada;
  rejeita o que não tem lastro.
- Investigação: limite de replan mantido em 2, com `investigation_count`, `investigation_reason`
  e `missing_evidence` registrados.

## 6. Correção da cobrança do rolê (print)

Os textos de cobrança (`reminder`, `due_soon`, `due_today`, `overdue`) perderam o nome do rolê e de
quem organizou. Voltam a dizer de qual rolê e de quem é a cobrança, mantendo parcela, saldo,
pagamento parcial e vencimento. Testes de mensagem atualizados junto.

## 7. Testes e aceite

- Multiquery: "Quanto gastei este mês, quais categorias mais pesaram e como isso compara ao mesmo
  período do mês passado?" responde os três pontos, com dependências preservadas.
- Estado de tópico: "E comparando essas categorias com o mês passado?" mantém exatamente
  Alimentação + Lazer + Transporte.
- Completude, claims, investigação limitada, resgate, WRITE não reexecutada, read não repetida.
- 3 fixtures de usuários: mesmo estado financeiro + mesma pergunta ⇒ mesma arquitetura semântica.
- Preferências/consentimentos/quiet hours/limites continuam valendo (100% de inteligência ≠ 100%
  de mensagens).
- Antes/depois de p50, p95, média, chamadas de IA e de ferramentas, duplicadas, tokens, taxa de
  fallback/resgate/investigação/falha de gate — separados por operação determinística,
  follow-up, análise simples, análise complexa e multiquery.

## Detalhes técnicos

- `FeatureFlags.ts`: mantém fail-closed; migration ajusta `rollout_percent=100` e
  `pilot_user_ids='{}'` das 7 flags semânticas.
- `AgentCore.ts`: ramo `semantic_ir_v1` passa a ser condicionado a ausência de decisão v3;
  cache de execução injetado no `runEngine`, no resgate e no `ActionPlanner`.
- Novo módulo `core/TurnEvidenceCache.ts` (chave estável, marcação de WRITE como não repetível).
- `core/ConversationTopicState.ts` + novo atalho de continuação para follow-up curto.
- `Observability.ts`/`AiStageMetrics.ts`: campos de reuso, duplicadas evitadas, motivo de
  fallback, resultado de cada gate e latência por estágio no `agent_runs`.
- `messageTemplates.ts`: restauração de `{{title}}`/`{{owner_name}}` nas 4 cobranças.
- Deploy atômico das 10 funções dependentes + bump de `AGENT_RUNTIME_VERSION`.
- Sem migration de dados financeiros; nenhuma segunda fonte de verdade.
