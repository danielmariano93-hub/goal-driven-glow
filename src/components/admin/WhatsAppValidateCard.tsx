import { useState } from "react";
import { Loader2, ShieldCheck, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { StatusChip } from "@/components/admin/StatusChip";
import { mapWahaValidate, type WahaValidateCode } from "@/lib/admin/statusMapper";
import { mapAdminActionError } from "@/lib/admin/errorMapper";

// Sanitized shape mirrors the server payload. No URLs, tokens or raw errors.
type ValidateReport = {
  secrets: { api_url: boolean; api_key: boolean; webhook_secret: boolean; session_name: string };
  host: { ok: boolean; latency_ms: number; code: WahaValidateCode };
  auth: { ok: boolean; code: WahaValidateCode };
  session: { exists: boolean; status: string | null; code: WahaValidateCode };
  webhook: {
    configured: boolean;
    matches_url: boolean;
    has_secret_header: boolean;
    events_ok: boolean;
    code: WahaValidateCode;
  };
};

function secretsCode(r: ValidateReport): WahaValidateCode {
  const { api_url, api_key, webhook_secret } = r.secrets;
  return api_url && api_key && webhook_secret ? "ok" : "not_configured";
}

const ROWS: Array<{ key: keyof ValidateReport | "secrets_sum"; label: string; pick: (r: ValidateReport) => WahaValidateCode }> = [
  { key: "secrets_sum", label: "Credenciais cadastradas",     pick: secretsCode },
  { key: "host",        label: "Servidor acessível",          pick: (r) => r.host.code },
  { key: "auth",        label: "Autenticação aceita",         pick: (r) => r.auth.code },
  { key: "session",     label: "Sessão do WhatsApp encontrada", pick: (r) => r.session.code },
  { key: "webhook",     label: "Webhook do NoControle.ia",    pick: (r) => r.webhook.code },
];

export function WhatsAppValidateCard({ onDone }: { onDone?: () => void }) {
  const [busy, setBusy] = useState<"validate" | "sync" | null>(null);
  const [report, setReport] = useState<ValidateReport | null>(null);

  const runValidate = async () => {
    setBusy("validate");
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-session", { body: { action: "validate" } });
      if (error) throw error;
      const r = (data as { ok?: boolean; report?: ValidateReport } | null);
      if (!r?.report) throw new Error("no_report");
      setReport(r.report);
    } catch (e) {
      const fe = mapAdminActionError(e);
      toast.error(`${fe.title} · ${fe.code}`);
    } finally {
      setBusy(null);
    }
  };

  const canSync = report && report.host.code === "ok" && report.auth.code === "ok"
    && (report.webhook.code === "webhook_missing" || report.webhook.code === "webhook_mismatch");

  const runSync = async () => {
    setBusy("sync");
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-session", { body: { action: "sync_webhook" } });
      if (error || (data as { ok?: boolean })?.ok === false) throw new Error("sync_failed");
      toast.success("Webhook sincronizado.");
      await runValidate();
      onDone?.();
    } catch (e) {
      const fe = mapAdminActionError(e);
      toast.error(`${fe.title} · ${fe.code}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="surface-card p-5 mb-6">
      <div className="flex items-start gap-3">
        <div className="rounded-full bg-primary/10 p-2.5">
          <ShieldCheck className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-semibold">Validar credenciais do WhatsApp</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Verifica no servidor se cada peça da integração está no lugar antes de conectar.
          </p>
        </div>
        <button
          onClick={runValidate}
          disabled={busy !== null}
          className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-medium disabled:opacity-50"
        >
          {busy === "validate" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {report ? "Validar de novo" : "Validar agora"}
        </button>
      </div>

      {report && (
        <ul className="mt-5 space-y-2">
          {ROWS.map((row) => {
            const code = row.pick(report);
            const view = mapWahaValidate(code);
            return (
              <li key={row.key} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{row.label}</p>
                  {view.impact && <p className="text-[11px] text-muted-foreground mt-0.5">{view.impact}</p>}
                </div>
                <StatusChip view={view} size="sm" />
              </li>
            );
          })}
        </ul>
      )}

      {canSync && (
        <div className="mt-4 flex justify-end">
          <button
            onClick={runSync}
            disabled={busy !== null}
            className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            {busy === "sync" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Sincronizar webhook
          </button>
        </div>
      )}
    </section>
  );
}
