export type MemoryItem = {
  id: string;
  kind: string;
  key: string;
  value: Record<string, unknown>;
  confidence: number;
  source: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BehaviorHypothesis = {
  id: string;
  kind: string;
  title: string;
  explanation: string;
  confidence: number;
  evidence: Record<string, unknown>;
  dedup_key: string;
  status: "pending" | "confirmed" | "partial" | "rejected" | "expired";
  user_feedback: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

export type AdvisorAction = {
  key: string;
  title: string;
  detail: string;
  status: "pending" | "in_progress" | "done" | "dismissed";
  priority: number;
  route: string;
  evidence: Record<string, unknown>;
  updated_at?: string;
};

export type AdvisorReview = {
  id: string;
  period_kind: "weekly" | "monthly";
  period_start: string;
  period_end: string;
  summary: {
    headline?: string;
    explanation?: string;
    period_label?: string;
    highlights?: string[];
    indicators?: Record<string, number | null>;
    comparison?: Record<string, number | null>;
    limitations?: string[];
  };
  actions: AdvisorAction[];
  status: "active" | "completed" | "archived";
  formula_version: string;
  generated_at: string;
  updated_at: string;
  last_generated_at?: string;
};

export type CommunicationDelivery = {
  id: string;
  kind: string;
  channel: "app" | "whatsapp";
  status: string;
  reason: string | null;
  created_at: string;
  interacted_at: string | null;
  false_positive: boolean | null;
  user_feedback: "useful" | "not_useful" | "dismissed" | null;
};

export type ProactivePreferences = {
  proactive_financial: boolean;
  emotional_checkin: boolean;
  smart_tips: boolean;
  whatsapp_proactive: boolean;
  quiet_start: string | null;
  quiet_end: string | null;
  max_proactive_per_week: number;
  max_proactive_per_day: number;
  muted_proactive_kinds: string[];
};

export type NinoContext = {
  memory: MemoryItem[];
  hypotheses: BehaviorHypothesis[];
  reviews: AdvisorReview[];
  recent_deliveries: CommunicationDelivery[];
  preferences: ProactivePreferences;
  generated_at: string;
};

export const EMPTY_NINO_CONTEXT: NinoContext = {
  memory: [],
  hypotheses: [],
  reviews: [],
  recent_deliveries: [],
  preferences: {
    proactive_financial: true,
    emotional_checkin: true,
    smart_tips: true,
    whatsapp_proactive: false,
    quiet_start: "21:00",
    quiet_end: "08:00",
    max_proactive_per_week: 3,
    max_proactive_per_day: 1,
    muted_proactive_kinds: [],
  },
  generated_at: new Date(0).toISOString(),
};

export function normalizeNinoContext(value: unknown): NinoContext {
  if (!value || typeof value !== "object") return EMPTY_NINO_CONTEXT;
  const row = value as Partial<NinoContext>;
  const preferences = {
    ...EMPTY_NINO_CONTEXT.preferences,
    ...(row.preferences ?? {}),
    muted_proactive_kinds: Array.isArray(row.preferences?.muted_proactive_kinds)
      ? row.preferences!.muted_proactive_kinds
      : [],
  };
  return {
    memory: Array.isArray(row.memory) ? row.memory : [],
    hypotheses: Array.isArray(row.hypotheses) ? row.hypotheses : [],
    reviews: Array.isArray(row.reviews) ? row.reviews : [],
    recent_deliveries: Array.isArray(row.recent_deliveries) ? row.recent_deliveries : [],
    preferences,
    generated_at: typeof row.generated_at === "string"
      ? row.generated_at
      : new Date().toISOString(),
  };
}
