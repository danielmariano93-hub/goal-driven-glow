# Plano — Assessor MeuNino: Motor Analítico, Gráficos, Previsões e Categorização Inteligente

## A. Diagnóstico objetivo do estado atual

Auditoria dos arquivos-chave (evidências):

- `supabase/functions/_shared/agent/tools.ts` (880 linhas): tem `analyze_spending`, `get_daily_insights`, `get_spending_highlights`, `get_financial_snapshot`, `run_before_spending`, `list_category_spending_goals`, mas **não existe** `compare_periods`, `forecast_month_close`, `explain_spending_change`, `project_goal_completion`, `simulate_goal_pace`, `build_financial_report`, `generate_chart_artifact`.
- `supabase/functions/_shared/agent/core/`: já há `FinancialPlanner.ts`, `InsightsEngine.ts`, `FinancialContext360.ts`, `LearningLoop.ts`, `ResponseValidator.ts`, `ReceiptBuilder.ts`, `PendingConfirmations.ts`, adapters `AppAdapter.ts` e `WhatsAppAdapter.ts`. AppAdapter converte pedidos analíticos em um único relatório fixo (evidência da auditoria anterior).
- `SpendingReportCard.tsx` (63 linhas): renderer único de categorias — não suporta linha, área, donut livre, forecast ou meta.
- `AssessorPanel.tsx` (513 linhas): renderiza texto + `SpendingReportCard`; não há renderer de artefato genérico.
- `prompt.ts` (58 linhas): força respostas curtas — conflita com relatório rico.
- WhatsApp: `whatsapp-send/index.ts` já envia texto; não há esteira comprovada para PNG/PDF de gráfico como mídia; `outbound_messages` existe mas sem contrato `artifact_id`/`media`.
- Contábil: `_shared/engine/facts.ts` já consolidou `isRealMonthlyMovement` e `movement_kind` (Contabilidade v3), então **as fórmulas contábeis estão prontas** — o problema é que os serviços analíticos as consomem parcialmente.
- Categorização: existe `merchant_aliases` (tabela) e `LearningLoop.ts`, mas não há pipeline determinístico priorizando alias > histórico > regra > LLM > sem categoria, e sem `confidence`/`reason`/`source` persistidos por transação.
- `user_insights` existe mas o gating pós-lançamento não tem regras materiais explícitas (impacto na previsão, categoria estourando, etc.).

## B. Matriz Promessa da LP × Realidade

| Promessa LP | Capacidade atual | Evidência | Gap | Solução proposta |
|---|---|---|---|---|
| Registro do gasto R$80 no bar | ✅ Implementado | `create_transaction_draft` + confirmação | — | Preservar |
| Categorização como Lazer | ⚠️ Parcial | Fallback LLM inconsistente, muitos "sem categoria" | Sem pipeline híbrido determinístico | §G — Categorizador |
| Impacto na previsão do mês | ❌ Ausente | `analyze_spending` não projeta fechamento | Sem `forecast_month_close` | §F — Previsão |
| Comparação com período anterior | ⚠️ Parcial | `analyze_spending` retorna série mas não delta comparável | Sem `compare_periods` | Nova tool |
| Explicar quais categorias causaram alta | ❌ Ausente | Nenhuma decomposição causal | Sem `explain_spending_change` | Nova tool |
| Gráfico específico solicitado | ❌ Ausente | `SpendingReportCard` só faz categorias | Sem renderer genérico nem `generate_chart_artifact` | §H — Artefatos |
| Próxima ação recomendada | ⚠️ Parcial | `get_daily_insights` genérico | Sem gating de materialidade pós-lançamento | §I — Insight pós-lançamento |
| Ritmo/projeção de meta | ❌ Ausente | Só CRUD e listagem | Sem `project_goal_completion` / `simulate_goal_pace` | §I — Metas preditivas |
| Envio de gráfico no WhatsApp | ❌ Ausente | `whatsapp-send` só texto | Sem pipeline PNG + signed URL + outbound media | §H |
| Paridade app/WhatsApp | ⚠️ Parcial | Mesmas tools, adapters distintos | AppAdapter converte tudo no mesmo relatório | Reescrever AppAdapter |

## C. Arquitetura alvo — 4 camadas

```text
┌─────────────────────────────────────────────────────────┐
│ 1. MOTOR FINANCEIRO (determinístico, SQL/TS puro)       │
│    facts.ts + analytics/ (compare, forecast, attribute) │
│  → Toda métrica sai daqui, com provenance.              │
├─────────────────────────────────────────────────────────┤
│ 2. LLM (só intenção, ambiguidade, narrativa)            │
│    IntentRouter + ResponseGenerator                     │
│  → NUNCA calcula números.                               │
├─────────────────────────────────────────────────────────┤
│ 3. RENDERER (artefatos universais)                       │
│    ChartArtifact { chart, metrics, provenance, ... }    │
│  → App: React genérico. WhatsApp: PNG server-side.      │
├─────────────────────────────────────────────────────────┤
│ 4. ADAPTER DE CANAL (App/WhatsApp)                       │
│    Entrega o mesmo artefato no formato do canal.        │
└─────────────────────────────────────────────────────────┘
```

**Fluxo ponta a ponta ("R$80 no bar ontem Nubank"):**
1. Webhook/WS recebe → AgentCore.handleTurn
2. IntentRouter → intent=`log_expense`, entidades extraídas
3. Categorizador (pipeline §G) → sugere `Lazer` (source=history, confidence=0.87)
4. `create_transaction_draft` → pending confirmation
5. Usuário confirma → transação persistida com `category_confidence`, `category_source`
6. Pós-persist: `evaluateMaterialInsight()` avalia — se altera previsão em >X%, chama `forecast_month_close` e monta insight material
7. ReceiptBuilder: "Registrei R$80 em Lazer • Bar. Previsão do mês subiu de R$2.850 para R$2.930 (+2,8%). Lazer já usou 68% do teto."
8. WhatsApp: mesmo texto; se usuário pede "mostra o gráfico" → `generate_chart_artifact` → PNG signed URL → outbound_messages com `media_url` + caption.

## D. Contratos (tools, artefatos, tabelas)

### D.1 Novas tools (contratos)

Todas retornam `{ ok, result: { data, provenance } }`. Provenance é obrigatório.

```ts
Provenance = {
  period: { from: string; to: string; tz: "America/Sao_Paulo" };
  as_of: string;         // ISO
  row_count: number;
  confidence: "high"|"medium"|"low"|"insufficient_data";
  formula_version: string; // e.g. "forecast.v1"
  maturity?: { days_observed: number; days_in_month: number };
};
```

- `compare_periods({ metric, period_a, period_b, group_by? })` → `{ total_a, total_b, delta_abs, delta_pct, by_group[], comparable: bool }`
- `forecast_month_close({ month?, model?: "baseline"|"observed"|"seasonal" })` → `{ point, low, high, model_used, drivers[], backtest_summary }`
- `explain_spending_change({ period_a, period_b })` → `{ delta_total, contributions: [{name, delta_abs, pct_of_delta, direction}], residual, samples_ok }`
- `project_goal_completion({ goal_id })` → `{ current, target, remaining, required_pace_month, observed_pace_month, projected_date, days_ahead_or_late, confidence }`
- `simulate_goal_pace({ goal_id, monthly_contribution })` → `{ scenarios[] }`
- `build_financial_report({ kind, period })` → `ChartArtifact`
- `generate_chart_artifact({ chart_type, metric, period, group_by?, filters? })` → `ChartArtifact` + `media_ref` (PNG) quando canal WhatsApp
- `categorize_transactions_batch({ transaction_ids?, since? })` → aplica pipeline híbrido (não sobrescreve `user_edited_at`).

### D.2 ChartArtifact universal

```ts
type ChartArtifact = {
  kind: "chart" | "report" | "goal_projection" | "forecast";
  headline: string;
  narrative: string;      // preenchido pela LLM, sobre fatos fixos
  metrics: { label: string; value: string; hint?: string }[];
  chart: {
    type: "line"|"bar"|"stacked_bar"|"donut"|"area"|"progress"|"forecast_band";
    title: string;
    x_labels: string[];
    series: { name: string; data: number[]; color?: string }[];
    units: "BRL"|"pct"|"count";
    annotations?: { x: string; label: string }[];
  };
  actions?: { label: string; intent: string; params?: any }[];
  provenance: Provenance;
  a11y_summary: string;
  media_ref?: { storage_path: string; signed_url: string; expires_at: string };
};
```

### D.3 Migrations necessárias

1. `transactions`: adicionar `category_confidence numeric(3,2)`, `category_source text` (`user|alias|history|rule|llm|none`), `category_reason text`, `user_edited_at timestamptz`. Índice em `(user_id, occurred_at)` já existente.
2. `merchant_aliases`: garantir `canonical_name`, `normalized_pattern`, `category_id`, `confidence`, `confirmed_by_user_at`. Índice único `(user_id, normalized_pattern)`.
3. `agent_artifacts` (nova): `id`, `user_id`, `conversation_id`, `kind`, `payload jsonb` (ChartArtifact), `media_path text`, `media_expires_at`, `created_at`. RLS por `user_id` + GRANT authenticated/service_role.
4. `outbound_messages`: adicionar `artifact_id uuid null references agent_artifacts`, `media_url text`, `media_mime text`, `media_status text` (`pending|sent|failed|fallback_text`).
5. `agent_runs`: adicionar `formula_versions jsonb`, `intent_requested text`, `intent_served text`, `tools_used text[]` (se já não houver).
6. Nenhuma alteração destrutiva; todas colunas nullable com default seguro.

## E. Arquivos a criar/alterar

**Criar:**
- `supabase/functions/_shared/analytics/compare.ts`
- `supabase/functions/_shared/analytics/forecast.ts` (baseline + observed + seasonal + backtest)
- `supabase/functions/_shared/analytics/attribute.ts`
- `supabase/functions/_shared/analytics/goals.ts`
- `supabase/functions/_shared/analytics/provenance.ts` (helpers)
- `supabase/functions/_shared/categorization/pipeline.ts` (6 estágios §G)
- `supabase/functions/_shared/categorization/normalize.ts` (limpeza de descrição bancária)
- `supabase/functions/_shared/artifacts/builder.ts` (monta ChartArtifact)
- `supabase/functions/_shared/artifacts/renderPng.ts` (Deno + `npm:chart.js`+`npm:canvas` ou SVG→PNG via `resvg`)
- `supabase/functions/agent-artifact-render/index.ts` (edge: gera PNG, sobe no bucket `artifacts`, retorna signed URL)
- `src/components/assessor/artifacts/ChartArtifactRenderer.tsx` (renderer genérico com Recharts)
- `src/components/assessor/artifacts/ForecastCard.tsx`, `GoalProjectionCard.tsx`
- `src/test/analytics-compare.test.ts`, `analytics-forecast.test.ts`, `analytics-attribute.test.ts`, `categorization-pipeline.test.ts`, `artifact-contract.test.ts`, `whatsapp-media-artifact.test.ts`, `assessor-parity.test.ts`

**Alterar:**
- `supabase/functions/_shared/agent/tools.ts`: acrescentar novas tools; **não remover** existentes.
- `supabase/functions/_shared/agent/core/adapters/AppAdapter.ts`: parar de forçar SpendingReport único; delegar ao IntentRouter e retornar artefato do tipo pedido.
- `supabase/functions/_shared/agent/core/AgentCore.ts`: hook pós-persistência → `evaluateMaterialInsight`; gating de insight.
- `supabase/functions/_shared/agent/core/InsightsEngine.ts`: regras materiais (impacto>threshold, categoria acima do teto, gasto atípico, meta em risco, recorrência nova, concentração).
- `supabase/functions/_shared/agent/prompt.ts`: perfis de resposta (recibo curto, relatório rico, meta) sem quebrar confirmação; nunca calcular.
- `supabase/functions/_shared/agent/core/ResponseValidator.ts`: reforçar que todo número na resposta precisa ter vindo de tool com provenance daquela turn.
- `supabase/functions/whatsapp-send/index.ts`: aceitar `media_url` + caption; retentativa; fallback textual se mídia falhar; registrar `media_status`.
- `src/components/assessor/AssessorPanel.tsx`: substituir uso rígido de `SpendingReportCard` por `ChartArtifactRenderer`.
- `src/components/assessor/SpendingReportCard.tsx`: preservar como skin para `kind=report,chart=donut`; internamente usar `ChartArtifactRenderer`.

## F. Fórmulas, previsão e backtesting

Modelos (registrados como `formula_version`):

- **baseline.v1**: `forecast = (mtd_expense / day_of_month) * days_in_month` — sempre calculável, confiança `low` se `day_of_month<7`.
- **observed.v1**: `forecast = mtd + Σ compromissos_recorrentes_restantes + tendência_diária_ponderada(últimos 14 dias com decay)`.
- **seasonal.v1**: só se `history_months>=6`; `forecast = observed + ajuste_sazonal(mes_do_ano)` com winsorização.

Regras:
- Descartar dias com |z|>3 na base do dia (winsorize, não excluir).
- Compromissos futuros vêm de `recurring_rules`/`recurring_occurrences` + faturas de cartão previstas.
- Intervalo: bootstrap simples sobre variância diária dos últimos 90 dias; se `n<30`, exibir apenas ponto sem intervalo.
- Confidence: `high` se `days_observed>=15` e `mape_backtest<=15%`; `medium` se `>=7` e `<=25%`; senão `low`; `insufficient_data` se `<3` dias com movimento.

**Backtest walk-forward:**
- Para cada mês passado, corte no dia D=5,10,15,20,25 → prevê fechamento → compara com realizado.
- Métricas por modelo: MAE (R$), WAPE = `Σ|erro| / Σ|real|` (protege denominador pequeno), viés = `mean(erro)`, cobertura = `%` de meses em que `real ∈ [low,high]`.
- Persistir em `agent_runs.formula_versions` e em uma view materializada `forecast_backtest_summary` (opcional S).

**Cenários simulados (a validar em testes com fixtures):**
- A. 5 lançamentos → `baseline.v1`, confidence `insufficient_data`, mensagem "ainda estou aprendendo seu ritmo".
- B. 3 meses + recorrências → `observed.v1` + recorrentes, confidence `medium`.
- C. 12 meses + sazonalidade → `seasonal.v1`, confidence `high`.
- D. Gasto extraordinário → winsorização, badge "atípico" no drill.
- E. Transferência/aplicação/resgate → `movement_kind` filtra; forecast inalterado.
- F. Importação parcial/inconsistente → `insufficient_data`, orientar reconciliação.

## G. Categorização — pipeline híbrido

Ordem (curto-circuita na primeira decisão com confidence≥threshold):

1. **Explícito do usuário** (`source=user`, conf=1.0) — sempre vence, seta `user_edited_at`.
2. **Alias pessoal confirmado** (`merchant_aliases.confirmed_by_user_at IS NOT NULL`) → `source=alias`, conf=0.98.
3. **Histórico do próprio usuário** — nos últimos 180 dias, se ≥3 transações com mesmo `merchant_canonical` foram categoria X e ≥80% concordam → `source=history`, conf=0.85–0.95.
4. **Regra determinística** (dicionário curado: Uber/99→Transporte, iFood/Rappi→Alimentação, Drogaria/Farmácia→Saúde, supermercado tokens→Mercado) → `source=rule`, conf=0.75.
5. **LLM em lote** (só quando 1–4 falham) — batelada de até 40 descrições por chamada, prompt com categorias do usuário; retorna categoria + confidence. Aceita se conf≥0.7 → `source=llm`.
6. **Sem categoria** → `source=none`, sinaliza para revisão.

Thresholds:
- Autoaplicar: conf≥0.85.
- Sugerir (transação sem categoria com badge "sugerido"): 0.6–0.85.
- Não adivinhar: <0.6.

Normalização (`normalize.ts`):
- Lowercase, NFD sem diacríticos, remover tokens `PAY/PIX/TED/DOC/COMPRA/DEBITO/CREDITO`, adquirentes (`REDECARD/STONE/CIELO/PAG*`), IDs numéricos, datas.
- Extrai `merchant_canonical` (2–3 tokens estáveis).

Aprendizado:
- Ao editar/confirmar, upsert em `merchant_aliases` com `confirmed_by_user_at=now()`.
- Nunca sobrescrever `user_edited_at IS NOT NULL`.
- Recategorização em lote: RPC opt-in (`recategorize_uncategorized(since)`), nunca automática em toda a base.

Conflitos:
- Se histórico dividido (~50/50 entre duas categorias) → cair para regra/LLM; se persistir, ficar "sem categoria" e sugerir revisão.

Métricas:
- `coverage_pct`, `precision_sampled` (amostra revisada pelo usuário), `correction_rate`, `avg_confidence` calibrada (buckets de 0.1).

Casos de teste: Uber→Transporte, "BAR DO ZE"→Lazer (após 3 confirmações), Drogaria SP→Saúde, "SUPERMERC PAO"→Mercado, "TRANSF NUBANK"→ignorar (transferência), descrição vazia→sem categoria.

## H. Gráficos e relatórios — app e WhatsApp

**App:** `ChartArtifactRenderer` roteia por `chart.type` para componentes Recharts (line/bar/stacked/donut/area/progress/forecast_band). Estados: empty, insufficient_data, loading, error. Botões de ação vindos de `artifact.actions`.

**WhatsApp:**
- `agent-artifact-render` (edge): recebe `artifact`, monta SVG com Chart.js headless ou `resvg`+template SVG, converte para PNG (600×360, 96dpi), sobe em bucket `artifacts` com path `/{user_id}/{artifact_id}.png`, gera signed URL (TTL 24h).
- `whatsapp-send` envia `media_url` + `caption` (headline + top-3 metrics + provenance curta).
- `outbound_messages.media_status`: `pending→sent|failed`; em falha, envia fallback texto com os mesmos números e marca `fallback_text`.
- Idempotência por `artifact_id` + `to_phone`.

Intent parser preserva: `chart_type`, `metric`, `period`, `group_by`, `filters`. Se ambíguo, pergunta.

## I. Insight pós-lançamento e metas preditivas

**Gating material (InsightsEngine):** dispara ≤1 insight quando:
- previsão mensal muda ≥3% ou R$150,
- categoria passa 90% do teto (`category_spending_goals`),
- gasto |z|>2 no histórico da categoria,
- nova recorrência detectada (mesmo merchant, 3 meses seguidos, ±10%),
- concentração (top merchant no mês ≥25% do gasto),
- meta com projeção atrasada.
Cooldown por tipo (24h); dedup por hash de conteúdo.

**Metas (`analytics/goals.ts`):**
- `required_pace = remaining / meses_até_target_date`.
- `observed_pace = média_móvel_3m(contribuições)`.
- `projected_date = today + remaining / observed_pace` (guarda contra 0).
- `days_ahead_or_late = projected_date - target_date`.
- Sem prazo → devolve só `required_pace` para 3/6/12m.
- Aportes irregulares → confidence `medium`; <3 aportes → `insufficient_data`.
- `simulate_goal_pace`: n cenários com aportes distintos, sem juros (projeto não é investimento).

## J. Prompt, paridade e canal

- Ambos adapters chamam AgentCore; só `channel` muda.
- Prompt reorganizado em blocos: (i) confirmação de mutação (curta), (ii) recibo pós-persist (1 linha + até 1 insight material), (iii) relatório rico (só quando intent=`report/chart/forecast/goal_projection`), (iv) ambiguidade (perguntar). Nenhuma resposta pode conter número não presente em ferramentas invocadas na turn (validado por `ResponseValidator`).
- Capability negotiation: WhatsApp anuncia `supports_media=true`; se falso, artefato vira texto+tabela ASCII simplificada.

## K. Observabilidade, custo e performance

Eventos em `agent_runs`/`decision_logs`: intent_requested vs served, tools, `formula_version`, latência por etapa, tokens in/out, artifact_id, categoria (source/confidence), material_insight_shown, reconciliation_error.

Controle de custo:
- Toda matemática em SQL/TS — LLM só para intenção e narrativa.
- Categorização LLM sempre em lote (≤40 itens/chamada), com cache por `merchant_canonical`.
- Cache de artefatos por `(user_id, kind, period_hash)` 5min.
- Idempotência por `inbound_message_id`.

## L. Plano de testes

- Unit: fórmulas (compare, forecast baseline/observed/seasonal, attribute, goal_projection), normalize, pipeline.
- Fixtures contábeis (reusar `financial_ecosystem_v2.json`): invariantes — transferência não altera receita/despesa; aplicação reduz caixa e sobe investimento; pagamento de fatura não duplica despesa; exclusão zera efeitos.
- Golden test: "R$80 bar Nubank ontem" → categoria=Lazer, previsão sobe X%, top-3 causal contém Lazer, artefato de linha diária disponível.
- Backtest: MAE/WAPE por modelo em 12 meses sintéticos + threshold de aceite.
- Categorização calibrada: 50 amostras sintéticas por cenário, `precision_sampled≥0.85` no threshold auto.
- Parity: mesma pergunta App×WhatsApp retorna mesmos `metrics` e mesma `provenance.formula_version`.
- WhatsApp media: envio PNG + fallback texto quando mock falha.
- Metas: cenários com/sem prazo, aportes irregulares, estorno.
- Timezone SP; RLS/isolamento; mobile 320–1440; regressão nas mutações existentes (FastLog, edit/delete, transferência).

## M. Critérios de aceite

- Nenhum número exibido sem provenance rastreável.
- Gráfico pedido = gráfico entregue (ou pergunta de esclarecimento).
- Paridade app/WhatsApp bit-a-bit nos números.
- Transferência/investimento/fatura não distorcem fluxo (validado por invariantes).
- Categoria automática só ≥0.85; edição manual permanente.
- LP promete apenas o que os testes cobrem.

## N. Riscos, dependências e rollback

- **Risco:** custo LLM em categorização em massa. **Mitigação:** batelada + cache + curto-circuito nas etapas 1–4.
- **Risco:** PNG server-side no Deno pesado. **Mitigação:** SVG→PNG com `resvg` (WASM), 600×360; se falhar, fallback texto.
- **Risco:** previsão parecer "certa demais". **Mitigação:** confidence sempre visível + copy prudente.
- **Risco:** regressão no fluxo de mutação. **Mitigação:** testes existentes preservados; nenhuma tool antiga removida.
- **Rollback:** todas migrations aditivas; novas tools coexistem com antigas; feature flags `agent.forecast_enabled`, `agent.charts_enabled`, `agent.categorizer_v2` em `agent_settings` para desligar por canal.

## O. Ordem de implementação (rodada única posterior)

Caminho crítico em sequência linear, tudo numa PR única:

1. Migrations aditivas (transactions cols, merchant_aliases, agent_artifacts, outbound_messages, agent_runs). **[S]**
2. `analytics/provenance.ts` + `compare.ts` + `attribute.ts` + testes. **[M]**
3. `analytics/forecast.ts` + backtest + testes. **[L]**
4. `analytics/goals.ts` + testes. **[M]**
5. `categorization/normalize.ts` + `pipeline.ts` + LearningLoop updates + testes. **[L]**
6. `artifacts/builder.ts` + `ChartArtifactRenderer` (App) + refactor `AssessorPanel`. **[M]**
7. `artifacts/renderPng.ts` + `agent-artifact-render` edge + bucket `artifacts`. **[M]**
8. `whatsapp-send` — media + fallback + retentativa. **[S]**
9. Novas tools em `agent/tools.ts` + wiring no AgentCore/AppAdapter/WhatsAppAdapter. **[M]**
10. `InsightsEngine` regras materiais + hook pós-persist. **[M]**
11. Prompt v2 (perfis) + ResponseValidator reforço. **[S]**
12. Testes de paridade + golden + backtest + smoke visual. **[M]**
13. Feature flags e defaults por canal. **[S]**

Estimativa total: ~**XL** (uma rodada consolidada).

## P. O que NÃO deve ser alterado

- `_shared/engine/facts.ts` (regras contábeis v3 já consolidadas).
- `src/lib/engine/facts.ts` (paridade cliente).
- Fluxo de confirmação de mutação (`PendingConfirmations`, drafts).
- FastLog (`!ja`) e regex de bloqueio de rascunho hallucinado.
- Categorias globais (somente clone-on-edit já implementado).
- Landing Page, rebranding, admin UI.
- `outbound_messages` fluxo texto atual (só extensão aditiva).
- RLS/GRANT existentes.

---

**Aguardo aprovação explícita deste plano antes de qualquer alteração de código, migration, deploy ou dado.**
