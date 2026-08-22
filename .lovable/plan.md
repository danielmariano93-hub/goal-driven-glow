# Nino Efficiency V2 — fechamento das lacunas de arquitetura de IA

Rodada incremental sobre o Nino Efficiency V1. Nada do que já funciona é refeito: EvidencePack, ToolBudget, deterministic-first, progressive disclosure, pré-execução de tools, FastLog, TruthValidator, ResponseValidator, AgentCore compartilhado, circuit breaker, correção do `round2`, fórmulas financeiras e Performance Architecture V2/V3 permanecem como estão.

Nenhuma regra, fórmula ou tabela financeira é alterada nesta rodada.

## Estado atual verificado

- `_shared/agent/core/FeatureFlags.ts` conhece apenas 6 flags (`artifacts_v2_strict`, `commit_movement_rpc`, `channel_guard`, `shared_goals`, `split_v2`, `outbound_dlq`). A flag `use_nino_efficiency_v1` existe só na migration e nos tipos gerados — o runtime não a consulta. Rollback granular hoje não existe.
- `intelligence/modelGateway.ts` já tem tiers em código, com fallback de provider distinto; falta refletir isso nas rotas reais de `ai_model_routes`.
- `core/ContextBudget.ts` faz poda genérica por caracteres, sem contrato por camada nem telemetria por camada.
- `core/MemoryStore.ts` e `core/ContextPipeline.ts` já separam memória e snapshot financeiro, mas sem tipagem formal working/semantic/episodic nem deduplicação.
- `core/CompositeExecutor.ts` decompõe sub-perguntas, mas executa sequencialmente.
- `assistant-ingest-document/index.ts` tem ~1.970 linhas e é o maior consumidor de IA por documento.

## O que será feito

### 1. Model routing real
Primeiro consultar o catálogo de modelos realmente disponíveis no gateway (nenhum nome inventado). Depois popular `ai_model_routes` com tiers distintos: TIER 1 leve, TIER 2 análise, TIER 3 reasoning (excepcional), VISION para documentos difíceis, cada um com `primary_model`, `fallback_model` de provider diferente, `max_steps` e `max_latency_ms` próprios. TIER 0 (sem LLM) continua decidido no planner. O seletor passa a considerar capability, ambiguidade, nº esperado de tools e tipo de input — não a palavra "análise".

### 2. Paralelismo de tools
No `CompositeExecutor`/`ActionPlanner`: execução concorrente de tools declaradamente independentes, concorrência máxima 3, timeout por tool, isolamento de falha e resultado parcial quando a tool não crítica falha. Writes e passos com dependência causal continuam sequenciais.

### 3. Context Budget V2
Contrato formal por camada (system/policy, turno atual, working memory, memória semântica, memória episódica, evidência financeira, schemas de tool, Evidence Packs), com budget por camada e alvo de ~4–5k tokens por turno com LLM. A mensagem atual nunca é comprimida; working memory limitada a 2–4 turnos relevantes; contexto financeiro e preferências só entram se a capability usa. Telemetria por camada.

### 4. Memória estruturada
Tipos explícitos working / semantic / episodic no `MemoryStore`, com fatos estruturados (`{type, topic, value}`) em vez de conversas inteiras, deduplicação e atualização (upsert por `topic`) para impedir crescimento infinito. Estado financeiro (saldo, fatura, patrimônio, gastos, receita, metas, dívidas, projeções) nunca é memorizado — sempre relido dos motores/read models canônicos.

### 5. Ingestão de documentos econômica
Pipeline preferencial: detectar tipo → extração textual determinística → parser estruturado → IA só no resíduo → vision só quando necessário. PDF textual deixa de ir para visão página a página; fatura/extrato estruturado passa por parser determinístico antes da LLM. Redução de prompt repetido por lote, campos JSON redundantes e reprocessamento de páginas, com routing próprio para documento simples vs difícil. Cobertura (todas as transações, parcelas, datas, cartões, valores) é critério de aceite — nenhum truncamento silencioso.

### 6. Read models nas tools analíticas
Auditar as tools que ainda varrem grandes volumes de transações e redirecioná-las para os read models canônicos já existentes (`financial_current_snapshots`, `financial_daily_facts`, `financial_daily_category_facts`, `financial_derived_cache`, behavioral facts, performance snapshots), usando a mesma invalidação semântica. Sem nova fórmula, sem segunda verdade; tool que realmente precisa do ledger bruto continua como está.

### 7. Telemetria completa + analytics
Ampliar a telemetria do turno com provider, model, capability, channel, path, tentativas de fallback, latência de LLM e de tools, chars/tokens por camada de contexto, `compression_ratio`, `estimated_cost_usd`. `provider_cost_usd` só é preenchido se o gateway devolver custo real; caso contrário fica `NULL`, distinto do estimado. Métricas derivadas por view/RPC: taxa de resolução determinística, LLM, fallback, clarificação, falha de validação de verdade, tools e llm_calls por turno, tokens por capability, latência por capability, custo por capability/usuário/canal/modelo/conversa.

### 8. Flags granulares
Flags independentes e realmente consultadas pelo runtime: `evidence_pack_v1`, `deterministic_first_v2`, `progressive_tools_v1`, `context_budget_v2`, `model_routing_v2`, `document_efficiency_v1`. Cada uma desligável isoladamente, com defaults de produção seguros.

### 9. Modo degradado formal
Hierarquia FULL AI → DETERMINISTIC + TEMPLATE → DETERMINISTIC ONLY. Em 402/403/timeout do gateway, todas as perguntas factuais (saldo, gastos, receitas, maior categoria, patrimônio, fatura, parcelas, dívidas, metas, previsão, merchant, dia da semana, desempenho quando o motor produz narrativa) continuam respondendo. Só capacidades genuinamente dependentes de LLM informam indisponibilidade.

### 10. Validação
- Suíte de testes ampliada: factual (llm_calls=0), analítica (motor + EvidencePack), consultiva, follow-up/continuidade, sem crédito de IA, paridade App × WhatsApp, documentos textual e visual, budget de evidência, roteamento por tier.
- Deploy das Edge Functions afetadas e aplicação das migrations (idempotentes, sem DELETE destrutivo).
- Proactive tick pós-deploy para confirmar que `agent_settings.last_tick_errors` não contém mais `multifinance:round2 is not defined`.
- Benchmark antes × depois usando a telemetria histórica como baseline (tokens, llm_calls, latência, taxa determinística, custo estimado). Se não houver amostra suficiente para P50/P95, isso é declarado como amostra insuficiente em vez de estimado.

## Entrega final
Tabela ITEM / STATUS / EVIDÊNCIA cobrindo arquivos alterados, migrations, funções implantadas, tiers e modelos finais, flags e estado, testes, E2E real, prova determinística sem IA, resultado do tick, baseline × novo, tokens e latência antes × depois, percentual determinístico e o que não foi possível concluir.
