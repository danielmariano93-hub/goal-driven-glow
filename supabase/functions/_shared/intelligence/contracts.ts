export type ConfidenceLevel = "insufficient" | "low" | "medium" | "high";

export type IntelligenceDomain =
  | "spending"
  | "income"
  | "cashflow"
  | "goals"
  | "behavior"
  | "documents"
  | "operations";

export type AnalyticalIntent =
  | "weekday_pattern"
  | "period_comparison"
  | "trend"
  | "forecast"
  | "goal_projection"
  | "financial_snapshot"
  | "unknown";

export type InterpretationMode =
  | "typical_behavior"
  | "total_concentration"
  | "frequency"
  | "average_ticket"
  | "raw_series";

export type OutputMode = "text" | "chart" | "both";
export type OutlierPolicy = "keep" | "separate" | "exclude_for_typical";

export type SemanticQuery = {
  domain: IntelligenceDomain;
  intent: AnalyticalIntent;
  interpretation: InterpretationMode;
  metric_key: string;
  output: OutputMode;
  outlier_policy: OutlierPolicy;
  period: { kind: "rolling_weeks" | "rolling_days" | "month"; value: number };
  correction: boolean;
  /** O usuário está contestando/pedindo confirmação de uma leitura anterior. */
  challenge?: boolean;
  /** Dias da semana citados explicitamente pelo usuário (0=domingo). */
  mentioned_weekdays?: number[];
  original_text: string;
};

export type MetricDefinition = {
  key: string;
  label: string;
  description: string;
  formula: string;
  default_window_days: number;
  minimum_sample: number;
  include_zero_days: boolean;
  outlier_policy: OutlierPolicy;
  formula_version: string;
};

export type EvidencePackage<T = unknown> = {
  metric_key: string;
  formula_version: string;
  period: { from: string; to: string };
  sample_size: number;
  confidence: ConfidenceLevel;
  result: T;
  exclusions: string[];
  outliers: Array<Record<string, unknown>>;
  limitations: string[];
  generated_at: string;
};

export type ToolCallEvidence = {
  tool_name: string;
  ok: boolean;
  args?: unknown;
  result?: unknown;
};

export type ChannelArtifact = {
  id: string | null;
  type: "chart" | "document" | "image";
  status: "none" | "generated" | "ready" | "delivered" | "failed";
};

export type ChannelEnvelope = {
  text: string;
  reply_kind: string;
  confidence: ConfidenceLevel | null;
  evidence: EvidencePackage | null;
  artifact: ChannelArtifact | null;
  actions: Array<{ type: string; label?: string; payload?: Record<string, unknown> }>;
};

export type ModelTask =
  | "fast_operation"
  | "semantic_classification"
  | "financial_analysis"
  | "complex_reasoning"
  | "vision"
  /** Documento COM camada de texto: extração sem visão (`nino_efficiency.v2`). */
  | "document_text"
  | "fallback";

export type ModelRoute = {
  task: ModelTask;
  primary: string;
  fallback: string | null;
  max_latency_ms: number;
  max_steps: number;
  reason: string;
};

export type CommunicationCandidate = {
  id: string;
  user_id: string;
  kind: string;
  severity: "info" | "attention" | "critical";
  title: string;
  body: string;
  channel_ready: "app" | "whatsapp" | "both";
  dedup_key: string;
  action?: Record<string, unknown> | null;
  evidence?: Record<string, unknown>;
};
