import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, QrCode, Smartphone, Copy, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { StatusChip } from "@/components/admin/StatusChip";
import { mapWhatsAppStatus, mapPairingError } from "@/lib/admin/statusMapper";

type PairingMethod = "qr" | "code";
type QrPayload = { mimeType: string; base64: string; expiresAt: number };

const RETRY_CODES = new Set(["qr_not_ready", "prepare_failed"]);

async function call<T>(action: string, extra?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("whatsapp-session", { body: { action, ...(extra ?? {}) } });
  if (error) throw error;
  return data as T;
}

type BeginQr = { ok: boolean; qr?: string; mime_type?: string; expires_at?: string; error_code?: string; connected?: boolean };

export function WhatsAppPairingDialog({
  open,
  onOpenChange,
  status,
  onConnected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: string | undefined;
  onConnected: () => void;
}) {
  const [method, setMethod] = useState<PairingMethod>("qr");
  const [liveStatus, setLiveStatus] = useState<string | undefined>(status);
  const [qr, setQr] = useState<QrPayload | null>(null);
  const [qrBusy, setQrBusy] = useState(false);
  const [qrStage, setQrStage] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [succeeded, setSucceeded] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const preparedRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => { setLiveStatus(status); }, [status]);

  // Reset local state whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    alive.current = true;
    preparedRef.current = false;
    setMethod("qr");
    setQr(null);
    setQrError(null);
    setQrStage(null);
    setPairingCode(null);
    setCodeError(null);
    setSucceeded(false);
    setSecondsLeft(null);
  }, [open]);

  const finishConnected = useCallback(() => {
    if (succeeded) return;
    setSucceeded(true);
    setQr(null);
    setQrError(null);
    setCodeError(null);
    window.setTimeout(() => {
      onOpenChange(false);
      onConnected();
    }, 1500);
  }, [succeeded, onConnected, onOpenChange]);

  const generateQr = useCallback(async () => {
    setQrBusy(true);
    setQrError(null);
    setQr(null);
    setQrStage("Gerando QR Code…");
    try {
      let r = await call<BeginQr>("begin_qr");
      if (r.connected) { if (alive.current) finishConnected(); return; }

      if ((!r.ok || !r.qr) && RETRY_CODES.has(r.error_code ?? "")) {
        if (alive.current) setQrStage("Preparando a sessão…");
        await call<{ ok: boolean }>("prepare_pairing").catch(() => ({ ok: false }));
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 900));
          if (alive.current) setQrStage(`Tentando novamente (${attempt + 1}/4)…`);
          r = await call<BeginQr>("begin_qr");
          if (r.connected || (r.ok && r.qr)) break;
        }
      }

      if (!alive.current) return;
      if (r.connected) { finishConnected(); return; }
      if (!r.ok || !r.qr) { setQrError(r.error_code || "qr_unavailable"); return; }
      const expiresAt = r.expires_at ? new Date(r.expires_at).getTime() : Date.now() + 60_000;
      setQr({ mimeType: r.mime_type ?? "image/png", base64: r.qr, expiresAt });
    } catch {
      if (alive.current) setQrError("network");
    } finally {
      if (alive.current) { setQrBusy(false); setQrStage(null); }
    }
  }, [finishConnected]);

  // Validate current status as soon as the dialog opens, then auto-start QR.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await call<{ status: string }>("status");
        if (cancelled) return;
        setLiveStatus(s.status);
        if (s.status === "connected") { finishConnected(); return; }
      } catch { /* mantém o estado conhecido */ }
      if (!cancelled) void generateQr();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Poll status + refresh expired QR only while the dialog is open.
  useEffect(() => {
    if (!open || succeeded) return;
    const iv = setInterval(async () => {
      try {
        const s = await call<{ status: string }>("status");
        if (!alive.current) return;
        setLiveStatus(s.status);
        if (s.status === "connected") { finishConnected(); return; }
      } catch { /* transiente */ }
      if (method === "qr" && qr && Date.now() > qr.expiresAt - 2000 && !qrBusy) {
        void generateQr();
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [open, succeeded, method, qr, qrBusy, generateQr, finishConnected]);

  // Countdown for the visible QR.
  useEffect(() => {
    if (!qr) { setSecondsLeft(null); return; }
    const tick = () => setSecondsLeft(Math.max(0, Math.round((qr.expiresAt - Date.now()) / 1000)));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [qr]);

  const resetSession = useCallback(async () => {
    if (resetting) return;
    setResetting(true);
    setQrError(null);
    setCodeError(null);
    setQr(null);
    setPairingCode(null);
    try {
      const r = await call<{ ok: boolean }>("reset_session");
      if (!r.ok) { toast.error("Não consegui redefinir a sessão."); return; }
      toast.success("Sessão redefinida.");
      if (alive.current && method === "qr") void generateQr();
    } catch {
      toast.error("Falha ao redefinir a sessão.");
    } finally {
      if (alive.current) setResetting(false);
    }
  }, [resetting, method, generateQr]);

  const requestCode = async () => {
    if (codeBusy) return;
    setCodeBusy(true);
    setCodeError(null);
    setPairingCode(null);
    try {
      const r = await call<{ ok: boolean; pairing_code?: string; error_code?: string }>("request_pairing_code", { to: phone });
      if (!alive.current) return;
      if (!r.ok || !r.pairing_code) { setCodeError(r.error_code ?? "provider_error"); return; }
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

  const statusView = mapWhatsAppStatus(succeeded ? "connected" : liveStatus);
  const needsReset = !succeeded && ["disconnected", "needs_attention", "unavailable"].includes(liveStatus ?? "");

  const renderError = (code: string, onRetry: () => void) => {
    const e = mapPairingError(code);
    return (
      <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs text-foreground space-y-2">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">{e.title}</p>
            <p className="mt-0.5 text-foreground">{e.description}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {e.action === "retry" && (
            <button onClick={onRetry} className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-card px-3 py-1.5 hover:bg-warning/15">
              <RefreshCw className="h-3 w-3" /> Tentar novamente
            </button>
          )}
          {e.action === "switch_qr" && (
            <button onClick={() => setMethod("qr")} className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-card px-3 py-1.5 hover:bg-warning/15">
              <QrCode className="h-3 w-3" /> Usar QR Code
            </button>
          )}
          {e.action === "reset" && (
            <button onClick={resetSession} disabled={resetting} className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-card px-3 py-1.5 hover:bg-warning/15 disabled:opacity-50">
              {resetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Redefinir sessão
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Conectar aparelho</DialogTitle>
          <DialogDescription>
            Escolha como quer conectar o WhatsApp oficial do MeuNino.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2">
          <StatusChip view={statusView} size="sm" />
          {!succeeded && <span className="text-[11px] text-muted-foreground">Verificando a cada 3s</span>}
        </div>

        {succeeded ? (
          <div className="rounded-xl border border-success/30 bg-success/10 p-6 text-center space-y-2">
            <CheckCircle2 className="mx-auto h-8 w-8 text-success" />
            <p className="text-sm font-semibold text-success">Aparelho conectado!</p>
            <p className="text-xs text-success">Fechando em instantes…</p>
          </div>
        ) : (
          <>
            {needsReset && (
              <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 flex flex-wrap items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-foreground" />
                <p className="text-xs text-foreground flex-1 min-w-[180px]">
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
              <div className="rounded-xl border border-border bg-background p-4 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Escaneie este QR Code no WhatsApp: <strong>Aparelhos conectados → Conectar um aparelho</strong>.
                </p>
                <div className="grid place-items-center min-h-[240px]">
                  {qr ? (
                    <div className="space-y-2 text-center">
                      <img src={`data:${qr.mimeType};base64,${qr.base64}`} alt="QR Code de conexão do WhatsApp" className="max-w-[240px] mx-auto" />
                      {secondsLeft !== null && (
                        <p className="text-[11px] text-muted-foreground">
                          {secondsLeft > 0 ? `Expira em ${secondsLeft}s — renovamos sozinhos.` : "Renovando o código…"}
                        </p>
                      )}
                    </div>
                  ) : qrBusy ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" /> {qrStage ?? "Gerando QR Code…"}
                    </p>
                  ) : qrError ? (
                    renderError(qrError, () => { void generateQr(); })
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
              <div className="rounded-xl border border-border bg-background p-4 space-y-3">
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
                  <button onClick={() => setMethod("qr")} className="text-xs text-muted-foreground underline">
                    Tentar com QR Code
                  </button>
                </div>
                {pairingCode && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
                    <p className="text-xs text-muted-foreground">Digite este código no WhatsApp:</p>
                    <div className="flex items-center gap-3">
                      <code className="text-2xl font-mono tracking-[0.35em] font-semibold text-primary">{pairingCode}</code>
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
                {codeError && renderError(codeError, () => { void requestCode(); })}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
