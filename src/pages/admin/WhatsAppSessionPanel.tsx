import { useEffect, useRef, useState } from "react";
import { Loader2, QrCode, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatusChip } from "@/components/admin/StatusChip";
import { mapWhatsAppStatus, humanizeRelative } from "@/lib/admin/statusMapper";
import { mapAdminActionError } from "@/lib/admin/errorMapper";
import { useAdminPlatformStatus } from "@/hooks/useAdminPlatformStatus";

type SessionSnap = {
  status: string;
  capabilities: { can_connect: boolean; can_send: boolean; needs_session: boolean; temporarily_unavailable: boolean };
  phone_masked: string | null;
  last_seen_at: string | null;
  latency_ms: number | null;
  error_code: string | null;
};

async function call<T = unknown>(action: string, extra?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("whatsapp-session", { body: { action, ...(extra ?? {}) } });
  if (error) throw error;
  return data as T;
}

export function WhatsAppSessionPanel() {
  const platform = useAdminPlatformStatus();
  const [snap, setSnap] = useState<SessionSnap | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [qr, setQr] = useState<{ mimeType: string; base64: string } | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testConsent, setTestConsent] = useState(false);
  const pollTimer = useRef<number | null>(null);
  const pollUntil = useRef<number>(0);

  const refresh = async () => {
    try {
      const s = await call<SessionSnap>("status");
      setSnap(s);
      if (s.status === "connected") stopPolling();
      return s;
    } catch {
      toast.error("Não foi possível verificar agora.");
      return null;
    }
  };

  useEffect(() => {
    refresh();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopPolling = () => {
    if (pollTimer.current) { clearInterval(pollTimer.current); pollTimer.current = null; }
    setQr(null);
  };

  const startPollingQr = async () => {
    stopPolling();
    pollUntil.current = Date.now() + 3 * 60_000;
    const tick = async () => {
      if (Date.now() > pollUntil.current) { stopPolling(); return; }
      const s = await refresh();
      if (!s) return;
      if (s.status === "connected") { toast.success("WhatsApp conectado."); return; }
      if (s.status === "awaiting_qr") {
        try {
          const r = await call<{ ok: boolean; mimeType?: string; base64?: string }>("qr");
          if (r.ok && r.base64) setQr({ mimeType: r.mimeType ?? "image/png", base64: r.base64 });
        } catch { /* silent */ }
      }
    };
    tick();
    pollTimer.current = window.setInterval(tick, 3_000);
  };

  const run = async (action: string, label: string) => {
    setBusy(action);
    try {
      const r = await call<{ ok?: boolean }>(action);
      if (r?.ok === false) throw new Error("action_failed");
      toast.success(label);
      await refresh();
      platform.refetch();
    } catch (e) {
      const fe = mapAdminActionError(e);
      toast.error(`${fe.title} · ${fe.code}`);
    } finally { setBusy(null); }
  };

  const onConnect = async () => {
    setBusy("connect");
    try {
      await call("create");
      await call("start");
      await startPollingQr();
      toast.success("Iniciando conexão…");
    } catch (e) {
      const fe = mapAdminActionError(e);
      toast.error(`${fe.title} · ${fe.code}`);
    } finally { setBusy(null); }
  };

  const onSendTest = async () => {
    if (!testTo || !testConsent) { toast.error("Informe o telefone e marque o consentimento."); return; }
    setBusy("send_test");
    try {
      const r = await call<{ ok: boolean }>("send_test", { to: testTo, consent: true });
      if (!r.ok) throw new Error("send_failed");
      toast.success("Mensagem de teste enviada.");
      setTestTo(""); setTestConsent(false);
    } catch (e) {
      const fe = mapAdminActionError(e);
      toast.error(`${fe.title} · ${fe.code}`);
    } finally { setBusy(null); }
  };

  const view = mapWhatsAppStatus(snap?.status);
  const notConfigured = snap?.status === "not_configured";
  const needsSession = snap?.capabilities?.needs_session === true;
  const canSend = snap?.capabilities?.can_send === true;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <StatusChip view={view} />
          <span className="text-xs text-muted-foreground">
            {snap?.phone_masked ?? "sem telefone conectado"}
          </span>
        </div>
        <button
          onClick={() => refresh()}
          className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs hover:bg-accent"
        >
          <RefreshCw className="h-3 w-3" /> Atualizar
        </button>
      </div>

      <p className="text-sm text-muted-foreground mb-4">{view.impact}</p>

      {notConfigured && (
        <div className="rounded-2xl border border-border bg-card p-6 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold">Integração ainda não concluída</p>
            <p className="text-muted-foreground mt-1">
              A conexão base do canal WhatsApp precisa ser revisada antes que o assistente possa atender.
            </p>
            <button
              onClick={() => refresh()}
              className="mt-3 rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-medium"
            >
              Revisar conexão
            </button>
          </div>
        </div>
      )}

      {!notConfigured && (
        <div className="surface-card p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {snap?.last_seen_at && <span>Última verificação {humanizeRelative(snap.last_seen_at)}</span>}
            {typeof snap?.latency_ms === "number" && <span>· responde em ~{snap.latency_ms}ms</span>}
          </div>

          <div className="flex flex-wrap gap-2">
            {needsSession && (
              <button
                onClick={onConnect}
                disabled={!!busy}
                className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-medium disabled:opacity-50"
              >
                {busy === "connect" ? <Loader2 className="h-3 w-3 animate-spin" /> : <QrCode className="h-3 w-3" />}
                Conectar WhatsApp
              </button>
            )}

            {canSend && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button disabled={!!busy}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-200 text-amber-800 px-3 py-1.5 text-xs hover:bg-amber-50 disabled:opacity-50">
                    Reiniciar
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reiniciar o canal WhatsApp?</AlertDialogTitle>
                    <AlertDialogDescription>
                      O atendimento ficará indisponível por alguns segundos. Os vínculos existentes são preservados.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => run("restart", "Canal reiniciado.")}>Reiniciar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {canSend && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button disabled={!!busy}
                    className="inline-flex items-center gap-1 rounded-full border border-red-200 text-red-700 px-3 py-1.5 text-xs hover:bg-red-50 disabled:opacity-50">
                    Desconectar
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar o canal WhatsApp?</AlertDialogTitle>
                    <AlertDialogDescription>
                      O atendimento será encerrado. Você precisará escanear o QR Code novamente para reativar.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => run("logout", "Canal desconectado.")}>Desconectar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>

          {qr && (
            <div className="rounded-xl border border-border bg-white p-4 grid place-items-center">
              <img src={`data:${qr.mimeType};base64,${qr.base64}`} alt="QR Code para conectar o WhatsApp" className="max-w-[240px]" />
              <p className="mt-3 text-xs text-muted-foreground">Abra o WhatsApp no aparelho e escaneie este código.</p>
            </div>
          )}
        </div>
      )}

      {canSend && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold mb-2">Enviar mensagem de teste</h2>
          <div className="surface-card p-5 space-y-3">
            <input
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="Telefone com DDD"
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={testConsent} onChange={(e) => setTestConsent(e.target.checked)} />
              Confirmo que a pessoa autorizou receber esta mensagem de teste.
            </label>
            <button onClick={onSendTest} disabled={!!busy}
              className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-medium disabled:opacity-50">
              {busy === "send_test" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Enviar teste
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
