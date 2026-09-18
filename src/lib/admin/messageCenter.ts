import { supabase } from "@/integrations/supabase/client";

export type MessageRow = {
  id: string; created_at: string; updated_at: string; sent_at: string | null;
  status: string; channel: string; surface: string | null; feature: string | null;
  kind: string; attempts: number; last_error: string | null;
  provider_message_id: string | null; context_type: string | null; context_id: string | null;
  participant_id: string | null; user_id: string | null;
  recipient: string; preview: string; metadata: Record<string, unknown>;
};

export type Metrics = {
  total: number; queued: number; sent: number; delivered: number; failed: number; split: number;
  delivery_rate: number; avg_queued_to_sent_ms: number;
  by_channel: Record<string, number>;
  by_feature: Record<string, number>;
  by_surface: Record<string, number>;
};

export type TimelineEvent = {
  id: string; outbound_id: string; provider_message_id: string | null;
  status: string; occurred_at: string; payload_hash: string | null;
};

export type MessageFilters = {
  from: string; to: string;
  status?: string | null;
  surface?: string | null;
  feature?: string | null;
  user_id?: string | null;
  search?: string | null;
  limit?: number; offset?: number;
};

// Admin filters are calendar dates in America/Sao_Paulo. A bare YYYY-MM-DD
// sent to a timestamptz RPC truncates the final day at midnight, so expand the
// selected dates to explicit local-day boundaries before querying.
function spBoundary(value: string, endOfDay: boolean): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}-03:00`;
}

export async function fetchMessages(f: MessageFilters): Promise<MessageRow[]> {
  const { data, error } = await (supabase.rpc as any)("admin_message_activity", {
    p_from: spBoundary(f.from, false), p_to: spBoundary(f.to, true),
    p_status: f.status || null, p_kind: null,
    p_surface: f.surface || null, p_feature: f.feature || null,
    p_user_id: f.user_id || null, p_search: f.search || null,
    p_limit: f.limit ?? 200, p_offset: f.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as MessageRow[];
}

export async function fetchMetrics(from: string, to: string): Promise<Metrics> {
  const { data, error } = await (supabase.rpc as any)("admin_message_metrics", {
    p_from: spBoundary(from, false),
    p_to: spBoundary(to, true),
  });
  if (error) throw error;
  return data as Metrics;
}

export async function fetchTimeline(id: string) {
  const { data, error } = await (supabase.rpc as any)("admin_message_timeline", { p_id: id });
  if (error) throw error;
  return data as { message: MessageRow; events: TimelineEvent[] } | null;
}

export async function reprocessMessage(id: string) {
  const { data, error } = await (supabase.rpc as any)("admin_message_reprocess", { p_id: id });
  if (error) throw error;
  return data;
}
