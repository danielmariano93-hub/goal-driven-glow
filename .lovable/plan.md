# Painel de FinOps/Observabilidade da IA — plano consolidado

## 1. Diagnóstico atual (constatado read-only)

- `agent_runs` já registra `tokens_in`, `tokens_out`, `cost_cents`, `model`, `path/source`, `latency_ms`, `steps`, `status`, `error_sanitized`, `started_at/finished_at`, `prompt_version_id`, `conversation_id`, `user_id`. **Não** há: `input_tokens_cached`, `reasoning_tokens`, `provider`, `capability/intent`, `retry_of`, `finish_reason`, `unit_price_input_snapshot`, `unit_price_output_snapshot`.
- `cost_cents` **nunca é preenchido** hoje. Em `orchestrator.ts` e `agent-chat/index.ts` só são gravados `tokens_in/tokens_out`. O KPI "Custo USD 7d" na `VisaoGeral` é sempre 0.
- `llm.ts` lê `usage.prompt_tokens` / `usage.completion_tokens` do gateway; ignora `usage.completion_tokens_details.reasoning_tokens`, `usage.prompt_tokens_details.cached_tokens` e headers de créditos que o Lovable Gateway retorna.
- `agent_tool_calls` guarda step-a-step (duração, ok, args, result), sem tokens por step — suficiente para tool-call rate e loops.
- Não há tabela de preços; nenhum snapshot de preço em `agent_runs`.
- Não existe distinção entre **Build Credits (editor)**, **Cloud Credits (Supabase)** e **AI Gateway usage do app**. O painel só terá visão do último — o resto deve ser explicitamente rotulado como "não coberto".
- Não existem budgets, alertas, projeções, nem fast-path metrics. Não há retry/idempotency flag em `agent_runs`.
- Admin usa `is_current_user_admin()`; RLS de `agent_runs` já bloqueia usuário comum. Nenhuma PII financeira é exibida hoje no simulador — manter esse padrão.

## 2. Arquitetura proposta

```text
Edge Function (agent-chat / agent-run / orchestrator)
  │  captura usage detalhado do gateway
  ▼
agent_runs (+ colunas novas)           ai_model_prices (tabela versionada)
  │                                      │
  ├─ trigger BEFORE INSERT/UPDATE ───────┤ resolve preço vigente por (provider,model,started_at)
  │  grava snapshot de preços e         │
  │  calcula cost_usd_micros            │
  ▼
Views materializadas leves + RPCs agregados (SECURITY DEFINER, admin only)
  │
  ▼
Admin → /admin/ia (nova página) usa RPCs: kpis, séries diárias, top runs,
        breakdown por modelo/source/capability, projeção, alertas.

ai_budgets + ai_alerts → job diário (novo) avalia thresholds e grava alerts;
UI mostra banner e histórico. Nenhuma ação automática de bloqueio nesta rodada.
```

## 3. Migration mínima (única)

```sql
-- 3.1 agent_runs: colunas novas (nullable, backfill 0/NULL)
ALTER TABLE public.agent_runs
  ADD COLUMN provider text,
  ADD COLUMN capability text,
  ADD COLUMN finish_reason text,
  ADD COLUMN cached_input_tokens int NOT NULL DEFAULT 0,
  ADD COLUMN reasoning_tokens int NOT NULL DEFAULT 0,
  ADD COLUMN retry_of uuid REFERENCES public.agent_runs(id),
  ADD COLUMN unit_price_input_micros bigint,   -- USD * 1e6 por 1M tokens
  ADD COLUMN unit_price_output_micros bigint,
  ADD COLUMN unit_price_cached_micros bigint,
  ADD COLUMN unit_price_reasoning_micros bigint,
  ADD COLUMN cost_usd_micros bigint NOT NULL DEFAULT 0,  -- fonte da verdade
  ADD COLUMN cost_estimated boolean NOT NULL DEFAULT true;
CREATE INDEX idx_agent_runs_started_at ON public.agent_runs(started_at);
CREATE INDEX idx_agent_runs_model_started ON public.agent_runs(model, started_at);
CREATE INDEX idx_agent_runs_source_started ON public.agent_runs(source, started_at);

-- 3.2 tabela de preços versionada
CREATE TABLE public.ai_model_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model text NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  input_micros_per_mtok bigint NOT NULL,
  output_micros_per_mtok bigint NOT NULL,
  cached_micros_per_mtok bigint,
  reasoning_micros_per_mtok bigint,
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  source text NOT NULL,       -- 'lovable-docs', 'manual', etc
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ai_prices_lookup ON public.ai_model_prices(model, effective_from DESC);
ALTER TABLE public.ai_model_prices ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.ai_model_prices TO authenticated;
GRANT ALL ON public.ai_model_prices TO service_role;
CREATE POLICY "ai_prices admin read" ON public.ai_model_prices
  FOR SELECT TO authenticated USING (public.is_current_user_admin());

-- Seed inicial (valores públicos anotados como estimativa; source='manual-seed')
INSERT INTO public.ai_model_prices(provider,model,input_micros_per_mtok,output_micros_per_mtok,cached_micros_per_mtok,reasoning_micros_per_mtok,effective_from,source) VALUES
  ('google','google/gemini-3.5-flash',   …, …, …, …, now(), 'manual-seed'),
  ('google','google/gemini-2.5-flash',   …, …, …, …, now(), 'manual-seed'),
  ('google','google/gemini-2.5-pro',     …, …, …, …, now(), 'manual-seed'),
  ('openai','openai/gpt-5.4-mini',       …, …, …, …, now(), 'manual-seed'),
  ('openai','openai/gpt-5.5',            …, …, …, …, now(), 'manual-seed');
-- valores exatos preenchidos na rodada de execução a partir dos docs vigentes.

-- 3.3 função de cálculo + trigger que fixa snapshot
CREATE OR REPLACE FUNCTION public.agent_runs_price_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p record;
BEGIN
  IF NEW.model IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO p FROM public.ai_model_prices
    WHERE model = NEW.model
      AND effective_from <= COALESCE(NEW.started_at, now())
      AND (effective_to IS NULL OR effective_to > COALESCE(NEW.started_at, now()))
    ORDER BY effective_from DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  NEW.unit_price_input_micros    := p.input_micros_per_mtok;
  NEW.unit_price_output_micros   := p.output_micros_per_mtok;
  NEW.unit_price_cached_micros   := p.cached_micros_per_mtok;
  NEW.unit_price_reasoning_micros:= p.reasoning_micros_per_mtok;
  NEW.cost_usd_micros := (
      COALESCE(NEW.tokens_in,0)          * p.input_micros_per_mtok +
      COALESCE(NEW.tokens_out,0)         * p.output_micros_per_mtok +
      COALESCE(NEW.cached_input_tokens,0)* COALESCE(p.cached_micros_per_mtok,p.input_micros_per_mtok) +
      COALESCE(NEW.reasoning_tokens,0)   * COALESCE(p.reasoning_micros_per_mtok,p.output_micros_per_mtok)
    ) / 1000000;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_agent_runs_price BEFORE INSERT OR UPDATE OF tokens_in,tokens_out,cached_input_tokens,reasoning_tokens,model
  ON public.agent_runs FOR EACH ROW EXECUTE FUNCTION public.agent_runs_price_snapshot();

-- 3.4 budgets + alerts
CREATE TABLE public.ai_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,          -- 'global' | 'model' | 'source'
  scope_value text,
  period text NOT NULL,         -- 'daily' | 'monthly'
  limit_usd_micros bigint NOT NULL,
  warn_pct int[] NOT NULL DEFAULT '{50,75,90,100}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ai_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id uuid REFERENCES public.ai_budgets(id) ON DELETE CASCADE,
  kind text NOT NULL,           -- 'budget_threshold' | 'anomaly_spike' | 'loop' | 'retry_storm'
  severity text NOT NULL,       -- 'info'|'warn'|'critical'
  message text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  observed_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);
ALTER TABLE public.ai_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_alerts  ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ai_budgets TO authenticated;
GRANT SELECT,UPDATE ON public.ai_alerts TO authenticated;
GRANT ALL ON public.ai_budgets,public.ai_alerts TO service_role;
CREATE POLICY "budgets admin" ON public.ai_budgets FOR ALL TO authenticated USING (public.is_current_user_admin()) WITH CHECK (public.is_current_user_admin());
CREATE POLICY "alerts admin"  ON public.ai_alerts  FOR ALL TO authenticated USING (public.is_current_user_admin()) WITH CHECK (public.is_current_user_admin());

-- 3.5 RPCs agregadas (SECURITY DEFINER, checam is_current_user_admin)
--   admin_ai_kpis(from,to,filters jsonb) → jsonb
--   admin_ai_timeseries(from,to,granularity,filters) → jsonb
--   admin_ai_breakdown(dim,from,to,filters) → jsonb   dim ∈ model|source|capability|prompt_version|user
--   admin_ai_top_runs(from,to,limit,order_by) → jsonb  (sem conteúdo bruto)
--   admin_ai_run_detail(run_id) → jsonb  (tokens/steps/tools/erros; sem body de mensagens)
--   admin_ai_projection(from,to,horizon) → jsonb  (média móvel 7d, IC)
--   admin_ai_budgets_status() → jsonb
```

Todas RPCs `REVOKE ALL FROM public` e `GRANT EXECUTE TO authenticated`, gate por `is_current_user_admin()` no topo.

## 4. Captura de telemetria (Edge Functions)

Arquivos tocados: `supabase/functions/_shared/agent/llm.ts`, `_shared/agent/orchestrator.ts`, `agent-chat/index.ts`, `agent-run/index.ts`.

- `llm.ts` `LLMTurn` passa a expor: `tokensIn, tokensOut, cachedInputTokens, reasoningTokens, finishReason, provider, model` — lidos de `usage.prompt_tokens`, `usage.completion_tokens`, `usage.prompt_tokens_details.cached_tokens`, `usage.completion_tokens_details.reasoning_tokens`, `choice.finish_reason`. Somar por step.
- Marcar `cost_estimated=true` sempre; se o gateway retornar header/campo de créditos consumidos (a confirmar na execução via `websearch` nos docs Lovable AI Gateway), gravar em `metadata->>gateway_credits` e virar `cost_estimated=false` quando o custo final vier direto do gateway.
- Orchestrator grava as novas colunas em `agent_runs` (o trigger calcula `cost_usd_micros`).
- Adicionar `capability` derivada da intent detectada (`spending_entry`, `query`, `edit`, `delete`, `smalltalk`, `fast_path`); `provider` inferido do prefixo do model.
- Fast-path (sem LLM): gravar run com `model=NULL`, `capability='fast_path'`, `tokens_in=tokens_out=0`, `cost_usd_micros=0` para permitir métrica de economia.
- Retries/idempotência: quando o orquestrador refizer uma chamada por erro transitório, preencher `retry_of` com o run anterior.

Nenhuma alteração em `whatsapp-webhook`, WAHA, sessão.

## 5. Página admin `/admin/ia`

Arquivos:
- `src/pages/admin/IA.tsx` (nova, entry-point).
- `src/components/admin/ia/KpiGrid.tsx`, `TimeseriesChart.tsx`, `BreakdownBar.tsx`, `TopRunsTable.tsx`, `RunDetailSheet.tsx`, `ProjectionCard.tsx`, `BudgetsPanel.tsx`, `AlertsList.tsx`, `Filters.tsx`, `ExplainerTokens.tsx`.
- `src/hooks/useAdminAiKpis.ts`, `useAdminAiTimeseries.ts`, `useAdminAiBreakdown.ts`, `useAdminAiTopRuns.ts`, `useAdminAiProjection.ts`, `useAdminAiBudgets.ts`.
- `src/lib/admin/ai/format.ts` (formatadores BRL/USD/tokens/percentuais, taxa configurável via `platform_public_config`).
- Registrar rota em `src/App.tsx` sob `PlatformAdminRoute`. Adicionar item no menu do admin.

KPIs, filtros, visualizações e drill-down conforme requisitos §4 do pedido. Recharts (já no projeto) para gráficos. Toda ação em mobile-first, cards Itaú-like existentes.

Drill-down (RunDetailSheet):
- Mostra `run_id`, timestamps, model, provider, source, capability, prompt_version, steps, tokens (in/out/cached/reasoning), custo estimado, finish_reason, `retry_of`, `latency_ms`, lista de tool calls (name, ok, duration, redacted args/result — só chaves de alto nível), erro sanitizado.
- Nunca renderiza `payload` de `conversation_messages`, transações do usuário, nem PII financeira.

Explainer visível: tooltip "O que é token?" e nota fixa distinguindo:
- **Build Credits** (uso do editor Lovable — visível apenas em lovable.dev, não aqui).
- **Cloud Credits** (Supabase — não coberto aqui).
- **AI Gateway usage** (métrica desta página; estimativa até o gateway expor custo final).

## 6. Projeções

`admin_ai_projection`:
- Média móvel dos últimos N=7 dias de custo/tokens; extrapola até fim do mês.
- Cenários "e se": 100/1k/10k usuários ativos × mensagens/dia editável no cliente (cálculo puro no front usando médias por usuário retornadas pela RPC).
- Retorna `sample_size` e um `confidence` categórico (`low` quando `sample_size<50 runs` ou `<3 dias`).

## 7. Budgets & alertas

- Job diário novo: `supabase/functions/ai-budget-evaluator/index.ts` (cron via Supabase scheduled functions; se cron não estiver disponível no ambiente, chamar do `whatsapp-ack-watchdog` schedule já existente — a confirmar; não altera WAHA).
- Avalia budgets ativos, agregando `cost_usd_micros` por período/scope; grava linhas em `ai_alerts` quando thresholds cruzam.
- Detector de anomalia: z-score simples do custo diário vs 14d; loop = run com `steps >= max_steps` e sem `stop`; retry storm = >3 runs com mesmo `retry_of` chain.
- UI: banner no topo de `/admin/ia` com alertas não-reconhecidos; botão "Reconhecer". Nenhum bloqueio de usuário nesta rodada.

## 8. Otimizações de consumo (implementadas nesta rodada)

Todas com métricas antes/depois via novas colunas:
- Trocar janela de histórico em `llm.ts`/orchestrator de "últimas 20 mensagens" para "até X tokens" (padrão 2.500), usando estimador `chars/4` — configurável em `agent_settings`.
- Selecionar apenas tools da intent atual (mapa capability→tools em `_shared/agent/tools.ts`).
- `max_tokens` de saída configurável (default 512).
- Step budget continua 6–8.
- Loop guard: se detectar mesma tool com mesmos args duas vezes seguidas, cortar e responder pedindo confirmação.
- Fast-path: agradecimentos, "ok", "obrigado", listagens simples → resposta determinística sem LLM; grava run como capability=`fast_path`.
- Configurações vivem em `agent_settings` (já existe) ou em `platform_public_config`; nenhuma nova secret.

## 9. Privacidade / segurança

- Todas as RPCs e budgets/alerts gated por `is_current_user_admin()`.
- Nenhuma coluna nova armazena conteúdo bruto; `agent_tool_calls.args/result` continua com a política de sanitização atual (já limitada). Adicionar checagem: RPC `admin_ai_run_detail` retorna apenas nomes de tools + `ok/duration`, nunca `args`/`result` completos.
- Taxa USD→BRL configurável em `platform_public_config` (`fx_usd_brl`, default 5.0) — sempre rotulada como estimativa.
- Nenhum service role no frontend. `LOVABLE_API_KEY` permanece somente em Edge Functions.

## 10. Testes bloqueadores (Vitest + supabase-js com JWT fixture admin/user)

Arquivos em `src/test/`:
- `ai-pricing.test.ts`: trigger fixa snapshot; alterar preço não muda run antigo; cálculo por modelo com cached/reasoning.
- `ai-usage-capture.test.ts`: mock do gateway retorna usage completo → colunas preenchidas; sem usage → `cost_estimated=true` e `cost_usd_micros=0`.
- `ai-aggregations.test.ts`: KPIs, timeseries e breakdown por período/source/model/capability em fixture pequena.
- `ai-projection.test.ts`: amostra pequena → `confidence='low'`; média móvel bate com cálculo manual.
- `ai-budgets.test.ts`: thresholds 50/75/90/100 disparam alerts uma vez; reconhecimento persiste.
- `ai-anomaly.test.ts`: pico sintético dispara `anomaly_spike`; loop e retry_storm detectados.
- `ai-fastpath.test.ts`: entrada "obrigado" não chama LLM, grava run com custo 0.
- `ai-rls.test.ts`: usuário comum recebe erro em todas as RPCs; admin recebe dados; drill-down não contém args/result nem PII financeira.
- `ai-format.test.ts`: BRL/USD/tokens/percentuais, timezone `America/Sao_Paulo`.

`bunx vitest run` bloqueia merge. `tsgo` sem erros. `bun run build` sem erros.

## 11. Sequência única de implementação

1. Migration §3 (colunas, tabelas, trigger, RPCs, grants, seed de preços com valores conferidos nos docs Lovable AI vigentes no momento da execução).
2. `llm.ts` + orchestrator + agent-chat + agent-run: capturar usage completo, capability, retry_of, fast-path.
3. Config de otimização (janela por tokens, seleção de tools por intent, max_tokens, loop guard).
4. Página `/admin/ia` + componentes + hooks + rota + item de menu.
5. Job `ai-budget-evaluator` + UI de budgets/alerts.
6. Suíte de testes; `tsgo`; `bun run build`.
7. Deploy apenas das Edge Functions afetadas (`agent-chat`, `agent-run`, `ai-budget-evaluator`). **Não** publicar frontend. **Não** tocar em WAHA/webhook/sessão.

## 12. Critérios de aceite

- Toda run nova grava input/output/cached/reasoning tokens, `provider`, `capability`, `finish_reason`, `cost_usd_micros` > 0 quando há tokens e preço; `cost_estimated=true` até o gateway expor custo final.
- Mudar preço em `ai_model_prices` não altera custo de runs antigas.
- `/admin/ia` exibe KPIs, séries diárias, breakdown por model/source/capability, top runs, projeção com faixa de confiança e explainer de tokens/créditos.
- Budgets criáveis; alertas aparecem quando thresholds/anomalias/loops disparam; podem ser reconhecidos.
- Usuário comum não acessa `/admin/ia` nem RPCs (RLS + rota protegida).
- Drill-down nunca mostra conteúdo financeiro bruto do usuário.
- Fast-path reduz runs LLM em ≥1 caso mensurável no teste; métrica visível no painel.
- Suíte, `tsgo` e `bun run build` verdes.
- Migrations aplicadas, edge functions afetadas implantadas, frontend **não** publicado.

## 13. Riscos e gaps

- **Preços exatos** por modelo dependem dos docs Lovable AI no momento da execução; seed pode ficar desatualizado — mitigado por `ai_model_prices` versionada e badge "estimativa".
- **Cobrança final do gateway**: se o Lovable AI Gateway não expor custo/creditos por request, permanece `cost_estimated=true` e mostramos apenas estimativa; a confirmar via `websearch` na rodada de execução.
- **Cron de budget evaluator**: se Supabase scheduled functions não estiver habilitado, cair para execução ao carregar `/admin/ia` (recalcula on-demand com cache curto) — sem bloquear a entrega.
- **Backfill de custo histórico**: runs antigas terão `cost_usd_micros=0`. Uma migration extra opcional pode rodar `UPDATE ... SET tokens_in=tokens_in` para disparar o trigger — incluída na rodada única, com log de linhas atualizadas.
- **Reasoning tokens em modelos GPT-5.6** com `reasoning_effort=none` devem vir 0; teste garante isso.
- Nenhum e-mail/WhatsApp de alerta nesta rodada (opcional, fora de escopo para preservar §"não alterar WAHA").

## 14. Fora de escopo

WAHA, webhook, sessão, Meta Cloud, importação, split, gamificação, edição de transferências, novos módulos de relatório do usuário final, publicação do frontend, bloqueio automático de usuário por budget, integração com faturamento Lovable (Build/Cloud credits).
