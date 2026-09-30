// Central chart fallback shared by App and WhatsApp.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { analyze_spending, generate_chart_artifact } from "../agent/tools.ts";
import { inferChartRequest, isContextualChartFollowup } from "./chartIntent.ts";
import { WEEKDAY_TRUTH_FORMULA_VERSION } from "../analytics/weekdayTruth.ts";
import { completeChartContract, SERIES_CHART_TEMPLATES, seriesChartFromEvidence, seriesEvidenceGrain, seriesEvidenceHasData } from "./chartTemplates.ts";
import type { SeriesGrain } from "../agent/core/SeriesGrain.ts";

type ToolCallLike = {
  step_index: number;
  tool_name: string;
  args: unknown;
  result: unknown;
  ok: boolean;
  duration_ms: number;
  error: string | null;
  run_id?: string | null;
};

export type ArtifactFallbackResult = {
  toolCall: ToolCallLike;
  artifact_id: string | null;
  message: string;
};

function hasArtifact(toolCalls: ToolCallLike[]): boolean {
  return toolCalls.some((call) =>
    call.ok && (
      call.tool_name === "generate_chart_artifact"
      || call.tool_name === "generate_report_from_template"
      || Boolean((call.result as any)?.artifact_id)
    )
  );
}

function isArtifactCall(call: ToolCallLike | null | undefined): boolean {
  const tool = String(call?.tool_name ?? "");
  return tool.startsWith("generate_") && tool.includes("artifact");
}

/** Evidência de série executada (mês, dia, semana, trimestre) com dados. */
function isSeriesEvidenceCall(call: ToolCallLike | null | undefined): boolean {
  return Boolean(call?.ok) && seriesEvidenceGrain(call?.result) !== null;
}

/**
 * O turno executou uma leitura com recorte (categoria/estabelecimento)? Então
 * um gráfico genérico de "todos os gastos" responderia OUTRA pergunta.
 */
function executedScopedRead(toolCalls: ToolCallLike[]): boolean {
  return toolCalls.some((call) => {
    if (!call.ok || isArtifactCall(call)) return false;
    const args = (call.args ?? {}) as any;
    const result = (call.result ?? {}) as any;
    return Boolean(
      args.merchant || args.category_name || args.category
      || result?.scope?.merchant || result?.scope?.category
      || result?.filters?.category || result?.filters?.merchant || result?.merchant,
    );
  });
}

/**
 * Load monthly evidence only from the latest previous run that actually
 * produced analytical evidence. We deliberately do not search arbitrarily
 * backwards: if the user changed financial subject, "mostre isso em gráfico"
 * must not resurrect an older monthly series from another topic.
 */
async function loadRecentSeriesEvidence(
  sb: SupabaseClient,
  userId: string,
  conversationId: string,
): Promise<ToolCallLike | null> {
  const { data: runs, error: runError } = await sb.from("agent_runs")
    .select("id,started_at")
    .eq("user_id", userId)
    .eq("conversation_id", conversationId)
    .order("started_at", { ascending: false })
    .limit(12);
  if (runError || !(runs?.length)) return null;
  const runIds = (runs as any[]).map((run) => String(run.id ?? "")).filter(Boolean);
  if (!runIds.length) return null;

  const { data: calls, error: callError } = await sb.from("agent_tool_calls")
    .select("run_id,step_index,tool_name,args,result,ok,duration_ms,error")
    .in("run_id", runIds)
    .eq("ok", true);
  if (callError || !(calls?.length)) return null;

  const byRun = new Map<string, ToolCallLike[]>();
  for (const raw of calls as any[]) {
    const runId = String(raw.run_id ?? "");
    if (!runId) continue;
    const call: ToolCallLike = {
      run_id: runId,
      step_index: Number(raw.step_index ?? 0),
      tool_name: String(raw.tool_name ?? ""),
      args: raw.args ?? {},
      result: raw.result ?? null,
      ok: raw.ok === true,
      duration_ms: Number(raw.duration_ms ?? 0),
      error: raw.error ? String(raw.error) : null,
    };
    const list = byRun.get(runId) ?? [];
    list.push(call);
    byRun.set(runId, list);
  }

  for (const runId of runIds) {
    const analytical = (byRun.get(runId) ?? [])
      .filter((call) => call.ok && !isArtifactCall(call))
      .sort((a, b) => Number(b.step_index ?? 0) - Number(a.step_index ?? 0));
    // Current contextual chart turn normally has no analytical call. Social
    // turns also have none, so they do not sever the evidence chain.
    if (!analytical.length) continue;
    // The first evidence-producing run is authoritative. If it is not the
    // monthly series, stop here instead of walking back into stale context.
    return analytical.find((call) => isSeriesEvidenceCall(call)) ?? null;
  }
  return null;
}

async function persistArtifact(
  sb: SupabaseClient,
  args: {
    user_id: string;
    conversation_id: string;
    kind: string;
    title: string;
    summary_text: string;
    fallback_text: string;
    series: Array<{ name: string; value: number }>;
    formula_version: string;
    confidence?: string;
    row_count?: number;
  },
): Promise<string | null> {
  const payload = {
    kind: args.kind,
    title: args.title,
    summary_text: args.summary_text,
    fallback_text: args.fallback_text,
    data: { series: args.series },
    provenance: {
      formula_version: args.formula_version,
      confidence: args.confidence ?? "medium",
      row_count: args.row_count ?? args.series.length,
    },
  };
  const { data, error } = await sb.from("agent_artifacts").insert({
    user_id: args.user_id,
    conversation_id: args.conversation_id,
    kind: args.kind,
    payload,
    summary_text: args.summary_text,
    fallback_text: args.fallback_text,
    formula_version: args.formula_version,
  }).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as any)?.id ?? null;
}

async function persistRichArtifact(
  sb: SupabaseClient,
  args: {
    user_id: string;
    conversation_id: string;
    payload: any;
  },
): Promise<string | null> {
  const payload = completeChartContract(args.payload ?? {});
  const formulaVersion = String(payload?.provenance?.formula_version ?? "artifact.v2");
  const summaryText = String(payload?.summary_text ?? payload?.fallback_text ?? "");
  const fallbackText = String(payload?.fallback_text ?? summaryText);
  const { data, error } = await sb.from("agent_artifacts").insert({
    user_id: args.user_id,
    conversation_id: args.conversation_id,
    kind: String(payload?.kind ?? "chart"),
    payload,
    summary_text: summaryText,
    fallback_text: fallbackText,
    formula_version: formulaVersion,
  }).select("id").maybeSingle();
  if (error) throw new Error(error.message);
  return (data as any)?.id ?? null;
}

export async function ensureRequestedArtifact(args: {
  sb: SupabaseClient;
  user_id: string;
  conversation_id: string;
  text: string;
  toolCalls: ToolCallLike[];
}): Promise<ArtifactFallbackResult | null> {
  const request = inferChartRequest(args.text);
  if (!request || hasArtifact(args.toolCalls)) return null;

  const started = Date.now();
  const step = args.toolCalls.length + 1;
  const contextualFollowup = isContextualChartFollowup(args.text);
  try {
    // Prefer evidence already executed for the SAME financial question. If this
    // is an explicit referential follow-up ("mostra isso em gráfico"), the V2
    // bridge may load the immediately previous persisted analytical evidence.
    let seriesAnalytical = [...args.toolCalls].reverse().find((call) => isSeriesEvidenceCall(call)) ?? null;
    if (!seriesAnalytical && contextualFollowup) {
      seriesAnalytical = await loadRecentSeriesEvidence(args.sb, args.user_id, args.conversation_id);
    }
    // Série (dia/semana/mês/trimestre): TEMPLATE do grão preenchido com a
    // evidência executada — mesmos valores, mesmo período, mesmo recorte.
    const requestedGrain: SeriesGrain | null = request.mode === "series"
      ? request.grain
      : request.mode === "monthly_series" ? "month" : null;
    if (seriesAnalytical) {
      const result = seriesAnalytical.result as any;
      const chart = seriesChartFromEvidence(result, requestedGrain);
      if (!chart) {
        throw new Error(seriesEvidenceHasData(result) ? "series_grain_mismatch" : "series_evidence_empty");
      }
      const artifact_id = await persistRichArtifact(args.sb, {
        user_id: args.user_id,
        conversation_id: args.conversation_id,
        payload: chart.payload,
      });
      return {
        artifact_id,
        message: artifact_id ? `Preparei o gráfico (${chart.template.title.toLowerCase()}) com o mesmo recorte da resposta.` : "Não consegui gerar a imagem agora.",
        toolCall: {
          step_index: step,
          tool_name: chart.template.tool_name,
          args: request,
          result: {
            artifact_id,
            template: chart.grain,
            source_evidence: {
              run_id: seriesAnalytical.run_id ?? null,
              tool_name: seriesAnalytical.tool_name,
              formula_version: result.formula_version ?? null,
              window: result.window ?? null,
              scope: result.scope ?? null,
            },
          },
          ok: Boolean(artifact_id),
          duration_ms: Date.now() - started,
          error: artifact_id ? null : "artifact_not_persisted",
        },
      };
    }

    // Referential chart requests are never allowed to silently turn into a new
    // generic 30-day query. Missing/incompatible evidence fails honestly.
    if (contextualFollowup) {
      throw new Error("referenced_chart_evidence_unavailable");
    }

    // Pedido de série (qualquer grão) sem a série do mesmo recorte: nunca
    // trocar por um gráfico genérico (era assim que "diário de Uber" virava
    // um gráfico de todos os gastos).
    if (request.mode === "monthly_series") {
      throw new Error("monthly_series_evidence_unavailable");
    }
    if (request.mode === "series") {
      throw new Error("series_evidence_unavailable");
    }
    // Leitura com recorte no turno: gráfico genérico sem filtro seria outra
    // pergunta. Falha honesta em vez de gráfico errado.
    if ((request.mode === "tool" || request.mode === "category") && executedScopedRead(args.toolCalls)) {
      throw new Error("scoped_chart_evidence_unavailable");
    }

    if (request.mode === "weekday_pattern") {
      const analytical = [...args.toolCalls].reverse().find((call) =>
        call.ok && call.tool_name === "get_weekday_spending_pattern"
      );
      const result = (analytical?.result as any) ?? null;
      if (!result?.weekdays?.length) throw new Error("weekday_evidence_unavailable");
      const series = result.weekdays.map((row: any) => ({
        name: String(row.label ?? ""),
        value: Number(row.typical_amount ?? 0),
      }));
      const artifact_id = await persistArtifact(args.sb, {
        user_id: args.user_id,
        conversation_id: args.conversation_id,
        kind: "weekday_pattern",
        title: "Gasto esperado por dia da semana",
        summary_text: "Comparação robusta que separa frequência, valor típico e picos atípicos.",
        fallback_text: "Não consegui exibir a imagem, mas a resposta em texto usa a mesma análise robusta.",
        series,
        formula_version: String(result.formula_version ?? WEEKDAY_TRUTH_FORMULA_VERSION),
        confidence: String(result.confidence ?? "insufficient"),
        row_count: Number(result.sample_size ?? 0),
      });
      return {
        artifact_id,
        message: artifact_id ? "Preparei o gráfico com a mesma análise robusta." : "Não consegui gerar a imagem agora.",
        toolCall: {
          step_index: step,
          tool_name: "generate_weekday_chart_artifact",
          args: request,
          result: { artifact_id },
          ok: Boolean(artifact_id),
          duration_ms: Date.now() - started,
          error: artifact_id ? null : "artifact_not_persisted",
        },
      };
    }

    if (request.mode === "category") {
      const report = await analyze_spending({
        sb: args.sb,
        user_id: args.user_id,
        conversation_id: args.conversation_id,
        user_text: args.text,
      }, { days: request.days });
      if (!report.ok) throw new Error(report.error);
      const categories = ((report.result as any)?.categories ?? []).slice(0, 10);
      if (!categories.length) throw new Error("category_data_unavailable");
      const artifact_id = await persistArtifact(args.sb, {
        user_id: args.user_id,
        conversation_id: args.conversation_id,
        kind: "category_breakdown",
        title: "Gastos por categoria",
        summary_text: `Principais categorias dos últimos ${request.days} dias.`,
        fallback_text: "Não consegui exibir a imagem, mas posso listar as categorias em texto.",
        series: categories.map((row: any) => ({ name: String(row.name), value: Number(row.value) })),
        formula_version: String((report.result as any)?.formula_version ?? "analyze_spending.consumption.v3"),
        confidence: (report.result as any)?.data_limit ? "low" : "medium",
        row_count: Number((report.result as any)?.transactions_count ?? 0),
      });
      return {
        artifact_id,
        message: artifact_id ? "Preparei o gráfico por categoria." : "Não consegui gerar a imagem agora.",
        toolCall: {
          step_index: step,
          tool_name: "generate_category_chart_artifact",
          args: request,
          result: { artifact_id },
          ok: Boolean(artifact_id),
          duration_ms: Date.now() - started,
          error: artifact_id ? null : "artifact_not_persisted",
        },
      };
    }

    const generated = await generate_chart_artifact({
      sb: args.sb,
      user_id: args.user_id,
      conversation_id: args.conversation_id,
      user_text: args.text,
    }, request.args);
    if (!generated.ok) throw new Error(generated.error);
    const artifact_id = (generated.result as any)?.artifact_id ?? null;
    return {
      artifact_id,
      message: artifact_id ? "Preparei o gráfico solicitado." : "Não consegui gerar a imagem agora.",
      toolCall: {
        step_index: step,
        tool_name: "generate_chart_artifact",
        args: request.args,
        result: generated.result,
        ok: Boolean(artifact_id),
        duration_ms: Date.now() - started,
        error: artifact_id ? null : "artifact_not_persisted",
      },
    };
  } catch (error) {
    const message = String((error as Error).message).slice(0, 160);
    return {
      artifact_id: null,
      message: "Não consegui gerar a imagem agora. Mantive a resposta em texto sem fingir que o gráfico foi enviado.",
      toolCall: {
        step_index: step,
        tool_name: request.mode === "monthly_series"
          ? SERIES_CHART_TEMPLATES.month.tool_name
          : request.mode === "series"
            ? SERIES_CHART_TEMPLATES[request.grain].tool_name
          : request.mode === "category"
            ? "generate_category_chart_artifact"
            : request.mode === "weekday_pattern"
              ? "generate_weekday_chart_artifact"
              : "generate_chart_artifact",
        args: request,
        result: null,
        ok: false,
        duration_ms: Date.now() - started,
        error: message,
      },
    };
  }
}
