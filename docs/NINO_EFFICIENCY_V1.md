# Nino Efficiency v1

Objetivo: reduzir consumo de IA e latência sem abrir mão da verdade financeira única.
Nenhum número passa a nascer no modelo — a compressão só muda **o que o modelo lê**.

## Camadas

1. **Deterministic-first v2** (`core/DeterministicAnswers.ts`)
   Motores devolvem frases prontas (`facts.headline`, `main_attention`, `main_improvement`,
   `next_action`). `formatEngineNarrative` renderiza essas strings direto ao usuário.
   Se o motor não produziu frase, devolve `null` e o turno escala — nunca inventa texto.

2. **Roteamento determinístico ampliado** (`core/CapabilityRouter.ts`)
   Perguntas de desempenho ("meu desempenho", "desempenho financeiro", "como foi meu mês")
   passaram a cair em `financial_performance` em vez de `general` → 0 chamadas de modelo.
   Grupos `general` e `analysis` iniciam com escopo reduzido e só expandem sob demanda.

3. **EvidencePack + ToolBudget** (`core/EvidencePack.ts`, `core/ToolBudget.ts`)
   Resultado de ferramenta que vai ao prompt é comprimido preservando chaves de verdade
   (`facts`, `evidence`, `confidence`, período). Teto padrão de 2.000 chars, com overrides
   por ferramenta. Resultado pequeno segue íntegro.

4. **Tiers de modelo** (`intelligence/modelGateway.ts`)
   Tier leve para classificação/operação, tier intermediário para análise, tier de
   raciocínio só quando a tarefa exige. `max_steps` e latência-alvo variam por tier.

5. **Pré-execução** (`core/ActionPlanner.ts`)
   Leituras canônicas rodam antes da primeira chamada do modelo: economiza um turno inteiro
   quando a ferramenta já era conhecida.

## Telemetria (`agent_runs`)

| coluna | significado |
| --- | --- |
| `llm_calls` | chamadas de modelo no turno (`0` = rota determinística) |
| `tool_result_full_chars` | tamanho bruto dos resultados de ferramenta |
| `tool_result_llm_chars` | tamanho enviado ao modelo após compressão |
| `route_reason` | por que esta rota foi escolhida |
| `model_tier` | faixa de modelo efetivamente usada |

`estimated_cost_usd` passou a usar tabela de preço por família de modelo (lite/flash/mini/pro),
em vez de um preço único por fornecedor.

## Evidência E2E (22/08/2026, usuário real no app)

Mesma pergunta, antes e depois:

- Antes: `capability=general`, `path=llm`, `status=error` (`gateway_402`), resposta sem valor.
- Depois: `capability=financial_performance`, `path=deterministic_tool`, `llm_calls=0`,
  `latency_ms=1211`, resposta com números do motor e próximo passo.

## Circuit breaker de crédito

Erro `402/403` do gateway continua pausando trabalho de IA (`ai_runtime_circuit`) e a resposta
diz honestamente que a inteligência está indisponível — sem fallback incoerente.
Rotas determinísticas seguem respondendo normalmente nesse estado.
