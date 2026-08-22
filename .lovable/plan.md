# Nino: Deterministic-First + Evidence Pack (nino_efficiency.v1)

Auditoria feita contra o código e o banco reais. Nada de fórmula financeira muda. A fundação existente (AgentCore, CapabilityRouter, DeterministicAnswers, ContextBudget, TruthValidator, aiCircuit) é preservada e completada — não reescrita.

## 1. AS-IS confirmado (com evidência)

Fluxo real: canal → AgentCore → CapabilityRouter (41 tools filtradas por capability) → ContextPipeline/FinancialContext360 → ActionPlanner → (weekday determinístico | capability determinística | tool loop LLM) → ResponseValidator/TruthValidator → persistência.

O que **já existe e está correto** (não recriar):
- Rota determinística real: `execution: "deterministic"` + `executeDeterministicCapability` cobre snapshot, metas, weekday, dívidas, previsão, before_spending, emoções, merchant distribution, recentes. Runs com `tokens_in = 0` provam que funciona.
- FastLog (175 runs, ~974 ms, 0 tokens).
- `ContextBudget` (`serializeWithinBudget`, 4.000 chars) + `tokenBreakdown`.
- Histórico híbrido (4 turnos crus + resumo).
- Circuit breaker 402/403 (`aiCircuit.ts`) e fallback de modelo no planner.
- Escopo de tools por capability (o `general` de 16 tools é a exceção).

## 2. Causas-raiz comprovadas (dados reais do projeto)

1. **Resultado integral da tool entra no prompt.** `llm.ts` faz `JSON.stringify(toolResult)` sem orçamento. Medido em `agent_tool_calls`: `assess_financial_performance` 45.150 chars, `analyze_merchants` 25.298, `explain_behavior_change` 8.657, `get_financial_snapshot` 8.943, `get_weekday_spending_pattern` 10.267. É o maior consumidor de input.
2. **Capability `general` é a caixa gigante.** 24 runs, média **18.972** tokens de entrada, máx. 30.711, 7,9 s — o pior par custo/latência do sistema, com 16 tools expostas.
3. **Capabilities determinísticas caindo no LLM.** Existem runs `path=llm` para `financial_performance` (26.042 in), `financial_evolution` (26.378), `merchant_distribution` (25.576), `debt_status` (21.793): o formatter determinístico retorna `null` (dado ausente/forma inesperada) e o turno cai no loop LLM em vez de cair num renderer determinístico honesto.
4. **Sem model routing real.** `ai_model_routes`: as 5 rotas usam `google/gemini-2.5-flash` (geração anterior) com `max_steps` 4–8 e fallback único `openai/gpt-5-mini`. Não há tier barato nem tier de raciocínio.
5. **Loop reenvia contexto.** `maxSteps` até 8; cada passo reenvia system + histórico + schemas + todos os resultados anteriores. Latência P95 ~9–13 s.
6. **Telemetria de custo furada.** `agent_runs` tem `tokens_in/out`, `token_breakdown`, `stage_ms`, mas `estimated_cost_usd` está nulo em praticamente todos os runs e não há `tool_result_chars`, `evidence_chars`, `llm_calls`, `route_reason`.
7. **Bug `multifinance:round2 is not defined` (confirmado).** `_shared/proactive/context.ts` usa `round2(...)` nas linhas 82–83 sem declarar nem importar a função (`round2` só existe em `cashHorizon.ts`, local). Resultado: o tick multi-financeiro falha para todos os usuários — 4 erros gravados em `agent_settings.last_tick_errors`. Correção trivial e sem impacto em fórmula: exportar/importar o helper. É só arredondamento a 2 casas.
8. **Ingestão de documentos** reenvia `SYSTEM_PROMPT` completo por batch e usa o modelo de visão vindo de `ai_model_routes` (mesma geração antiga).

## 3. TO-BE (arquitetura alvo)

Especialistas determinísticos coordenados — sem enxame de LLMs:

```text
canal → AgentCore → Router determinístico (parser + semantic + memória)
   ├─ resolve determinístico → renderer → resposta (0 token)
   └─ precisa de LLM
        → tool canônica executada ANTES do modelo (paralela quando independente)
        → EvidencePack (<= 2 KB)
        → 1 chamada LLM (tier escolhido) → validação → resposta
```

Mudanças centrais:
- **EvidencePack**: cada tool passa a devolver `{ full, evidence }`. `full` continua para auditoria/artifacts/banco; só `evidence` entra no prompt. Compressão semântica (facts, top drivers, comparação, sinais, confiança, data_quality, formula_versions, provenance) — nunca truncar JSON.
- **Tool output budget**: `LLM_TOOL_RESULT_MAX_CHARS = 2.000` (override explícito por tool, registrado). Observabilidade de `full_chars`, `llm_chars`, `compression_ratio` e teste de regressão que falha se uma tool estourar sem autorização.
- **Deterministic-first v2**: quando o formatter determinístico não conclui, tentar renderer secundário/estado honesto antes de escalar para LLM; escalonar só com baixa confiança de classificação.
- **Progressive tool disclosure**: capability factual = 1 tool canônica; capability complexa = 2–3; `general` reduzido a um núcleo mínimo (snapshot + recentes + busca), com ampliação só sob pedido explícito do passo anterior.
- **Loop curto**: `maxSteps` 2 para factual/simples, 3 para análise composta; pré-execução da tool canônica pelo router elimina a chamada "só para escolher tool".
- **Paralelismo**: `Promise.all` com limite de concorrência 3 e timeout por tool no CompositeExecutor.
- **Degradação hierárquica**: FULL AI → DETERMINÍSTICO + TEMPLATE → DETERMINÍSTICO. Sem crédito de IA, perguntas factuais continuam respondendo (hoje já parcialmente, será garantido por teste).

## 4. Model routing proposto (modelos suportados hoje pelo gateway)

| Tier | Uso | Modelo | Fallback |
|---|---|---|---|
| 0 | factual/operacional | nenhum | — |
| 1 | classificação ambígua, humanização, extração simples | `google/gemini-3.1-flash-lite` | `openai/gpt-5.4-nano` |
| 2 | análise financeira, perguntas compostas | `google/gemini-3.7-flash` | `openai/gpt-5.4-mini` |
| 3 | raciocínio complexo (raro) | `google/gemini-3.1-pro-preview` | `openai/gpt-5.6-terra` |
| Visão | documentos difíceis | `google/gemini-3.7-flash` | `google/gemini-2.5-pro` |

Classificador de tier por capability + complexidade + ambiguidade + nº esperado de tools + risco (não pela palavra "análise"). Chamadas OpenAI GPT-5.6 no caminho chat-completions continuam com `reasoning_effort: "none"` (já tratado em `llm.ts`).

## 5. Impacto em arquivos

Alterados: `_shared/agent/llm.ts` (budget de tool result, 1 tool antes do modelo, paralelismo), `core/ActionPlanner.ts` (pré-execução + tier + route_reason), `core/CapabilityRouter.ts` (`general` mínimo, progressive disclosure), `core/DeterministicAnswers.ts` (renderers de fallback honesto), `core/CompositeExecutor.ts` (paralelo + limites), `core/ContextBudget.ts` (budget por camada), `core/Observability.ts` + `DecisionLogger.ts` (novos campos), `_shared/intelligence/modelGateway.ts` (tiers), `_shared/proactive/context.ts` (**fix round2**), `_shared/proactive/cashHorizon.ts` (exportar helper), `assistant-ingest-document/index.ts` (system prompt por sessão, JSON compacto, modelo por dificuldade), `core/FeatureFlags.ts` (novos flags).

Criados: `core/EvidencePack.ts` (contrato + compressores por capability), `core/ToolBudget.ts`, `src/test/nino-efficiency.test.ts`, `src/test/nino-evidence-budget.test.ts`, `docs/NINO_EFFICIENCY_V1.md`.

Removidos: nenhum arquivo (só remoção de tools do grupo `general`).

## 6. Banco (migrations propostas, não executadas)

1. `agent_runs`: `llm_calls int`, `tool_result_full_chars int`, `tool_result_llm_chars int`, `evidence_chars int`, `route_reason text`, `model_tier text`, `provider_cost_usd numeric` + preenchimento real de `estimated_cost_usd`.
2. `ai_model_routes`: `model_tier text`, atualização das 5 rotas para os modelos da tabela acima.
3. `financial_feature_flags`: `evidence_pack_v1`, `deterministic_first_v2`, `progressive_tools_v1`, `context_budget_v2`, `model_routing_v2` (todos default off, exceto o fix do round2 que não é flag).
4. View `agent_cost_by_capability` para responder "quanto custa uma pergunta de fatura / uma conversa no WhatsApp / um usuário por mês".

Nenhuma tabela financeira, RPC de verdade financeira ou fórmula é tocada.

## 7. Orçamentos

Contexto por turno (alvo ~4.500 tokens, hoje 12–30k): system/policy 900 · turno atual integral · working memory (2–4 turnos) 600 · memória estruturada 300 · EvidencePack 500 (2 KB) · schemas de tools 400 (1–3 tools).

Tool result para LLM: 2.000 chars padrão; exceções declaradas por tool com justificativa e teste.

## 8. Testes (suite de regressão)

A) factuais → `path=deterministic_tool`, 0 token; B) analíticas → EvidencePack <= 2 KB + 1 chamada LLM; C) aconselhamento → simulação determinística primeiro; D) follow-up ("e no mês passado?"); E) ambiguidade ("e sexta?"); F) escrita/confirmação; G) sem crédito de IA → factual continua respondendo; H) budget de tool estourado falha o teste; I) paridade App/WhatsApp nos mesmos fatos; J) `proactive/context.ts` executa sem `round2 is not defined`.

## 9. Rollout, rollback e metas

Etapas: (1) fix round2 + telemetria real; (2) EvidencePack + tool budget atrás de `evidence_pack_v1`; (3) progressive tools + `general` mínimo; (4) deterministic-first v2; (5) model routing v2; (6) documentos; (7) benchmark antes/depois. Cada etapa é flag independente; rollback = desligar a flag (o caminho antigo permanece no código durante o ciclo). Sem shadow calls pagas: comparação usa métricas de runs reais por flag.

Impacto estimado, ancorado no baseline medido: input por turno LLM de ~15–19k para ~4–5k (**-65% a -75%**); `general` de 18.972 para <= 6k; resolução determinística de perguntas factuais comuns > 80%; latência determinística P50 < 1 s, LLM simples P50 < 3 s / P95 < 5 s, raciocínio complexo P95 < 8 s; custo de IA em interações rotineiras -70% a -85%.

## 10. Riscos

| Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|
| EvidencePack omitir fato necessário → resposta pior | média | alto | compressão semântica por capability + TruthValidator + testes por capability |
| Deterministic-first responder seco onde cabia consultoria | média | médio | escalonamento por baixa confiança + templates com variação |
| `general` enxuto perder cobertura | média | médio | progressive disclosure + métrica `clarification_rate` |
| Tier 1 barato classificar errado | baixa | médio | tier sobe automaticamente em ambiguidade; fallback por provider |
| Fix do round2 alterar número | baixa | alto | é só arredondamento a 2 casas; teste comparando antes/depois |
| Divergência App vs WhatsApp | baixa | alto | mesmo core; teste de paridade |

Nenhuma alteração de regra financeira está prevista. Se durante a execução algo exigir mexer em fórmula, eu paro e peço autorização.
