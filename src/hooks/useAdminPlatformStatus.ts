import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type JobKey = "whatsapp-send" | "whatsapp-ack-watchdog" | "split-reminders-dispatch" | "recurring-generate";

export type WhatsAppOperationalStatus =
  | "connected"
  | "unstable"
  | "unverifiable"
  | "awaiting_qr"
  | "connecting"
  | "disconnected"
  | "needs_attention"
  | "unavailable"
  | "not_configured";

export type PlatformStatus = {
  whatsapp: {
    status: WhatsAppOperationalStatus;
    error_code: string | null;
    latency_ms: number | null;
    last_seen_at: string | null;
    active_links: number;
    source?: "live_session" | "provider_health";
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

type LiveWhatsAppStatus = {
  status?: WhatsAppOperationalStatus;
  error_code?: string | null;
  latency_ms?: number | null;
  last_seen_at?: string | null;
};

function isLiveStatus(value: unknown): value is LiveWhatsAppStatus {
  if (!value || typeof value !== "object") return false;
  const status = (value as LiveWhatsAppStatus).status;
  return typeof status === "string";
}

export function useAdminPlatformStatus() {
  return useQuery({
    queryKey: ["admin_platform_status"],
    queryFn: async () => {
      const [snapshotResult, liveResult] = await Promise.allSettled([
        supabase.rpc("admin_platform_status"),
        supabase.functions.invoke("whatsapp-session", {
          body: { action: "operational_status" },
        }),
      ]);

      if (snapshotResult.status === "rejected") throw snapshotResult.reason;
      const snapshot = snapshotResult.value;
      if (snapshot.error) throw snapshot.error;
      const result = snapshot.data as unknown as PlatformStatus;

      // The live session is authoritative for connectivity. A failed live
      // probe does not overwrite the safer heartbeat fallback from the RPC.
      const live = liveResult.status === "fulfilled" ? liveResult.value : null;
      if (live && !live.error && isLiveStatus(live.data)) {
        result.whatsapp = {
          ...result.whatsapp,
          status: live.data.status ?? result.whatsapp.status,
          error_code: live.data.error_code ?? null,
          latency_ms: live.data.latency_ms ?? null,
          last_seen_at: live.data.last_seen_at ?? result.whatsapp.last_seen_at,
          source: "live_session",
        };
      }

      return result;
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });
}
