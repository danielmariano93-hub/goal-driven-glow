
# Por que o gráfico não veio

Diagnóstico com base no log real da conversa (2026-07-23 09:50 e 16:15). O usuário pediu duas vezes um gráfico "dia a dia do gasto médio" e recebeu texto puro ("No período, você gastou R$ 20.642,74…"). Verifiquei também as tabelas: `agent_artifacts` e `agent_turn_events` estão **vazias** — nenhum artefato foi criado nas duas tentativas. Cinco causas concorrem para isso:

### 1. Prompt do sistema tem duas regras que se contradizem
Em `supabase/functions/_shared/agent/prompt.ts`:
- Linha 23: "Consultas analíticas, **gráficos**, relatórios […] DEVEM chamar `analyze_spending`."
- Linha 27: "Pedidos explícitos de gráfico DEVEM chamar `generate_chart_artifact`."

A regra 23 vence porque aparece primeiro e é mais genérica ("gráficos"). O LLM chama `analyze_spending`, recebe totais, e responde com o texto padrão. `generate_chart_artifact` nunca é invocada.

### 2. `generate_chart_artifact` só cobre 3 kinds: `compare | forecast | goal`
O usuário pediu **série temporal diária** ("dia a dia como está o meu gasto médio"). Não há builder nem tool para isso, então mesmo que o LLM tentasse chamar a tool, o `kind` correto não existe. Não há `daily_series` / `spending_by_day`.

### 3. Fast-path analítico do `AppAdapter` também compete
`isAnalyticsRequest` casa "gráfico" e dispara `analyze_spending` diretamente (sem LLM). Há um guard `!wantsChart(text)` que evita o atalho quando a palavra "gráfico" aparece — está correto para o texto do usuário —, mas a regra do prompt (item 1) leva ao mesmo resultado no caminho do LLM. Ou seja, os dois caminhos convergem para `analyze_spending`.

### 4. Resposta do LLM não referencia o artefato
Mesmo se `generate_chart_artifact` for chamada, o `AppAdapter` só faz `findRecentArtifact` **por conversa+timestamp** depois do turno. Se o LLM chamar a tool mas não escrever nada sobre o gráfico, o painel exibe o texto genérico. Não há checagem de "gerou artefato mas não citou".

### 5. WhatsApp nunca recebe mídia porque `outbound_messages.artifact_id` não é populado
`whatsapp-send/index.ts` lê `artifact_id` de `outbound_messages`, mas em nenhum ponto do pipeline (AgentCore, WhatsAppAdapter, tools) esse campo é gravado. Resultado: mesmo com artifact criado, `whatsapp-send` sempre cai em `media_status = 'none'` e envia texto.

### 6. Telemetria confirma o pipeline: `agent_turn_events` vazio
A inserção instrumentada no `AgentCore` está silenciosamente falhando ou não sendo chamada nesses caminhos rápidos. Menor prioridade para este bug, mas explica por que não temos visibilidade.

# Correção — escopo cirúrgico

## A) Prompt: uma única fonte de verdade para gráficos
`supabase/functions/_shared/agent/prompt.ts`:
- Reescrever regra 23 para: "análises **textuais** (`onde gasto mais`, `resumo`, `me analisa`) → `analyze_spending`".
- Deixar regra 27 mais forte e explícita para qualquer pedido que contenha "gráfico", "chart", "visualiza", "mostra em barras/linha/pizza", "dia a dia", "por dia", "por semana", "evolução visual".
- Adicionar: "Sempre que chamar `generate_chart_artifact`, na resposta **cite o gráfico gerado em uma frase curta** (o app o exibe embaixo). Não repita todos os números do gráfico."

## B) Motor: adicionar série temporal diária
Novo módulo `_shared/analytics/timeseries.ts` com `computeDailySpend({ txs, from, to })` que retorna `{ labels: string[], series: [{name:'Diário', data}, {name:'Média 7d', data}], totals, provenance }`. Reaproveita `provenance.ts` e `computeCompare`-style filters (mesmos exclusores de transferência/investimento e `movement_kind`).

Novo builder `buildTimeseriesArtifact(result)` em `_shared/artifacts/builder.ts` produzindo `chart.type = 'line'` com séries "Diário" + "Média 7 dias" e `formula_version = 'timeseries.daily.v1'`.

Nova tool `spending_timeseries_daily(args: { from?, to?, granularity: 'day'|'week' })` em `_shared/agent/tools.ts` (com `reconciliationGate`), registrada no schema.

Estender `generate_chart_artifact` com `kind: 'timeseries'` e passthrough de `granularity`/janela.

## C) Renderer: suportar duas séries em linha
`src/components/assessor/artifacts/ChartArtifactRenderer.tsx` já trata `line`/`area`; só validar labels longas (dia do mês) e permitir a segunda série (média móvel) com cor secundária. Sem mudança estrutural.

## D) AppAdapter: garantir que o artefato aparece
`_shared/agent/core/adapters/AppAdapter.ts`:
- Reforçar `wantsChart` com os mesmos gatilhos do prompt ("dia a dia", "por dia", "evolução", "visual").
- Depois de `handleTurn`, se `recent?.payload` existir e a reply do LLM **não** mencionar gráfico/visual, prefixar reply com "Gerei um gráfico com base nos dados reais 👇". Evita a experiência atual (texto plano, artefato invisível).

## E) WhatsApp: anexar `artifact_id` ao outbound
No caminho de envio (onde `outbound_messages` é criado a partir do reply do agente), quando o turno produzir `artifact_id`, gravar em `outbound_messages.artifact_id`. Isso destrava `whatsapp-send` → `artifact-render` → mídia PNG com fallback textual, contrato que já existe.

Localizar o insert em `whatsapp-webhook` / `WhatsAppAdapter` e propagar `metrics.artifact_id` capturado pelo `Observability`.

## F) Observabilidade
Corrigir o insert em `agent_turn_events` (nomes das colunas: `formula_versions`, `artifact_status`, `artifact_id`) — o schema atual difere do que o código tenta escrever. Sem isso, seguimos cegos.

# Aceite (o que valida a correção)

1. Mensagem "gera um gráfico dia a dia dos meus gastos" no app → resposta traz `ChartArtifactRenderer` com linha diária + média móvel, `provenance.formula_version = 'timeseries.daily.v1'`.
2. Mensagem "compare julho com junho em gráfico" → bar chart com séries Antes/Agora (já existente), agora efetivamente disparada.
3. Mensagem "quanto vou fechar o mês, manda em gráfico" → forecast_band aparece.
4. Mesma frase no WhatsApp → chega **imagem PNG** (via `artifact-render`); se render falhar, texto de fallback com os mesmos números.
5. `agent_artifacts` e `agent_turn_events` passam a ter linhas com `formula_version`/`formula_versions` corretos.

# Arquivos que serão tocados

- `supabase/functions/_shared/agent/prompt.ts` — regras 23/27.
- `supabase/functions/_shared/analytics/timeseries.ts` — novo.
- `supabase/functions/_shared/artifacts/builder.ts` — `buildTimeseriesArtifact`.
- `supabase/functions/_shared/agent/tools.ts` — tool `spending_timeseries_daily` + `kind: 'timeseries'` em `generate_chart_artifact` + registro no schema.
- `supabase/functions/_shared/agent/core/adapters/AppAdapter.ts` — `wantsChart` ampliado + hint quando artefato existe e reply o ignora.
- `supabase/functions/_shared/agent/core/adapters/WhatsAppAdapter.ts` (ou onde `outbound_messages` é criado) — persistir `artifact_id`.
- `supabase/functions/_shared/agent/core/AgentCore.ts` / `Observability.ts` — corrigir colunas em `agent_turn_events`.
- `src/test/analytics-timeseries.test.ts` e `src/test/artifact-contract.test.ts` — novos casos para timeseries e para "reply cita artefato".

Sem migrations novas: as tabelas `agent_artifacts` e `agent_turn_events` já possuem as colunas necessárias.
