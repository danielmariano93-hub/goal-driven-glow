// Client-side mirror do contrato ChartArtifact (mantido em sync com
// supabase/functions/_shared/artifacts/builder.ts). Só o formato; nunca gera.
export type Confidence = "high" | "medium" | "low" | "insufficient_data";

export type Provenance = {
  period: { from: string; to: string; tz: "America/Sao_Paulo" };
  as_of: string;
  row_count: number;
  confidence: Confidence;
  formula_version: string;
  maturity?: { days_observed: number; days_in_month: number };
  notes?: string[];
};

export type ChartType =
  | "line" | "bar" | "stacked_bar" | "donut" | "area" | "progress" | "forecast_band";

export type ChartArtifact = {
  kind: "chart" | "report" | "goal_projection" | "forecast";
  headline: string;
  narrative: string;
  metrics: Array<{ label: string; value: string; hint?: string }>;
  chart: {
    type: ChartType;
    title: string;
    x_labels: string[];
    series: Array<{ name: string; data: number[]; color?: string }>;
    units: "BRL" | "pct" | "count";
    annotations?: Array<{ x: string; label: string }>;
  };
  actions?: Array<{ label: string; intent: string; params?: Record<string, unknown> }>;
  provenance: Provenance;
  a11y_summary: string;
};
