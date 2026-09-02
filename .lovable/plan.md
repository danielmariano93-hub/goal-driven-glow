# Nino: fechar o buraco entre "entender" e "responder"

## O que aconteceu de verdade nesse turno (verificado na run real)

Run `6d76337f` (02/09, 10:05 SP), pergunta "Como está minha evolução financeira? Estou melhorando ou piorando?", runtime `nino-agent-p0.2026-09-02.9`:

```text
semantic_ir.intent          = analyze
semantic_ir.query_count     = 2
semantic_ir.mapped_tools    = []
semantic_ir.plan_errors     = unsupported_required_query:q1, unsupported_required_query:q2
semantic_ir.semantic_status = unsupported
semantic_ir.executed_by     = honest_failure
capability (roteador)       = holistic_assessment  (motor assess_financial_health)
tools_used                  = []
```

Ou seja: o compilador entendeu a pergunta corretamente, gerou duas queries, **nenhuma das duas tinha motor mapeado**, o status virou `unsupported` e o pipeline devolveu falha honesta — jogando no lixo a capability determinística que o próprio roteador já havia escolhido para essa pergunta (`assess_financial_health`, que existe, funciona e responde exatamente "estou melhorando ou piorando"). O texto exibido ainda por cima é o da falha de comparação de categorias protegidas, que não tem nada a ver com o caso.

Três defeitos arquiteturais, não um bug:

1. **`unsupported` está sendo tratado como "não há resposta possível"**, quando significa apenas "o IR não achou motor". Não existe degradação para o motor canônico do turno.
2. **O adaptador IR→motor não cobre a família tendência/evolução/saúde**: `trend` só é aceito sem filtro e sem `group_by`, e não há mapeamento para `analyze_financial_evolution`, `analyze_longitudinal_trajectory`, `assess_financial_performance` nem para a combinação de dimensões que a pergunta pede. O compilador não conhece o catálogo de motores, então inventa queries que nunca serão executáveis.
3. **A mensagem de falha é única e emprestada**: `PROTECTED_ENGINE_FAILURE_REPLY` (feita para escopo de categorias) é usada como `failure_reply` genérico do pipeline semântico. O usuário recebe uma explicação factualmente errada do motivo.

## O que será implementado

### 1. Escada de degradação determinística (fim do fail-closed cego)
Ordem única e explícita, no `SemanticTurnPipeline`/`AgentCore`:

```text
executable            -> executor semântico (como hoje)
clarification_required-> clarificação com opções reais (como hoje)
unsupported           -> NOVO: motor canônico do roteador, se existir para o turno
                         -> senão: falha honesta com o motivo real
compiler_failed       -> roteador legado (como hoje)
```

`unsupported` passa a consultar o `CapabilityRegistry`/`CapabilityRouter`: se há capability determinística com `required_tool` para essa pergunta, ela executa, e a resposta segue pelos gates normais (claims, completeness, grounding, truth). Telemetria registra `executed_by = "canonical_fallback"` e as queries que ficaram sem motor — nunca silêncio.

### 2. Cobertura de ontologia: tendência, evolução e saúde financeira
No `IRCapabilityAdapter` (único lugar que conhece implementação):
- `metric = financial_health` (já existe) e novos mapeamentos para `trend`/`assess` de trajetória: `analyze_financial_evolution`, `analyze_longitudinal_trajectory`, `assess_financial_performance`.
- Aceitar `trend` com filtro de categoria/cartão quando o motor suporta, em vez de invalidar a query inteira.
- Intenção "estou melhorando ou piorando" em multi-query resolve para o motor holístico quando as sub-queries são dimensões da mesma leitura (uma resposta, não duas).

### 3. O compilador passa a conhecer o que é executável
O prompt do `SemanticCompiler` recebe o **catálogo de métricas/operações realmente mapeadas** (gerado do adaptador, não escrito à mão). Query fora do catálogo deixa de ser gerada; quando ainda assim acontecer, o replan do Investigation Loop recebe explicitamente "essa combinação não tem motor, use X" antes de qualquer falha.

### 4. Falha honesta com motivo verdadeiro
Separar as mensagens: escopo de categoria perdido, motor indisponível, entidade inexistente e **combinação sem motor** passam a ter textos distintos. `PROTECTED_ENGINE_FAILURE_REPLY` volta a ser usado só no caso protegido de categorias/metas. Nenhuma mensagem afirma motivo que a telemetria não confirma.

### 5. Observabilidade de lacuna de ontologia
Gravar em `agent_runs.context_layers.semantic_ir.unsupported_ontology` o par `metric/operation/group_by/filters` de cada query sem motor e expor no admin (Nino IA) a lista das combinações mais frequentes. É esse painel que passa a dirigir a evolução do agente, em vez de descobrirmos por print de conversa.

### 6. Testes e entrega
- Golden test do incidente: essa pergunta exata responde com número do motor holístico e `executed_by != honest_failure`.
- Testes de degradação: `unsupported` com capability canônica → responde; sem capability → falha honesta com motivo correto; caso protegido de categorias continua fail-closed.
- Testes de cobertura do adaptador para tendência/evolução/saúde e paridade da mensagem de falha.
- Suíte completa Vitest + build; bump de `AGENT_RUNTIME_VERSION` e redeploy atômico das 10 funções de `DEPENDENTS.md` (só com sua autorização).

## Fora de escopo
Nenhuma mudança em WRITE (lançamento, confirmação, recibo), em regra financeira, em competência/período ou em UI da Home.
