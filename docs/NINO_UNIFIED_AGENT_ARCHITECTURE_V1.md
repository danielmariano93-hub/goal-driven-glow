# Nino — Arquitetura Unificada do Agente v1

## Decisão

O Nino terá **um único caminho autoritativo para leituras financeiras**:

```text
mensagem + estado do tópico
  → compilador semântico (IR estruturado)
  → validação determinística
  → mapeamento para motor canônico
  → execução
  → preservação pedido × executado
  → resposta baseada em evidência
```

A IA interpreta linguagem. O software controla execução. Os motores financeiros
calculam números. Nenhuma camada pode responder uma pergunta diferente quando a
etapa anterior falhar.

## Problema encerrado

A arquitetura anterior permitia que regras lexicais e caminhos paralelos
interceptassem perguntas antes do entendimento semântico. Isso gerava três
classes de falha:

1. frase natural presa numa clarificação fixa, como "quanto gastei na sexta?";
2. perda de contexto em continuações como "e essas categorias?";
3. fallback para uma ferramenta com outro escopo ou período.

Adicionar mais regex, intents ou planners não corrige a causa: amplia o número
de combinações e de rotas concorrentes.

## Responsabilidades

| Camada | Responsabilidade | Proibido |
| --- | --- | --- |
| Dialogue/Topic State | preservar tópico, correções, entidades e período | calcular ou escolher ferramenta |
| Semantic Compiler | traduzir a pergunta para IR com Structured Output estrito | responder, calcular ou ver catálogo de tools |
| IR Validator | validar estrutura, dependências e completude | corrigir silenciosamente o pedido |
| Capability Adapter | mapear IR validado para um motor existente | descartar filtro ou trocar operação |
| Finance Core | calcular fatos financeiros canônicos | produzir interpretação livre |
| Preservation/Grounding | comparar pedido e execução, validar afirmações | aproximar escopo ou aceitar número sem evidência |
| Answer Formatter | explicar somente os fatos aprovados | criar valores, períodos ou entidades |

## Política de autoridade

- READ elegível pertence ao `SemanticTurnPipeline`, mesmo quando o roteador
  legado tiver produzido uma clarificação.
- WRITE, confirmação, cancelamento, importação e operações com efeitos mantêm
  seus workflows próprios e idempotentes.
- `compiler_failed`: resposta honesta no mesmo pipeline.
- `unsupported`: explicação honesta da lacuna; nunca substituição automática.
- motor indisponível: retry controlado da mesma operação ou falha fechada.
- nenhum `CompositeAnalysis` ou planner legado executa em paralelo quando o
  pipeline semântico possui o turno.

## Guardrails mantidos

Os guardrails deixam de ser baseados em frases e ficam apenas nas fronteiras:

- isolamento e autorização do usuário;
- confirmação de mutações;
- idempotência;
- contratos contábeis;
- período, filtro, escopo e métrica;
- completude e grounding;
- limites de custo, tempo e quantidade de ferramentas.

## Mudanças deste patch

- clarificação do roteador legado deixa de bloquear o Semantic Compiler;
- READ semântico torna-se autoritativo no `AgentCore`;
- falhas do compilador e lacunas de ontologia não retornam ao planner legado;
- `CompositeAnalysis` não roda em paralelo com o pipeline semântico;
- Structured Output do compilador passa a ser estrito;
- `semantic_preservation_v1` e `typical_monthly_v1` entram em rollout global;
- golden tests travam essas garantias.

## Migração progressiva

1. manter rotas legadas apenas para operações ainda não cobertas;
2. medir `honest_compiler_failure` e `honest_unsupported` por capacidade;
3. preencher lacunas no adaptador/motores, sem criar novos pipelines;
4. remover módulos legados quando sua utilização chegar a zero;
5. conservar rollback exclusivamente por feature flag, não por fallback
   semântico silencioso.
