import { useEffect, useState } from "react";
import { Loader2, ShieldCheck, RefreshCw, ArrowRight, CheckCircle2, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatusChip } from "@/components/admin/StatusChip";
import { mapWhatsAppStatus, humanizeRelative } from "@/lib/admin/statusMapper";
import { mapAdminActionError } from "@/lib/admin/errorMapper";

type ConfigStatus = {
  configured: boolean;
  has_url: boolean;
  has_api_key: boolean;
  has_webhook_secret: boolean;
  session_name: string;
  updated_at: string | null;
  role?: string | null;
};

type SessionSnap = {
  status: string;
  capabilities: { can_connect: boolean; can_send: boolean; needs_session: boolean; temporarily_unavailable: boolean };
  phone_masked: string | null;
  last_seen_at: string | null;
  latency_ms: number | null;
  error_code: string | null;
};

async function call<T>(action: string, extra?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("whatsapp-session", { body: { action, ...(extra ?? {}) } });
  if (error) throw error;
  return data as T;
}

const ERR_HINT: Record<string, string> = {
  invalid_scheme: "Use uma URL que comece com https://.",
  invalid_url: "URL inválida.",
  blocked_host: "Endereços privados ou locais não são permitidos.",
  invalid_api_key: "A chave de acesso parece muito curta.",
  unauthorized: "As credenciais foram recusadas pelo servidor.",
  unreachable: "Não consegui falar com o servidor.",
  owner_required: "Só o dono da plataforma pode substituir as credenciais.",
  rate_limited: "Muitas tentativas em pouco tempo. Aguarde um instante.",
};

export function WhatsAppSetupWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<"creds" | "session" | "connect" | "done">("creds");
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [tested, setTested] = useState<{ latency_ms?: number; code?: string } | null>(null);
  const [snap, setSnap] = useState<SessionSnap | null>(null);
  const [qr, setQr] = useState<{ mimeType: string; base64: string } | null>(null);

  useEffect(() => {
    if (step !== "connect") return;
    const start = Date.now();
    const iv = setInterval(async () => {
      try {
        const s = await call<SessionSnap>("status");
        setSnap(s);
        if (s.status === "connected") { clearInterval(iv); setQr(null); setStep("done"); return; }
        if (s.status === "awaiting_qr") {
          const r = await call<{ ok: boolean; mimeType?: string; base64?: string }>("qr");
          if (r.ok && r.base64) setQr({ mimeType: r.mimeType ?? "image/png", base64: r.base64 });
        }
      } catch { /* silent */ }
      if (Date.now() - start > 3 * 60_000) clearInterval(iv);
    }, 3000);
    return () => clearInterval(iv);
  }, [step]);

  const testAndSave = async () => {
    if (!/^https:\/\//i.test(url)) { toast.error(ERR_HINT.invalid_scheme); return; }
    if (apiKey.trim().length < 4) { toast.error(ERR_HINT.invalid_api_key); return; }
    setBusy("test");
    try {
      const r = await call<{ ok: boolean; latency_ms?: number; code?: string; error_code?: string }>(
        "test_config", { url, api_key: apiKey },
      );
      const code = r.error_code ?? r.code ?? "ok";
      setTested({ latency_ms: r.latency_ms, code });
      if (!r.ok) { toast.error(ERR_HINT[code] ?? "Não consegui validar a conexão."); return; }
      setBusy("save");
      const s = await call<{ ok: boolean; error_code?: string }>("save_config", { url, api_key: apiKey });
      if (!s.ok) { toast.error(ERR_HINT[s.error_code ?? ""] ?? "Não consegui salvar."); return; }
      toast.success("Credenciais salvas.");
      setApiKey("");
      setStep("session");
    } catch (e) {
      const fe = mapAdminActionError(e);
      toast.error(`${fe.title} · ${fe.code}`);
    } finally { setBusy(null); }
  };

  const setupSession = async () => {
    setBusy("session");
    try {
      const r = await call<{ ok: boolean; status?: string; error_code?: string }>("setup_session");
      if (!r.ok) { toast.error(ERR_HINT[r.error_code ?? ""] ?? "Não consegui preparar o número."); return; }
      toast.success("Número preparado.");
      setStep("connect");
    } catch (e) {
      const fe = mapAdminActionError(e);
      toast.error(`${fe.title} · ${fe.code}`);
    } finally { setBusy(null); }
  };

  const finish = () => { onDone(); };

  return (
    <div className="surface-card p-5 space-y-5">
      <ol className="flex items-center gap-2 text-xs text-muted-foreground">
        {(["creds", "session", "connect", "done"] as const).map((s, i, arr) => (
          <li key={s} className={`flex items-center gap-2 ${s === step ? "text-foreground font-medium" : ""}`}>
            <span className={`h-5 w-5 rounded-full grid place-items-center text-[10px] border ${arr.indexOf(step) >= i ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>{i + 1}</span>
            {["Credenciais", "Preparar número", "Conectar", "Concluído"][i]}
            {i < 3 && <ArrowRight className="h-3 w-3 opacity-50" />}
          </li>
        ))}
      </ol>

      {step === "creds" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Informe o endereço do servidor do WhatsApp e a chave de acesso fornecida pelo provedor.</p>
          <label className="block">
            <span className="text-xs font-medium">Endereço do servidor</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…"
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" autoComplete="off" />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Chave de acesso</span>
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="•••"
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm" autoComplete="off" />
          </label>
          {tested && (
            <p className="text-xs text-muted-foreground">
              Teste: {tested.code === "ok" ? `respondeu em ${tested.latency_ms ?? 0}ms` : (ERR_HINT[tested.code ?? ""] ?? "sem sucesso")}
            </p>
          )}
          <button onClick={testAndSave} disabled={busy !== null}
            className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-medium disabled:opacity-50">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />} Testar e salvar
          </button>
        </div>
      )}

      {step === "session" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Vamos preparar o número oficial e o canal de recebimento. Essa etapa é idempotente.</p>
          <button onClick={setupSession} disabled={busy !== null}
            className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-medium disabled:opacity-50">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />} Preparar número
          </button>
        </div>
      )}

      {step === "connect" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Escaneie o código abaixo no aparelho de destino.</p>
          {snap && (
            <div className="flex items-center gap-2"><StatusChip view={mapWhatsAppStatus(snap.status)} /></div>
          )}
          {qr ? (
            <div className="rounded-xl border border-border bg-white p-4 grid place-items-center">
              <img src={`data:${qr.mimeType};base64,${qr.base64}`} alt="QR de conexão" className="max-w-[240px]" />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Preparando código de conexão…</p>
          )}
        </div>
      )}

      {step === "done" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="h-5 w-5" />
            <p className="text-sm font-medium">WhatsApp conectado.</p>
          </div>
          <button onClick={finish}
            className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-medium">
            Ir para o painel
          </button>
        </div>
      )}
    </div>
  );
}

export function WhatsAppSessionPanel() {
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [snap, setSnap] = useState<SessionSnap | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [replacing, setReplacing] = useState(false);

  const refresh = async () => {
    try {
      const c = await call<ConfigStatus>("config_status");
      setConfig(c);
      const s = await call<SessionSnap>("status");
      setSnap(s);
    } catch (e) {
      const fe = mapAdminActionError(e);
      toast.error(`${fe.title} · ${fe.code}`);
    }
  };

  useEffect(() => { refresh(); }, []);

  const run = async (action: string, label: string) => {
    setBusy(action);
    try {
      const r = await call<{ ok?: boolean }>(action);
      if (r?.ok === false) throw new Error("action_failed");
      toast.success(label);
      await refresh();
    } catch (e) {
      const fe = mapAdminActionError(e);
      toast.error(`${fe.title} · ${fe.code}`);
    } finally { setBusy(null); }
  };

  const view = mapWhatsAppStatus(snap?.status);
  const notConfigured = !config?.configured || snap?.status === "not_configured";
  const canSend = snap?.capabilities?.can_send === true;
  const needsSession = snap?.capabilities?.needs_session === true;
  const isOwner = config?.role === "platform_owner";

  if (wizard || (notConfigured && !config)) {
    return <WhatsAppSetupWizard onDone={() => { setWizard(false); setReplacing(false); refresh(); }} />;
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <StatusChip view={view} />
          <span className="text-xs text-muted-foreground">
            {snap?.phone_masked ?? "sem telefone conectado"}
          </span>
        </div>
        <button onClick={refresh}
          className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs hover:bg-accent">
          <RefreshCw className="h-3 w-3" /> Atualizar
        </button>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{view.impact}</p>

      {notConfigured ? (
        <div className="surface-card p-5 space-y-3">
          <div className="flex items-start gap-3">
            <LockKeyhole className="h-5 w-5 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-semibold">Configurar conexão</p>
              <p className="text-xs text-muted-foreground mt-1">
                Nenhuma credencial cadastrada ainda. Um dono da plataforma pode conectar em poucos passos.
              </p>
            </div>
          </div>
          <button onClick={() => setWizard(true)} disabled={!isOwner}
            className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-medium disabled:opacity-50">
            Configurar conexão
          </button>
          {!isOwner && <p className="text-[11px] text-muted-foreground">Apenas o dono da plataforma pode fazer essa configuração.</p>}
        </div>
      ) : (
        <div className="surface-card p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 text-emerald-700">
              <ShieldCheck className="h-3 w-3" /> Credenciais configuradas
            </span>
            {config?.updated_at && <span>· atualizadas {humanizeRelative(config.updated_at)}</span>}
            {snap?.last_seen_at && <span>· última verificação {humanizeRelative(snap.last_seen_at)}</span>}
          </div>

          <div className="flex flex-wrap gap-2">
            {needsSession && (
              <button onClick={() => run("setup_session", "Conexão iniciada.")} disabled={!!busy}
                className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-medium disabled:opacity-50">
                {busy === "setup_session" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                Conectar WhatsApp
              </button>
            )}

            {canSend && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button disabled={!!busy} className="inline-flex items-center gap-1 rounded-full border border-amber-200 text-amber-800 px-3 py-1.5 text-xs hover:bg-amber-50 disabled:opacity-50">
                    Reiniciar
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reiniciar o canal?</AlertDialogTitle>
                    <AlertDialogDescription>O atendimento ficará indisponível por alguns segundos.</AlertDialogDescription>
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
                  <button disabled={!!busy} className="inline-flex items-center gap-1 rounded-full border border-red-200 text-red-700 px-3 py-1.5 text-xs hover:bg-red-50 disabled:opacity-50">
                    Desconectar
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Desconectar o canal?</AlertDialogTitle>
                    <AlertDialogDescription>Será preciso conectar de novo escaneando o QR.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => run("logout", "Canal desconectado.")}>Desconectar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>

          {isOwner && (
            <div className="pt-3 border-t border-border/60">
              <AlertDialog open={replacing} onOpenChange={setReplacing}>
                <AlertDialogTrigger asChild>
                  <button className="text-xs text-muted-foreground underline">Substituir credenciais</button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Substituir credenciais do WhatsApp?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Isso desconecta o canal atual e exige informar novas credenciais no próximo passo. Nenhum vínculo dos usuários será apagado.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => { setReplacing(false); setWizard(true); }}>
                      Substituir agora
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
