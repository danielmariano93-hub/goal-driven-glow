# Corrigir geração de gráficos do Assessor (App + WhatsApp) — rota determinística e paridade com a Home

Sua análise prévia está correta em quase todos os pontos. Confirmei no código atual (não só na versão publicada) o seguinte:

- `AppAdapter.ts` já tem o guard `isAnalyticsRequest(text) && !wantsChart(text)`, mas `wantsChart` é estreito e **não cobre** frases reais suas: "gasto médio diário", "reduzindo", "andando de lado", "tendência", "média diária". `isAnalyticsRequest` casa "gasto.*mais" e "como está.*mês" → cai no fast-path `analyze_spending` + `buildAnalyticsReply`, exatamente o texto que você recebeu.
- `analyze_spending` filtra apenas por `type=expense` e ignora `status`, `movement_kind` e exclusões comportamentais — por isso **Aplicações (R$ 5.000)** aparece como maior "gasto". Não é a mesma definição da Home.
- `spending_timeseries_daily` existe mas calcula **gasto diário + média móvel 7d**, não a **média diária acumulada** (acumulado ÷ dias corridos) que você pediu.
- `generate_chart_artifact` e `analyze_spending` disputam o mesmo gatilho no prompt; o LLM tende a escolher a textual.
- Nenhum guardrail obriga artefato quando o pedido é visual (`ResponseValidator` não checa isso).
- WhatsApp: pipeline de mídia (`artifact_id → whatsapp-send → artifact-render`) existe e está correto; o problema é que o artefato nunca é criado. As mesmas 4 causas de LLM/métrica/ferramenta afetam WhatsApp.
- Deploy drift: fast-path já tem o guard no repo, mas os logs mostram resposta idêntica ao `buildAnalyticsReply` sem `agent_run` — o `agent-chat` publicado provavelmente está atrás. Precisa redeploy explícito.

## Correções (ordem de aplicação)

### 1. Fast-path do App: nunca interceptar pedidos com intenção visual/analítica não-trivial
Arquivo: `supabase/functions/_shared/agent/core/adapters/AppAdapter.ts`

- Ampliar `wantsChart` para: `gráfico(s)`, `graficos`, `chart`, `visualiza(ção|r)`, `linha|curva|barras|pizza|donut`, `dia a dia`, `diariamente`, `por dia|semana|mês`, `evolu(ção|ir)`, `tend(ência|encia)`, `média (diária|do dia|acumulada)`, `gasto médio`, `estou reduzindo`, `andando de lado`, `ritmo dos gastos`.
- Restringir `isAnalyticsRequest` a pedidos **textuais estritos**: `resumo`, `me analisa`, `onde gasto mais` (sem "gráfico" nem "evolução"). Remover "evolução" e "gráfico" do regex.
- Instrumentar o fast-path: quando ele responder, gravar um `agent_turn_events` com `route='fast_path_analytics'` para acabar com o ponto cego de observabilidade.

### 2. Nova métrica determinística: média diária acumulada
Novo arquivo: `supabase/functions/_shared/analytics/dailyAverage.ts`

`computeCumulativeDailyAverage({ txs, from, to })` retorna por dia:
- `daily_consumption` (real, filtrado por `isRealMonthlyMovement` — mesma definição da Home; exclui aplicações, transferências, resgates, aportes, pagamento de fatura, canceladas)
- `cumulative_consumption`
- `elapsed_days` (dias corridos desde `from`, inclusivo)
- `cumulative_daily_average = cumulative / elapsed_days`
- `daily_average_change` e `daily_average_change_pct` vs. dia anterior
- `trend` heurística: `falling | rising | flat` (regressão linear simples sobre a média acumulada)
- `provenance.formula_version = 'daily_average.cumulative.v1'`, sob `reconciliationGate`

### 3. Estender o motor de artefatos
Arquivo: `supabase/functions/_shared/artifacts/builder.ts`

`buildCumulativeDailyAverageArtifact(result)`:
- `chart.type = 'line'`
- Série principal: "Média diária acumulada"
- Série secundária pontilhada: "Gasto do dia"
- `x_labels` como "DD/MM"
- `annotations`: tendência ("↓ caindo 12%", "→ estável", "↑ subindo 8%") derivada do motor, não do LLM
- `formula_version = 'daily_average.cumulative.v1'`

### 4. Nova ferramenta + kind no chart
Arquivo: `supabase/functions/_shared/agent/tools.ts`

- Registrar `spending_average_daily_trend(args: { from?, to? })` → chama `computeCumulativeDailyAverage` sob `reconciliationGate`.
- `generate_chart_artifact` aceita `kind: 'average_daily_trend'` além dos existentes.
- Descrição das tools **desambiguada** (fim da colisão do LLM):
  - `analyze_spending`: "APENAS respostas textuais de resumo/onde mais gastou. NUNCA quando o usuário pedir gráfico, tendência, evolução ou média diária."
  - `generate_chart_artifact`: "OBRIGATÓRIO em qualquer pedido visual. Escolha o kind: `average_daily_trend` para 'gasto médio dia a dia / tendência / estou reduzindo', `timeseries` para série diária bruta, `compare` para dois períodos, `forecast` para fechamento, `goal` para meta."
- `analyze_spending` passa a filtrar por `isRealMonthlyMovement` (mesma definição da Home). Fim da divergência de "Aplicações R$ 5.000".

### 5. Prompt: rota determinística
Arquivo: `supabase/functions/_shared/agent/prompt.ts`

- Unificar em uma regra única e imperativa (remover ambiguidade de regras 23 vs 27): "Toda intenção visual ou de tendência DEVE chamar `generate_chart_artifact`. Pedido de 'gasto médio dia a dia', 'estou reduzindo', 'andando de lado', 'tendência' → `kind: 'average_daily_trend'`."
- "Se o turno anterior recebeu correção do usuário ('não foi isso', 'não é o que pedi'), releia o pedido original e refaça obrigatoriamente pela rota visual."

### 6. Guardrail de saída: artefato obrigatório em pedido visual
Arquivo: `supabase/functions/_shared/agent/core/ResponseValidator.ts` (e/ou `AgentCore.ts`)

Após o turno, se `wantsChart(inbound.text)` for verdadeiro E nenhum `artifact_id` foi produzido:
1. Executar fallback determinístico: rodar `spending_average_daily_trend` + `buildCumulativeDailyAverageArtifact` no servidor, persistir e anexar.
2. Se ainda falhar (dados insuficientes ou erro), responder com explicação estruturada e honesta ("não consegui gerar o gráfico agora porque X"). Nunca devolver `buildAnalyticsReply`.
3. Registrar `chart_missing_recovered=true|false` em `agent_turn_events`.

### 7. Estado contextual da tarefa
Arquivo: `supabase/functions/_shared/agent/core/ContextPipeline.ts`

Persistir no `agent_memory` do turno: `requested_output`, `requested_metric`, `requested_granularity`, `previous_response_rejected`. Quando o próximo turno contiver referência ("desse gráfico", "agora manda", "não foi isso"), o Core lê esses campos como restrição ativa antes do LLM.

### 8. Renderer no App
Arquivo: `src/components/assessor/artifacts/ChartArtifactRenderer.tsx`

- Aceitar 2 séries em `line` (principal sólida + secundária tracejada) — já suporta parcialmente.
- Renderizar `annotations.trend` como chip acima do chart ("Sua média está caindo 12% no mês").
- Sem mudança estrutural.

### 9. WhatsApp: paridade e fail-loud
Arquivos: `supabase/functions/whatsapp-send/index.ts`, `_shared/agent/core/OutboundQueue.ts` (já propaga `artifact_id`), `artifact-render`.

- Confirmar que `artifact-render` está deployada e que `sendImage` retorna `media_status='delivered'` em sucesso; em falha, marcar `media_status='failed_fallback_text'` (não `none`) e emitir `provider_health_events`.
- O fallback textual do WhatsApp usa **os mesmos números** da `provenance` do artefato (não recalcula).
- Adicionar teste de integração: mensagem "gera um gráfico do meu gasto médio diário" → espera artefato com `formula_version=daily_average.cumulative.v1` e `outbound_messages.artifact_id` populado.

### 10. Redeploy explícito
- Republicar `agent-chat`, `artifact-render`, `whatsapp-send`, `whatsapp-webhook`. Registrar `code_version` (hash curto do commit) em `agent_turn_events` para detectar drift no futuro.

## Testes (bloqueiam merge)

- `src/test/analytics-daily-average.test.ts`: série acumulada com dados sintéticos (dia 1: 600 → média 600; dia 2: +200 → média 400; dia 3: +250 → média 350). Exclusão de aplicação (movement_kind='investment') e transferência.
- `src/test/agent-chart-routing.test.ts`:
  - "gera um gráfico do meu gasto médio dia a dia" → **não** cai no fast-path, chama `generate_chart_artifact` com kind `average_daily_trend`, artefato criado.
  - "resumo do mês" → fast-path textual (comportamento antigo preservado).
  - "não foi isso, quero em gráfico" após turno textual → gera gráfico via fallback determinístico.
- `src/test/analyze-spending-consumption-parity.test.ts`: soma de `analyze_spending` = soma da Home (mesmo filtro `isRealMonthlyMovement`), aplicações **fora**.
- `src/test/whatsapp-chart-delivery.test.ts` (mock WAHA): artefato → `artifact-render` PNG → `sendImage`; simular falha → `media_status='failed_fallback_text'` + texto com os mesmos números.

## Aceite

1. App: "gera um gráfico dia a dia do meu gasto médio, pra saber se estou reduzindo" → linha da média acumulada + linha do gasto diário + chip de tendência, provenance `daily_average.cumulative.v1`, aplicações **ausentes**.
2. App: "resumo do mês" → resposta textual (fast-path preservado, agora com telemetria).
3. App: turno "não foi isso" seguido de "manda em gráfico" → gráfico é entregue, não texto.
4. WhatsApp: mesma frase → PNG chega no chat; se render falhar, texto de fallback com os mesmos números e `media_status` correto.
5. `agent_artifacts`, `agent_turn_events` populados com `formula_version` e `code_version`.
6. `analyze_spending` e a Home retornam o mesmo total de consumo para o mesmo período.

## Arquivos tocados

- `supabase/functions/_shared/analytics/dailyAverage.ts` (novo)
- `supabase/functions/_shared/artifacts/builder.ts`
- `supabase/functions/_shared/agent/tools.ts`
- `supabase/functions/_shared/agent/prompt.ts`
- `supabase/functions/_shared/agent/core/adapters/AppAdapter.ts`
- `supabase/functions/_shared/agent/core/AgentCore.ts` / `ResponseValidator.ts` / `ContextPipeline.ts`
- `supabase/functions/whatsapp-send/index.ts` (só o fail-loud)
- `src/components/assessor/artifacts/ChartArtifactRenderer.tsx`
- 4 novos testes em `src/test/`

Sem migrations novas: `agent_artifacts`, `agent_turn_events` e `outbound_messages.artifact_id` já existem.
