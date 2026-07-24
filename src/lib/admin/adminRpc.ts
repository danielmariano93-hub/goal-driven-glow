import { supabase } from "@/integrations/supabase/client";

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
