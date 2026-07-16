import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ShieldCheck, RefreshCw, ArrowRight, CheckCircle2, LockKeyhole, X, AlertTriangle, QrCode, Smartphone, Copy } from "lucide-react";
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
  admin_role?: string | null;
  can_manage_config?: boolean;
};

type SessionSnap = {
  status: string;
  capabilities: { can_connect: boolean; can_send: boolean; needs_session: boolean; temporarily_unavailable: boolean };
  phone_masked: string | null;
  last_seen_at: string | null;
  latency_ms: number | null;
  error_code: string | null;
};

type WizardMode = "initial" | "replace";
type WizardStep = "creds" | "session" | "connect" | "done";

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

const WIZARD_STORAGE_KEY = "nc:wa-wizard";

const PAIRING_RETRY_CODES = new Set(["qr_not_ready", "prepare_failed"]);

function canManageFromConfig(config: ConfigStatus | null): boolean {
  return config?.can_manage_config === true || config?.admin_role === "platform_owner";
}

type WizardPersisted = { url?: string; step?: WizardStep; mode?: WizardMode };

function readWizardPersisted(): WizardPersisted {
  try {
    const raw = sessionStorage.getItem(WIZARD_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as WizardPersisted;
    return { url: typeof parsed.url === "string" ? parsed.url : undefined, step: parsed.step, mode: parsed.mode };
  } catch { return {}; }
}

function writeWizardPersisted(v: WizardPersisted) {
  try { sessionStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify({ url: v.url, step: v.step, mode: v.mode })); } catch { /* ignore */ }
}

function clearWizardPersisted() {
  try { sessionStorage.removeItem(WIZARD_STORAGE_KEY); } catch { /* ignore */ }
}

export function WhatsAppSetupWizard({ mode = "initial", onDone, onCancel }: { mode?: WizardMode; onDone: () => void; onCancel: () => void }) {
  const persisted = useRef(readWizardPersisted()).current;
  const [step, setStep] = useState<WizardStep>(persisted.step && persisted.mode === mode ? persisted.step : "creds");
  const [url, setUrl] = useState(persisted.mode === mode ? persisted.url ?? "" : "");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [tested, setTested] = useState<{ latency_ms?: number; code?: string } | null>(null);
  const [snap, setSnap] = useState<SessionSnap | null>(null);
  const [qr, setQr] = useState<{ mimeType: string; base64: string } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const submittingRef = useRef(false);

  // Persist only URL + step + mode. Never the api key.
  useEffect(() => { writeWizardPersisted({ url, step, mode }); }, [url, step, mode]);

  useEffect(() => {
    if (step !== "connect") return;
    let cancelled = false;
    const start = Date.now();
    const iv = setInterval(async () => {
      try {
        const s = await call<SessionSnap>("status");
        if (cancelled) return;
        setSnap(s);
        if (s.status === "connected") { clearInterval(iv); setQr(null); setStep("done"); return; }
        if (s.status === "awaiting_qr") {
          const r = await call<{ ok: boolean; mimeType?: string; base64?: string }>("qr");
          if (cancelled) return;
          if (r.ok && r.base64) setQr({ mimeType: r.mimeType ?? "image/png", base64: r.base64 });
        }
      } catch { /* silent */ }
      if (Date.now() - start > 3 * 60_000) clearInterval(iv);
    }, 3000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [step]);

  const testAndSave = async () => {
    if (submittingRef.current) return;
    if (!/^https:\/\//i.test(url)) { toast.error(ERR_HINT.invalid_scheme); return; }
    if (apiKey.trim().length < 4) { toast.error(ERR_HINT.invalid_api_key); return; }
    submittingRef.current = true;
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
      setApiKey(""); // scrub from memory
      setStep("session");
    } catch (e) {
      const fe = mapAdminActionError(e);
      toast.error(`${fe.title} · ${fe.code}`);
    } finally { setBusy(null); submittingRef.current = false; }
  };

  const setupSession = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setBusy("session");
    try {
      const r = await call<{ ok: boolean; status?: string; error_code?: string }>("setup_session");
      if (!r.ok) { toast.error(ERR_HINT[r.error_code ?? ""] ?? "Não consegui preparar o número."); return; }
      toast.success("Número preparado.");
      if (r.status === "connected") { setStep("done"); return; }
      setStep("connect");
    } catch (e) {
      const fe = mapAdminActionError(e);
      toast.error(`${fe.title} · ${fe.code}`);
    } finally { setBusy(null); submittingRef.current = false; }
  };

  const finish = () => { clearWizardPersisted(); onDone(); };
  const tryCancel = () => {
    if ((url || apiKey) && step === "creds") { setConfirmClose(true); return; }
    clearWizardPersisted();
    onCancel();
  };

  return (
    <div className="surface-card p-5 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <ol className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {(["creds", "session", "connect", "done"] as const).map((s, i, arr) => (
            <li key={s} className={`flex items-center gap-2 ${s === step ? "text-foreground font-medium" : ""}`}>
              <span className={`h-5 w-5 rounded-full grid place-items-center text-[10px] border ${arr.indexOf(step) >= i ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}>{i + 1}</span>
              {["Credenciais", "Preparar número", "Conectar", "Concluído"][i]}
              {i < 3 && <ArrowRight className="h-3 w-3 opacity-50" />}
            </li>
          ))}
        </ol>
        {step !== "done" && (
          <button onClick={tryCancel} aria-label="Fechar" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {mode === "replace" && step === "creds" && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <AlertTriangle className="h-3 w-3" /> Você está substituindo as credenciais atuais.
        </div>
      )}

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
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setStep("creds")} disabled={busy !== null}
              className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs">
              Voltar
            </button>
            <button onClick={setupSession} disabled={busy !== null}
              className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-medium disabled:opacity-50">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />} Preparar número
            </button>
          </div>
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

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar dados preenchidos?</AlertDialogTitle>
            <AlertDialogDescription>Você digitou informações que ainda não foram salvas.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar preenchendo</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmClose(false); clearWizardPersisted(); onCancel(); }}>Descartar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type PairingMethod = "qr" | "code";

type QrPayload = { mimeType: string; base64: string; expiresAt: number };

function ConnectDeviceCard({
  status,
  onConnected,
}: {
  status: string | undefined;
  onConnected: () => void;
}) {
  const [method, setMethod] = useState<PairingMethod>("qr");
  const [qr, setQr] = useState<QrPayload | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const preparedRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const needsReset = status === "disconnected" || status === "needs_attention" || status === "unavailable";

  const resetSession = useCallback(async () => {
    if (resetting) return;
    setResetting(true);
    setQrError(null);
    setCodeError(null);
    setQr(null);
    setPairingCode(null);
    try {
      const r = await call<{ ok: boolean; error_code?: string }>("reset_session");
      if (!r.ok) toast.error("Não consegui redefinir a sessão.");
      else toast.success("Sessão redefinida. Escaneie o QR ou peça o código.");
    } catch {
      toast.error("Falha ao redefinir a sessão.");
    } finally {
      if (alive.current) setResetting(false);
    }
  }, [resetting]);


  const generateQr = useCallback(async () => {
    setQrBusy(true);
    setQrError(null);
    setQr(null);
    try {
      let r = await call<{ ok: boolean; qr?: string; mime_type?: string; expires_at?: string; error_code?: string; connected?: boolean }>("begin_qr");
      if (r.connected) { if (alive.current) onConnected(); return; }

      if ((!r.ok || !r.qr) && PAIRING_RETRY_CODES.has(r.error_code ?? "")) {
        await call<{ ok: boolean }>("prepare_pairing").catch(() => ({ ok: false }));
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 900));
          r = await call<{ ok: boolean; qr?: string; mime_type?: string; expires_at?: string; error_code?: string; connected?: boolean }>("begin_qr");
          if (r.connected || (r.ok && r.qr)) break;
        }
      }

      if (!alive.current) return;
      if (r.connected) { onConnected(); return; }
      if (!r.ok || !r.qr) { setQrError("qr_unavailable"); return; }
      const expiresAt = r.expires_at ? new Date(r.expires_at).getTime() : Date.now() + 60_000;
      setQr({ mimeType: r.mime_type ?? "image/png", base64: r.qr, expiresAt });
    } catch {
      if (alive.current) setQrError("network");
    } finally {
      if (alive.current) setQrBusy(false);
    }
  }, [onConnected]);

  // Poll status while awaiting pairing; refresh QR when it expires.
  useEffect(() => {
    if (status === "connected") { onConnected(); return; }
    const iv = setInterval(async () => {
      try {
        const s = await call<SessionSnap>("status");
        if (!alive.current) return;
        if (s.status === "connected") { onConnected(); return; }
      } catch { /* keep UI stable on transient errors */ }
      // Refresh QR if expired (only if we still have one shown)
      if (method === "qr" && qr && Date.now() > qr.expiresAt - 2000) {
        void generateQr();
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [status, method, qr, generateQr, onConnected]);

  const requestCode = async () => {
    if (codeBusy) return;
    setCodeBusy(true);
    setCodeError(null);
    setPairingCode(null);
    try {
      const r = await call<{ ok: boolean; pairing_code?: string; error_code?: string }>("request_pairing_code", { to: phone });
      if (!alive.current) return;
      if (!r.ok || !r.pairing_code) {
        setCodeError(r.error_code ?? "provider_error");
        return;
      }
      setPairingCode(r.pairing_code);
    } catch {
      if (alive.current) setCodeError("network");
    } finally {
      if (alive.current) setCodeBusy(false);
    }
  };

  const copyCode = async () => {
    if (!pairingCode) return;
    try { await navigator.clipboard.writeText(pairingCode); toast.success("Código copiado."); }
    catch { toast.error("Não consegui copiar."); }
  };

  return (
    <div className="surface-card p-5 space-y-4">
      <div className="flex items-start gap-3">
        <Smartphone className="h-5 w-5 text-primary mt-0.5" />
        <div>
          <p className="text-sm font-semibold">Conectar aparelho</p>
          <p className="text-xs text-muted-foreground mt-1">
            Escolha como quer conectar o WhatsApp oficial do NoControle.
          </p>
        </div>
      </div>

      {needsReset && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex flex-wrap items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-700" />
          <p className="text-xs text-amber-800 flex-1 min-w-[180px]">
            A sessão está fora do ar. Redefina para gerar um novo QR ou código.
          </p>
          <button
            onClick={resetSession}
            disabled={resetting}
            className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {resetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Redefinir sessão
          </button>
        </div>
      )}

      <div role="tablist" aria-label="Método de conexão" className="inline-flex rounded-full border border-border p-1 text-xs">
        <button
          role="tab" aria-selected={method === "qr"}
          onClick={() => setMethod("qr")}
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 ${method === "qr" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          <QrCode className="h-3 w-3" /> QR Code
        </button>
        <button
          role="tab" aria-selected={method === "code"}
          onClick={() => {
            setMethod("code");
            if (!preparedRef.current) {
              preparedRef.current = true;
              void call("prepare_pairing").catch(() => { /* best effort */ });
            }
          }}
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 ${method === "code" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
        >
          <Smartphone className="h-3 w-3" /> Código pelo telefone
        </button>
      </div>


      {method === "qr" && (
        <div className="rounded-xl border border-border bg-white p-4 space-y-3">
          <p className="text-xs text-muted-foreground">Escaneie este QR Code no WhatsApp: Aparelhos conectados → Conectar um aparelho.</p>
          <div className="grid place-items-center min-h-[240px]">
            {qr ? (
              <img src={`data:${qr.mimeType};base64,${qr.base64}`} alt="QR de conexão" className="max-w-[240px]" />
            ) : qrBusy ? (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Gerando QR Code…
              </p>
            ) : qrError ? (
              <div className="space-y-2 text-center">
                <p className="text-xs text-red-600">Não consegui gerar o QR Code agora.</p>
                <button
                  onClick={() => { void generateQr(); }}
                  className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs hover:bg-accent"
                >
                  <RefreshCw className="h-3 w-3" /> Tentar novamente
                </button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Clique em Gerar QR Code para iniciar.</p>
            )}
          </div>
          <button
            onClick={() => { setQr(null); setQrError(null); void generateQr(); }}
            disabled={qrBusy}
            className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
          >
            {qrBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {qr ? "Gerar outro QR Code" : "Gerar QR Code"}
          </button>
        </div>
      )}

      {method === "code" && (
        <div className="rounded-xl border border-border bg-white p-4 space-y-3">
          <p className="text-xs text-muted-foreground">
            Informe o número do WhatsApp. No aparelho: <strong>Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone</strong>.
          </p>
          <label className="block">
            <span className="text-xs font-medium">Número do WhatsApp</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="(11) 99999-9999"
              inputMode="tel"
              className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
              autoComplete="off"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={requestCode}
              disabled={codeBusy || phone.trim().length < 10}
              className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-medium disabled:opacity-50"
            >
              {codeBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Smartphone className="h-3 w-3" />} Gerar código
            </button>
            <button
              onClick={() => setMethod("qr")}
              className="text-xs text-muted-foreground underline"
            >
              Tentar com QR Code
            </button>
          </div>
          {pairingCode && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
              <p className="text-xs text-muted-foreground">Digite este código no WhatsApp:</p>
              <div className="flex items-center gap-3">
                <code className="text-2xl font-mono tracking-[0.35em] font-semibold text-primary">
                  {pairingCode}
                </code>
                <button
                  onClick={copyCode}
                  aria-label="Copiar código"
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs hover:bg-accent"
                >
                  <Copy className="h-3 w-3" /> Copiar
                </button>
              </div>
            </div>
          )}
          {codeError && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1">
              {codeError === "method_unsupported" ? (
                <p>Este servidor ainda não suporta o código por telefone. Use o <button className="underline" onClick={() => setMethod("qr")}>QR Code</button>.</p>
              ) : codeError === "passkey_required" ? (
                <p>O WhatsApp exige uma chave de acesso neste número. Habilite pelo aparelho ou use o QR Code.</p>
              ) : codeError === "passkey_confirmation_required" ? (
                <p>Confirme a chave de acesso no aparelho e tente de novo.</p>
              ) : codeError === "rate_limited" ? (
                <p>Muitas tentativas. Aguarde alguns instantes.</p>
              ) : codeError === "invalid_phone" ? (
                <p>Número inválido. Confira DDI e DDD.</p>
              ) : (
                <p>Não consegui gerar o código agora. Você pode usar o <button className="underline" onClick={() => setMethod("qr")}>QR Code</button>.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InboundHealthCard({ onSync }: { onSync: () => void | Promise<void> }) {
  const [state, setState] = useState<{ status: "healthy" | "needs_attention"; last_inbound_at: string | null; count_24h: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rpc = (supabase as any)?.rpc;
      const { data } = typeof rpc === "function"
        ? await supabase.rpc("admin_whatsapp_inbound_health")
        : { data: null };
      setState((data as any) ?? null);
    } catch {
      setState(null);
    }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  const healthy = state?.status === "healthy";
  return (
    <div className="surface-card p-4 flex flex-wrap items-center gap-3">
      <div className={`h-2 w-2 rounded-full ${healthy ? "bg-emerald-500" : "bg-amber-500"}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {loading ? "Verificando entrada de mensagens…" : healthy ? "Recebendo mensagens" : "Precisa de atenção"}
        </p>
        <p className="text-xs text-muted-foreground">
          {state?.last_inbound_at
            ? `Última recebida ${humanizeRelative(state.last_inbound_at)} · ${state.count_24h} nas últimas 24h`
            : "Nenhuma mensagem recebida nas últimas 24h."}
        </p>
      </div>
      <button
        onClick={async () => { setSyncing(true); try { await onSync(); await load(); } finally { setSyncing(false); } }}
        disabled={syncing}
        className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
      >
        {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Sincronizar webhook
      </button>
    </div>
  );
}

export function WhatsAppSessionPanel() {
  const [config, setConfig] = useState<ConfigStatus | null>(null);
  const [snap, setSnap] = useState<SessionSnap | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [wizardMode, setWizardMode] = useState<WizardMode>("initial");
  const [replacing, setReplacing] = useState(false);

  const loadConfig = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setConfigLoading(true);
    setConfigError(null);
    try {
      const c = await call<ConfigStatus>("config_status");
      if (!c || typeof c.configured !== "boolean") {
        setConfigError("invalid_contract");
        return;
      }
      setConfig(c);
      try {
        const s = await call<SessionSnap>("status");
        setSnap(s);
      } catch { /* status pode falhar mesmo com config ok */ }
    } catch (e) {
      const fe = mapAdminActionError(e);
      setConfigError(fe.code);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") loadConfig({ silent: true }); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loadConfig]);

  const refresh = useCallback(() => loadConfig({ silent: true }), [loadConfig]);

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

  // Wizard is the only rendering path controlled by an explicit flag.
  if (wizard) {
    return (
      <WhatsAppSetupWizard
        mode={wizardMode}
        onDone={() => { setWizard(false); setWizardMode("initial"); refresh(); }}
        onCancel={() => { setWizard(false); setWizardMode("initial"); }}
      />
    );
  }

  if (configLoading) {
    return (
      <section className="space-y-4">
        <div className="surface-card p-5" aria-busy="true" aria-label="Carregando status">
          <div className="animate-pulse space-y-2">
            <div className="h-4 w-32 rounded bg-muted" />
            <div className="h-3 w-56 rounded bg-muted/70" />
          </div>
        </div>
        <ConnectDeviceCard status={snap?.status} onConnected={refresh} />
      </section>
    );
  }

  if (configError) {
    return (
      <section className="space-y-4">
        <div className="surface-card p-5 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
            <div>
              <p className="text-sm font-semibold">Não consegui carregar o status</p>
              <p className="text-xs text-muted-foreground mt-1">Verifique sua conexão e tente novamente.</p>
            </div>
          </div>
          <button onClick={() => loadConfig()}
            className="inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs hover:bg-accent">
            <RefreshCw className="h-3 w-3" /> Tentar novamente
          </button>
        </div>
        <ConnectDeviceCard status={snap?.status} onConnected={refresh} />
      </section>
    );
  }

  const view = mapWhatsAppStatus(snap?.status);
  const notConfigured = !config?.configured;
  const canSend = snap?.capabilities?.can_send === true;
  const canManageConfig = canManageFromConfig(config);
  const isConnected = snap?.status === "connected";

  if (notConfigured) {
    return (
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
        <button onClick={() => { setWizardMode("initial"); setWizard(true); }} disabled={!canManageConfig}
          className="inline-flex items-center gap-1 rounded-full bg-primary text-primary-foreground px-4 py-2 text-xs font-medium disabled:opacity-50">
          Configurar conexão
        </button>
        {!canManageConfig && <p className="text-[11px] text-muted-foreground">Apenas o dono da plataforma pode fazer essa configuração.</p>}
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
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
      <p className="text-sm text-muted-foreground">{view.impact}</p>

      <InboundHealthCard onSync={async () => {
        try {
          const r = await call<{ ok: boolean }>("sync_webhook");
          if (r?.ok) toast.success("Webhook sincronizado.");
          else toast.error("Não consegui sincronizar o webhook.");
        } catch { toast.error("Não consegui sincronizar o webhook."); }
      }} />

      {!isConnected && (
        <ConnectDeviceCard status={snap?.status} onConnected={refresh} />
      )}

      <div className="surface-card p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1 text-emerald-700">
            <ShieldCheck className="h-3 w-3" /> Credenciais configuradas
          </span>
          {config?.updated_at && <span>· atualizadas {humanizeRelative(config.updated_at)}</span>}
          {snap?.last_seen_at && <span>· última verificação {humanizeRelative(snap.last_seen_at)}</span>}
        </div>

        {isConnected && (
          <div className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            <p className="text-sm">Canal conectado{snap?.phone_masked ? ` (${snap.phone_masked})` : ""}.</p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
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

        {canManageConfig && (
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
                  <AlertDialogAction onClick={() => { setReplacing(false); setWizardMode("replace"); setWizard(true); }}>
                    Substituir agora
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
    </section>
  );
}
