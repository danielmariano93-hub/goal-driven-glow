import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { useSessionInactivity } from "@/hooks/useSessionInactivity";

/**
 * Guard de sessão por inatividade — monta apenas dentro da área autenticada.
 * - 30 min de inatividade → logout.
 * - Aviso aos 28 min com contagem regressiva de 2 min.
 * - Retorno após ≥30 min encerra antes de renderizar dados.
 * - Sincroniza logout entre abas.
 */
export function SessionInactivityGuard({
  children,
  idleMs,
  warnMs,
}: {
  children: React.ReactNode;
  /** Timeout total em ms (default 30min). Admin usa 20min. */
  idleMs?: number;
  /** Janela de aviso em ms (default 2min). Admin usa 2min. */
  warnMs?: number;
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const enabled = !!user;

  const {
    warning,
    secondsLeft,
    checkingStale,
    keepAlive,
    signOutNow,
  } = useSessionInactivity({
    enabled,
    idleMs,
    warnMs,
    onSignOut: async () => {
      await signOut();
      navigate("/login?reason=inactivity", { replace: true });
    },
  });

  const dialogRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  // Focus trap básico + foco inicial
  useEffect(() => {
    if (!warning) return;
    primaryRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Escape não fecha sem decisão
        e.preventDefault();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          "button, [href], [tabindex]:not([tabindex='-1'])",
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [warning]);

  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const timeStr = `${mm}:${ss}`;

  // Enquanto checagem inicial roda, evitamos flash de conteúdo se logout for iminente
  if (enabled && checkingStale) {
    return null;
  }

  return (
    <>
      {children}
      {warning && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="mn-inact-title"
          aria-describedby="mn-inact-desc"
          ref={dialogRef}
          className="fixed inset-0 z-[200] grid place-items-center bg-black/60 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border shadow-2xl p-6">
            <h2
              id="mn-inact-title"
              className="text-lg font-bold tracking-tight text-foreground"
            >
              Sua sessão vai expirar
            </h2>
            <p
              id="mn-inact-desc"
              className="mt-2 text-sm text-muted-foreground leading-relaxed"
            >
              Por segurança, você será desconectado em breve por inatividade.
            </p>
            <p
              aria-live="polite"
              aria-atomic="true"
              className="mt-4 text-2xl font-bold tabular-nums text-foreground"
            >
              {timeStr}
            </p>
            <div className="mt-6 flex flex-col gap-2">
              <button
                ref={primaryRef}
                type="button"
                onClick={keepAlive}
                className="w-full rounded-full bg-gradient-to-r from-[#6D4AFF] to-[#4338FF] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:opacity-95 transition"
              >
                Continuar conectado
              </button>
              <button
                type="button"
                onClick={signOutNow}
                className="w-full rounded-full border border-border bg-transparent px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/40 transition"
              >
                Sair agora
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
