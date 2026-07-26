import { supabase } from "@/integrations/supabase/client";
import type { PeriodRange } from "@/lib/admin/periodPresets";

// Wrapper tipado para RPCs admin_v2_*. Todas retornam jsonb.
// Nunca contêm PII: só pseudo_id, faixas e agregados.

export async function callAdminRpc<T = any>(
  fn: string,
  args?: Record<string, unknown>,
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(fn, args ?? {});
  if (error) throw error;
  return data as T;
}

/** RPCs cujo contrato declara _from, _to e _tz. */
export function withPeriod(range: PeriodRange, extras: Record<string, unknown> = {}) {
  return { _from: range.from, _to: range.to, _tz: "America/Sao_Paulo", ...extras };
}

/** RPCs cujo contrato declara apenas _from e _to. */
export function withDateRange(range: PeriodRange, extras: Record<string, unknown> = {}) {
  return { _from: range.from, _to: range.to, ...extras };
}

export function adminErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return fallback;

  const candidate = error as {
    message?: string;
    details?: string;
    hint?: string;
    code?: string;
  };

  const parts = [candidate.message, candidate.details, candidate.hint]
    .filter((part): part is string => Boolean(part?.trim()));

  return parts.length
    ? `${parts.join(" · ")}${candidate.code ? ` [${candidate.code}]` : ""}`
    : fallback;
}

export type Envelope = {
  value: number | null;
  previous: number | null;
  delta_abs: number | null;
  delta_pct: number | null;
  sample_size: number;
  sufficient_sample: boolean;
  polarity: "higher_is_better" | "lower_is_better" | "neutral";
  formula_version: string;
  timezone: string;
  measurement_started_at: string;
  data_quality: "ok" | "low" | "insufficient";
  source_kind: "aggregate" | "realtime";
};
