// Central chart fallback shared by App and WhatsApp.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { analyze_spending, generate_chart_artifact } from "../agent/tools.ts";
import { inferChartRequest } from "./chartIntent.ts";
import { WEEKDAY_TRUTH_FORMULA_VERSION } from "../analytics/weekdayTruth.ts";

type ToolCallLike = {
  step_index: number;
  tool_name: string;
  args: unknown;
  result: unknown;
  ok: boolean;
  duration_ms: number;
  error: string | null;
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
  try {
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
        tool_name: request.mode === "category"
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
