import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type JobKey = "whatsapp-send" | "whatsapp-ack-watchdog" | "split-reminders-dispatch" | "recurring-generate";

export type PlatformStatus = {
  whatsapp: {
    status: "connected" | "awaiting_qr" | "connecting" | "disconnected" | "needs_attention" | "unavailable" | "not_configured";
    error_code: string | null;
    latency_ms: number | null;
    last_seen_at: string | null;
    active_links: number;
  };
  agent: {
    status: "working" | "attention" | "unavailable" | "not_setup";
    active_prompt: boolean;
    failures_24h: number;
  };
  jobs: Record<JobKey, {
    status: "healthy" | "delayed" | "failing" | "idle" | "not_scheduled";
    last_run_at: string | null;
    next_run_at: string | null;
    last_error_code: string | null;
    processed: number;
    failed: number;
  }>;
  outbox: { queued: number; failed: number };
};

export function useAdminPlatformStatus() {
  return useQuery({
    queryKey: ["admin_platform_status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_platform_status");
      if (error) throw error;
      return data as unknown as PlatformStatus;
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}
