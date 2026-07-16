import { useEffect, useRef, useState } from "react";
import { Loader2, QrCode, Play, Square, RotateCw, LogOut, HeartPulse, Send, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Snap = {
  configured: boolean;
  secrets: Record<string, boolean>;
  health: { ok: boolean; latency_ms: number; error?: string } | null;
  session: { status: string; error?: string } | null;
  me: { phone_masked: string } | null;
};

const STATUS_COLORS: Record<string, string> = {
  WORKING: "bg-green-100 text-green-800 border-green-200",
  SCAN_QR_CODE: "bg-blue-100 text-blue-800 border-blue-200",
  STARTING: "bg-amber-100 text-amber-800 border-amber-200",
  STOPPED: "bg-slate-100 text-slate-700 border-slate-200",
  FAILED: "bg-red-100 text-red-800 border-red-200",
  UNREACHABLE: "bg-red-100 text-red-800 border-red-200",
  UNKNOWN: "bg-slate-100 text-slate-700 border-slate-200",
};

async function call<T = unknown>(action: string, extra?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("whatsapp-session", { body: { action, ...(extra ?? {}) } });
  if (error) throw error;
  return data as T;
}

export function WhatsAppSessionPanel() {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [qr, setQr] = useState<{ mimeType: string; base64: string } | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testConsent, setTestConsent] = useState(false);
  const pollTimer = useRef<number | null>(null);
  const pollUntil = useRef<number>(0);

  const refresh = async () => {
    try {
      const s = await call<Snap & { ok?: boolean }>("status");
      setSnap(s);
      if (s.session?.status === "WORKING") stopPolling();
      return s;
    } catch {
      toast.error("Falha ao consultar sessão.");
      return null;
    }
  };

  useEffect(() => { refresh(); return () => stopPolling(); }, []);

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
      if (s.session?.status === "WORKING") { stopPolling(); toast.success("Sessão conectada."); return; }
      if (s.session?.status === "SCAN_QR_CODE") {
        try {
          const r = await call<{ ok: boolean; mimeType?: string; base64?: string }>("qr");
          if (r.ok && r.base64) setQr({ mimeType: r.mimeType ?? "image/png", base64: r.base64 });
        } catch { /* silent */ }
      }
    };
    tick();
    pollTimer.current = window.setInterval(tick, 3_000);
  };

  const run = async (action: string, opts?: { extra?: Record<string, unknown>; then?: string; label?: string }) => {
    setBusy(action);
    try {
      const r = await call<{ ok?: boolean; error?: string }>(action, opts?.extra);
      if (r.ok === false) throw new Error(r.error ?? "erro");
      toast.success(opts?.label ?? "Ok.");
      if (opts?.then) toast.info(opts.then);
      await refresh();
    } catch (e) {
      toast.error(String((e as Error).message).slice(0, 120));
    } finally {
      setBusy(null);
    }
  };

  const onCreate = async () => {
    await run("create", { label: "Sessão criada/atualizada.", then: "Agora clique em Iniciar." });
  };
  const onStart = async () => {
    await run("start", { label: "Sessão iniciada." });
    await startPollingQr();
  };
  const onRestart = async () => { await run("restart", { label: "Reiniciada." }); await startPollingQr(); };
  const onStop = async () => run("stop", { label: "Parada." });
  const onLogout = async () => run("logout", { label: "Logout realizado." });
  const onSyncWebhook = async () => run("sync_webhook", { label: "Webhook sincronizado." });

  const onTestHealth = async () => {
    setBusy("test_health");
    try {
      const r = await call<{ ok: boolean; deep_ok: boolean; me: { phone_masked?: string } | null; session: { status: string } }>("test_health");
      if (r.deep_ok) toast.success(`Saúde ok • ${r.session.status} • ${r.me?.phone_masked ?? "sem telefone"}`);
      else toast.warning(`Saúde parcial • status ${r.session?.status ?? "?"}`);
    } catch (e) {
      toast.error(String((e as Error).message).slice(0, 120));
    } finally { setBusy(null); }
  };

  const onSendTest = async () => {
    if (!testTo || !testConsent) { toast.error("Informe telefone e marque consentimento."); return; }
    setBusy("send_test");
    try {
      const r = await call<{ ok: boolean; error?: string; provider_message_id?: string }>("send_test", { to: testTo, consent: true });
      if (!r.ok) throw new Error(r.error ?? "erro");
      toast.success("Mensagem de teste enviada.");
      setTestTo(""); setTestConsent(false);
    } catch (e) {
      toast.error(String((e as Error).message).slice(0, 120));
    } finally { setBusy(null); }
  };

  const status = snap?.session?.status ?? "UNKNOWN";
  const badge = STATUS_COLORS[status] ?? STATUS_COLORS.UNKNOWN;
  const canSend = status === "WORKING";

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg font-semibold">Sessão WhatsApp (WAHA)</h2>
        <button
          onClick={() => refresh()}
          className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs hover:bg-accent"
        >
          <RefreshCw className="h-3 w-3" /> Atualizar
        </button>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${badge}`}>
            {status}
          </span>
          <span className="text-xs text-muted-foreground">
            {snap?.me?.phone_masked ?? "sem telefone conectado"}
          </span>
          {snap?.health && (
            <span className="text-xs text-muted-foreground">
              • latência {snap.health.latency_ms}ms{snap.health.error ? ` • ${snap.health.error}` : ""}
            </span>
          )}
        </div>

        {!snap?.configured && (
          <p className="mt-3 text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-md p-2">
            Adicione os secrets no Project Settings → Secrets para ativar a mensageria.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <SharedSessionConfirm label="Criar/atualizar sessão" icon={<QrCode className="h-3 w-3" />}
            onConfirm={onCreate} disabled={!!busy || !snap?.configured} busy={busy === "create"} />
          <SharedSessionConfirm label="Iniciar" icon={<Play className="h-3 w-3" />}
            onConfirm={onStart} disabled={!!busy || !snap?.configured} busy={busy === "start"} />
          <SharedSessionConfirm label="Reiniciar" icon={<RotateCw className="h-3 w-3" />}
            onConfirm={onRestart} disabled={!!busy || !snap?.configured} busy={busy === "restart"} />
          <SharedSessionConfirm label="Sincronizar webhook" icon={<RefreshCw className="h-3 w-3" />}
            onConfirm={onSyncWebhook} disabled={!!busy || !snap?.configured} busy={busy === "sync_webhook"} />
          <button onClick={onTestHealth} disabled={!!busy || !snap?.configured}
            className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50">
            {busy === "test_health" ? <Loader2 className="h-3 w-3 animate-spin" /> : <HeartPulse className="h-3 w-3" />} Testar saúde
          </button>


          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button disabled={!!busy || !snap?.configured}
                className="inline-flex items-center gap-1 rounded-full border border-red-200 text-red-700 px-3 py-1.5 text-xs hover:bg-red-50 disabled:opacity-50">
                <Square className="h-3 w-3" /> Parar
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Parar sessão?</AlertDialogTitle>
                <AlertDialogDescription>A sessão ficará indisponível até ser reiniciada. Mensagens novas não serão enviadas.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={onStop}>Parar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button disabled={!!busy || !snap?.configured}
                className="inline-flex items-center gap-1 rounded-full border border-red-200 text-red-700 px-3 py-1.5 text-xs hover:bg-red-50 disabled:opacity-50">
                <LogOut className="h-3 w-3" /> Logout
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Desconectar o WhatsApp?</AlertDialogTitle>
                <AlertDialogDescription>
                  O número deixará de estar conectado. Você precisará escanear o QR novamente para reconectar.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={onLogout}>Desconectar</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {status === "SCAN_QR_CODE" && (
          <div className="mt-5 rounded-lg border bg-slate-50 p-4">
            <p className="text-xs text-muted-foreground mb-2">Escaneie com o WhatsApp do número oficial. O QR expira em ~30s e é renovado automaticamente.</p>
            {qr ? (
              <img
                alt="QR Code"
                src={`data:${qr.mimeType};base64,${qr.base64}`}
                className="h-56 w-56 rounded-md border bg-white"
              />
            ) : (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Aguardando QR…
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mt-4 rounded-xl border bg-card p-5">
        <p className="text-sm font-semibold mb-2">Enviar mensagem de teste</p>
        <p className="text-xs text-muted-foreground mb-3">
          Enviaremos uma mensagem marcada como [TESTE] apenas se você marcar o consentimento explícito. Use com um número seu.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={testTo} onChange={(e) => setTestTo(e.target.value)}
            placeholder="+55 11 9xxxx-xxxx"
            className="h-9 rounded-md border px-3 text-sm min-w-[220px]"
          />
          <label className="text-xs flex items-center gap-2">
            <input type="checkbox" checked={testConsent} onChange={(e) => setTestConsent(e.target.checked)} />
            Tenho consentimento do destinatário
          </label>
          <button onClick={onSendTest} disabled={!canSend || !testTo || !testConsent || busy === "send_test"}
            className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs disabled:opacity-50">
            {busy === "send_test" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Enviar teste
          </button>
        </div>
        {!canSend && <p className="mt-2 text-xs text-muted-foreground">Envio só habilita com sessão WORKING.</p>}
      </div>

      <OperationChecklist secrets={snap?.secrets} />
    </section>
  );
}

function OperationChecklist({ secrets }: { secrets?: Record<string, boolean> }) {
  const items = [
    { name: "whatsapp-send (outbox)", freq: "a cada 30s", path: "whatsapp-send" },
    { name: "whatsapp-ack-watchdog", freq: "a cada 2min", path: "whatsapp-ack-watchdog" },
    { name: "split-reminders-dispatch", freq: "a cada 5min", path: "split-reminders-dispatch" },
    { name: "recurring generation", freq: "diária 03:00 SP", path: "recurring-generate" },
  ];
  return (
    <div className="mt-4 rounded-xl border bg-card p-5">
      <p className="text-sm font-semibold">Operação — Crons</p>
      <p className="text-xs text-muted-foreground mt-1">
        Configure um scheduler externo (ou pg_cron) para acionar cada função com o header <code className="text-[11px]">x-cron-secret: $CRON_SECRET</code>.
        Status não é verificado automaticamente.
      </p>
      {!secrets?.CRON_SECRET && (
        <p className="mt-2 text-xs text-yellow-800 bg-yellow-50 border border-yellow-200 rounded-md p-2">
          CRON_SECRET ainda não configurado. Adicione em Project Settings → Secrets.
        </p>
      )}
      <ul className="mt-3 text-xs space-y-1">
        {items.map((it) => (
          <li key={it.path} className="flex items-center justify-between gap-3">
            <span><strong>{it.name}</strong> · {it.freq}</span>
            <code className="text-[11px] text-muted-foreground truncate max-w-[60%]">
              POST /functions/v1/{it.path}
            </code>
          </li>
        ))}
      </ul>
    </div>
  );
}
