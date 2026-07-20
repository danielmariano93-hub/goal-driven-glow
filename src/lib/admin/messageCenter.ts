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

export async function fetchMessages(f: MessageFilters): Promise<MessageRow[]> {
  const { data, error } = await (supabase.rpc as any)("admin_message_activity", {
    p_from: f.from, p_to: f.to,
    p_status: f.status || null, p_kind: null,
    p_surface: f.surface || null, p_feature: f.feature || null,
    p_user_id: f.user_id || null, p_search: f.search || null,
    p_limit: f.limit ?? 200, p_offset: f.offset ?? 0,
  });
  if (error) throw error;
  return (data ?? []) as MessageRow[];
}

export async function fetchMetrics(from: string, to: string): Promise<Metrics> {
  const { data, error } = await (supabase.rpc as any)("admin_message_metrics", { p_from: from, p_to: to });
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
