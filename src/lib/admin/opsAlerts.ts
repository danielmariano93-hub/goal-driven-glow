import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { callAdminRpc } from "@/lib/admin/adminRpc";

// Alertas operacionais (ops_alerts): o Nino avisa o admin quando algo cai.

export interface OpsAlert {
  key: string;
  severity: "critical" | "warning";
  title: string;
  detail: string | null;
  since: string;
  last_seen: string;
}

export interface OpsAlertSettings {
  enabled: boolean;
  ntfy_topic: string | null;
  notify_whatsapp: boolean;
  renotify_minutes: number;
  whatsapp_to: string | null;
}

export interface OpsAlertsData {
  open: OpsAlert[];
  recent: Array<{ key: string; severity: string; title: string; since: string; resolved_at: string | null; status: "open" | "resolved" }>;
  settings: OpsAlertSettings;
}

export function useOpsAlerts() {
  return useQuery({
    queryKey: ["admin-ops-alerts"],
    queryFn: () => callAdminRpc<OpsAlertsData>("admin_ops_alerts_get"),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useSaveOpsAlertSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: OpsAlertSettings) =>
      callAdminRpc("admin_ops_alert_settings_save", {
        _enabled: s.enabled, _ntfy_topic: s.ntfy_topic, _notify_whatsapp: s.notify_whatsapp, _renotify_minutes: s.renotify_minutes, _whatsapp_to: s.whatsapp_to,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-ops-alerts"] }),
  });
}

/** Há quanto tempo o problema existe, em texto curto. */
export function sinceText(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} dias`;
}
