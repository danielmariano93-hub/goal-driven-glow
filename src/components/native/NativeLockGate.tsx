import { useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const REASON_TEXT: Record<string, string> = {
  cancelled: "Desbloqueio cancelado. Você pode tentar de novo ou entrar com e-mail e senha.",
  failed: "Não reconhecemos sua biometria. Tente novamente ou entre com e-mail e senha.",
  not_enrolled: "Não há biometria configurada neste aparelho. Entre com e-mail e senha.",
  unavailable: "A biometria não está disponível agora. Entre com e-mail e senha.",
};

/**
 * Tela de bloqueio do app nativo. A sessão continua válida no Secure Storage:
 * cancelar o Face ID não faz logout, apenas mantém o conteúdo protegido.
 */
export function NativeLockGate() {
  const { locked, lockReason, unlock, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!locked) return null;

  async function tryUnlock() {
    setBusy(true);
    try {
      await unlock();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 bg-background px-8 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
        <Fingerprint size={30} />
      </div>
      <div className="space-y-2">
        <h1 className="text-lg font-semibold text-foreground">Meu Nino está bloqueado</h1>
        <p className="text-sm text-muted-foreground">
          {REASON_TEXT[lockReason ?? ""] ?? "Confirme sua identidade para ver seus dados financeiros."}
        </p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-2">
        <button
          type="button"
          onClick={tryUnlock}
          disabled={busy}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />}
          Desbloquear
        </button>
        <button
          type="button"
          onClick={() => void signOut()}
          className="inline-flex h-11 items-center justify-center rounded-xl border border-border text-sm font-medium text-foreground"
        >
          Usar e-mail e senha
        </button>
      </div>
    </div>
  );
}
