import { useEffect, useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { biometricAvailability, biometricEnabled, setBiometricEnabled } from "@/lib/native/session";
import { isNativePlatform } from "@/lib/native/platform";

export function NativeSecurityCard() {
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isNativePlatform()) return;
    void Promise.all([biometricAvailability(), biometricEnabled()]).then(([ok, on]) => {
      setAvailable(ok); setEnabled(on);
    });
  }, []);
  if (!isNativePlatform() || !available) return null;
  async function toggle() {
    setBusy(true);
    try {
      await setBiometricEnabled(!enabled);
      setEnabled(!enabled);
      toast.success(!enabled ? "Proteção biométrica ativada" : "Proteção biométrica desativada");
    } catch { toast.error("Não foi possível alterar a biometria"); }
    finally { setBusy(false); }
  }
  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
      <div className="flex items-center gap-3">
        <Fingerprint className="h-5 w-5 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Desbloqueio biométrico</h2>
          <p className="text-xs text-muted-foreground">
            Ao abrir o app, pedimos Face ID ou Touch ID. Se você cancelar, a sessão continua salva e você pode
            desbloquear depois ou entrar com e-mail e senha.
          </p>
        </div>
        <button type="button" onClick={toggle} disabled={busy} className="rounded-full border border-border bg-background px-4 py-2 text-sm font-medium disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : enabled ? "Desativar" : "Ativar"}
        </button>
      </div>
    </div>
  );
}