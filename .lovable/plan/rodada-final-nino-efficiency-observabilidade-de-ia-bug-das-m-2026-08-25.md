# Rodada final Nino Efficiency + Observabilidade de IA + bug das metas por categoria

## O que já foi verificado no código/banco antes deste plano

- `agent_runs` tem 435 runs desde 16/07/2026 e já possui as colunas necessárias (`tokens_in`, `tokens_out`, `latency_ms`, `llm_calls`, `path`, `capability`, `channel`, `model`, `model_tier`, `provider`, `estimated_cost_usd`, `llm_ms`, `tool_ms`, `routing_ms`, `context_ms`, `history_ms`, `persist_ms`, `system_prompt_chars`, `context_layers`). Histórico completo é recuperável sem inventar dado.
- O system prompt é montado por concatenação incremental em `AgentCore.ts` (linhas ~700-880): capability + turn plan + prompt do banco + vários blocos adicionais empilhados por `systemPrompt = ... + systemPrompt`. O `ContextBudget` mede (`system_policy`) mas não recorta nem escolhe blocos — daí os ~25 KB observados.
- `document_efficiency_v1` existe em `FeatureFlags.ts` mas `assistant-ingest-document/index.ts` nunca chama `isEnabled`/`flagSnapshot`: a flag é hoje decorativa.
- **Causa raiz do bug das metas (confirmada no banco):** `home-snapshot/index.ts` busca categorias com `.eq("user_id", userId)`. As categorias das metas afetadas (`Lazer`, `Alimentação`, `Transporte`, `Assinaturas`) são categorias globais (`user_id IS NULL`), então `categoryNameById` fica vazio para elas e o snapshot materializado grava `activeCategoryGoals[].categoryName` nulo — a UI cai no fallback "Categoria". Consultei `financial_current_snapshots` e confirmei `categoryName` nulo com `category_id` válido e existente. O mesmo filtro aparece em `finance-derived/index.ts`.

## Parte A — Metas por categoria (bug funcional)

1. Em `home-snapshot/index.ts`, ler categorias como o app faz: globais + do usuário (`user_id IS NULL OR user_id = :uid`), sem mudar nenhuma fórmula.
2. Mesmo ajuste em `finance-derived/index.ts` (e qualquer outro leitor de `categories` com o mesmo filtro que eu encontrar na varredura).
3. Invalidar/recomputar os snapshots materializados afetados para o nome voltar imediatamente (bump da versão do cache derivado, sem tocar em valor financeiro).
4. Fallback honesto quando `category_id` aponta para categoria inexistente: manter o rótulo neutro atual e registrar o problema de integridade em log/telemetria, sem inventar nome.
5. Testes de regressão (`src/test/`): meta com `category_id` válido expõe nome; meta com categoria global expõe nome; meta sem categoria não quebra; categoria inexistente cai no fallback.

## Parte B — Context Budget realmente aplicado

Refatorar a montagem do prompt em módulos compostos, sem remover regra de segurança/verdade:

- `CORE_POLICY` (identidade, não invenção, TruthValidator, segurança) — sempre.
- `CHANNEL_POLICY` (WhatsApp/App/simulador) — só o canal do turno.
- `CAPABILITY_POLICY` — só as regras da capability roteada (lançamento, cartão, metas, emoção, gráficos etc.), hoje enviadas todas de uma vez.
- `TOOL_POLICY` — sem repetir o que já está na descrição da tool exposta.
- `MEMORY_POLICY` — só memória relevante ao turno.

Regras: nenhuma regra de verdade financeira, anti-invenção ou segurança sai do CORE; o que sai são duplicações, exemplos redundantes e blocos de capability irrelevantes. O `ContextBudget` passa a **decidir** a composição (dropar camada opcional, nunca truncar no meio), e o run grava as camadas em `context_layers` e `system_prompt_chars` antes/depois. Meta: turno LLM comum ≤ 4–5k tokens de contexto.

## Parte C — Memória estruturada integrada

Fechar o fluxo `AgentCore → MemoryStore → ContextBuilder → ContextBudget → LLM` com separação explícita: working (turno recente), semantic (preferências/fatos estáveis), episodic (acontecimentos), pending action (workflow), e **financial state sempre relido das fontes canônicas**. Nunca persistir saldo, patrimônio, fatura, gasto/receita atual, dívida, projeção ou valor de meta como memória. Deduplicação por chave estruturada com atualização no lugar (sem crescimento infinito) e preferência por fato estruturado em vez de frase.

## Parte D — `document_efficiency_v1` controlando o runtime

Ligar a flag em `assistant-ingest-document`: ON → detecção de tipo, extração de texto, parser determinístico, modelo `document_text` quando necessário, Vision só quando necessário; OFF → caminho anterior. Testar ON e OFF com fatura e extrato, garantindo cobertura de valores, datas e parcelas e nenhum truncamento silencioso.

## Parte E — Telemetria de modelo correta

Corrigir a persistência para que `agent_runs.model` seja o modelo **efetivamente usado** (último attempt bem-sucedido), coerente com `model_tier` e `model_attempts`, e validar em runtime que tier1/tier2/tier3 chegam aos modelos configurados.

## Parte F — Read model de analytics (SQL agregada)

Nova RPC admin de analytics sobre `agent_runs`, agregando **no banco** por dia × canal × path × capability × model_tier: runs, llm_runs, deterministic_runs, zero_token_runs, tokens_in/out/total, avg_tokens, avg_llm_tokens, avg_llm_calls, avg/p50/p95 de latência (e latência por estágio quando existir), custo estimado. Filtros de período e dimensões como parâmetros; o frontend recebe poucas linhas. Segunda RPC para comparação antes × depois por milestone. Marcadores de milestone derivados das datas reais de migration/deploy do Efficiency V1, V2 e do fechamento — nenhuma data inventada.

## Parte G — Painel Admin (sem página duplicada)

Dentro de **Nino & IA**, na aba existente "Custo e uso" (`IAInteligencia`), adicionar:

- **Bloco "Eficiência do Nino"**: % de runs sem LLM, tokens/interação, tokens/interação LLM, P50, P95, LLM calls/interação, cada um com variação vs. período anterior.
- **Gráfico histórico de tokens** (área/linha por dia, total e input/output), com 7/30/90 dias, todo o histórico e intervalo personalizado, mais marcadores verticais dos milestones.
- **Cards antes × depois** com milestone selecionável (tokens/interação, runs sem IA, redução %), tudo calculado do banco.
- **Gráfico histórico de latência** com P50, P95 e média em segundos, mesmos milestones.
- **Comparativo deterministic × LLM** (P50/P95 de cada caminho).
- Filtros principais visíveis (período, canal, path) e avançados em dropdown (capability, model tier, modelo).
- Indicação explícita de quando uma métrica só existe a partir de certa data; nunca preencher histórico artificialmente.

## Parte H — Testes, deploy e validação

- Testes de eficiência: saldo, gasto do mês, maior categoria, patrimônio, weekday e categorização seguem com `tokens_in = 0`, `tokens_out = 0`, `llm_calls = 0`; EvidencePack segue compacto no caminho LLM.
- Suíte completa + build; migration aplicada; Edge Functions publicadas (`agent-run`, `whatsapp-webhook`, `home-snapshot`, `finance-derived`, `assistant-ingest-document`).
- Validação com dados reais: system prompt antes × depois em tokens, tokens/interação, deterministic rate, P50/P95, nome de categoria nas metas.
- Se a amostra pós-implantação for pequena, reporto a amostra sem tirar conclusão estatística.

## Fora de escopo (garantia explícita)

Nenhuma alteração em receita, despesa, saldo, patrimônio, fatura, cartão, parcelamento, refund, dívida, investimento, data comportamental, projeção ou fórmula de metas. O bug de metas é corrigido apenas na resolução/exibição do nome da categoria.
