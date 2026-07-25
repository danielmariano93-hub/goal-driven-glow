// Zod strict schema para chart.artifact.v2. Complementa a validação lite em
// schema.ts — usado quando a flag `artifacts_v2_strict` está ligada para
// bloquear persistência de payloads malformados.
// deno-lint-ignore-file no-explicit-any
import { z } from "https://esm.sh/zod@3.23.8";

export const ChartTypeZ = z.enum([
  "line", "bar", "stacked_bar", "donut", "area", "progress", "forecast_band",
]);
export const KindZ = z.enum(["chart", "report", "goal_projection", "forecast"]);

export const SeriesZ = z.object({
  name: z.string(),
  data: z.array(z.number().finite()),
  color: z.string().optional(),
});

export const ProvenanceZ = z.object({
  formula_version: z.string(),
  row_count: z.number().int().nonnegative().optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  source: z.string().optional(),
});

export const ChartArtifactV2Z = z.object({
  kind: KindZ,
  title: z.string().optional(),
  summary_text: z.string().optional(),
  fallback_text: z.string().optional(),
  a11y_summary: z.string().optional(),
  chart: z.object({
    type: ChartTypeZ,
    x_labels: z.array(z.string()),
    series: z.array(SeriesZ).min(1),
    y_format: z.enum(["currency", "number", "percent"]).optional(),
  }),
  provenance: ProvenanceZ,
}).refine(
  (v) => Boolean(v.a11y_summary || v.fallback_text || v.summary_text),
  { message: "a11y_or_fallback_or_summary_required" },
);

export type ChartArtifactV2 = z.infer<typeof ChartArtifactV2Z>;

export function parseArtifactV2Strict(payload: unknown): {
  ok: true; value: ChartArtifactV2;
} | {
  ok: false; errors: string[];
} {
  const r = ChartArtifactV2Z.safeParse(payload);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, errors: r.error.errors.map((e) => `${e.path.join(".")}:${e.message}`) };
}
