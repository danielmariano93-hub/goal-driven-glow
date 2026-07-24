import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Timeout de sessão por inatividade da interface — apenas frontend.
 * Não altera JWT, refresh token, config do Supabase nem duração de token.
 *
 * Persistência: `localStorage["mn.lastActivity"]` (ms epoch).
 * Sincronização multiaba: `BroadcastChannel("mn.session")`, fallback `storage`.
 * Motivo de logout: `sessionStorage["mn.logoutReason"] = "inactivity"`.
 *
 * Este hook é puro: chama `onSignOut()` para efetivamente encerrar a sessão
 * usando o mecanismo oficial do projeto (Supabase signOut).
 */

export const LAST_ACTIVITY_KEY = "mn.lastActivity";
export const LOGOUT_REASON_KEY = "mn.logoutReason";
const CHANNEL_NAME = "mn.session";

export type SessionInactivityOptions = {
  /** Timeout total em ms. Padrão 30 min. */
  idleMs?: number;
  /** Antecedência do aviso em ms. Padrão 2 min (aviso aos 28min). */
  warnMs?: number;
  /** Executa o signOut oficial do projeto. */
  onSignOut: () => Promise<void> | void;
  /** true se o usuário está autenticado. */
  enabled: boolean;
};

export type SessionInactivityState = {
  /** Modal de aviso visível. */
  warning: boolean;
  /** Segundos restantes até o logout enquanto o modal está visível. */
  secondsLeft: number;
  /** true durante a checagem inicial (retorno após dias/horas). */
  checkingStale: boolean;
  /** Continuar conectado (usuário clicou no botão principal). */
  keepAlive: () => void;
  /** Encerrar imediatamente (usuário clicou em "Sair agora"). */
  signOutNow: () => void;
};

type Timer = ReturnType<typeof setTimeout> | null;

export function useSessionInactivity(
  opts: SessionInactivityOptions,
): SessionInactivityState {
  const idleMs = opts.idleMs ?? 30 * 60 * 1000;
  const warnMs = opts.warnMs ?? 2 * 60 * 1000;
  const { enabled, onSignOut } = opts;

  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(Math.round(warnMs / 1000));
  const [checkingStale, setCheckingStale] = useState(enabled);

  const warnTimerRef = useRef<Timer>(null);
  const logoutTimerRef = useRef<Timer>(null);
  const tickRef = useRef<Timer>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const signingOutRef = useRef(false);
  const onSignOutRef = useRef(onSignOut);
  onSignOutRef.current = onSignOut;

  const now = () => Date.now();

  const readLast = useCallback((): number => {
    try {
      const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
      const parsed = raw ? Number.parseInt(raw, 10) : NaN;
      return Number.isFinite(parsed) ? parsed : 0;
    } catch {
      return 0;
    }
  }, []);

  const writeLast = useCallback((ts: number) => {
    try {
      localStorage.setItem(LAST_ACTIVITY_KEY, String(ts));
    } catch {
      /* storage indisponível */
    }
  }, []);

  const clearTimers = useCallback(() => {
    if (warnTimerRef.current) { clearTimeout(warnTimerRef.current); warnTimerRef.current = null; }
    if (logoutTimerRef.current) { clearTimeout(logoutTimerRef.current); logoutTimerRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }, []);

  const doSignOut = useCallback(async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    try {
      sessionStorage.setItem(LOGOUT_REASON_KEY, "inactivity");
    } catch { /* noop */ }
    try {
      channelRef.current?.postMessage({ type: "logout" });
    } catch { /* noop */ }
    try {
      localStorage.removeItem(LAST_ACTIVITY_KEY);
    } catch { /* noop */ }
    clearTimers();
    setWarning(false);
    await onSignOutRef.current();
  }, [clearTimers]);

  const scheduleFrom = useCallback(
    (last: number) => {
      clearTimers();
      const elapsed = now() - last;
      const untilWarn = idleMs - warnMs - elapsed;
      const untilLogout = idleMs - elapsed;

      if (untilLogout <= 0) {
        void doSignOut();
        return;
      }

      if (untilWarn > 0) {
        setWarning(false);
        warnTimerRef.current = setTimeout(() => {
          setWarning(true);
          setSecondsLeft(Math.max(1, Math.round(warnMs / 1000)));
          tickRef.current = setInterval(() => {
            const remaining = Math.max(
              0,
              Math.round((idleMs - (now() - readLast())) / 1000),
            );
            setSecondsLeft(remaining);
          }, 1000);
        }, untilWarn);
      } else {
        // Já dentro da janela de aviso
        setWarning(true);
        setSecondsLeft(Math.max(1, Math.round(untilLogout / 1000)));
        tickRef.current = setInterval(() => {
          const remaining = Math.max(
            0,
            Math.round((idleMs - (now() - readLast())) / 1000),
          );
          setSecondsLeft(remaining);
        }, 1000);
      }

      logoutTimerRef.current = setTimeout(() => {
        void doSignOut();
      }, untilLogout);
    },
    [clearTimers, doSignOut, idleMs, warnMs, readLast],
  );

  const registerActivity = useCallback(
    (silent = false) => {
      if (!enabled || signingOutRef.current) return;
      if (warning && !silent) {
        // Durante a janela de aviso, apenas o botão explícito estende a sessão.
        return;
      }
      const ts = now();
      writeLast(ts);
      try {
        channelRef.current?.postMessage({ type: "activity", ts });
      } catch { /* noop */ }
      scheduleFrom(ts);
    },
    [enabled, warning, writeLast, scheduleFrom],
  );

  const keepAlive = useCallback(() => {
    const ts = now();
    writeLast(ts);
    setWarning(false);
    try {
      channelRef.current?.postMessage({ type: "activity", ts });
    } catch { /* noop */ }
    scheduleFrom(ts);
  }, [writeLast, scheduleFrom]);

  const signOutNow = useCallback(() => {
    void doSignOut();
  }, [doSignOut]);

  // ---------- setup ----------
  useEffect(() => {
    if (!enabled) {
      clearTimers();
      setCheckingStale(false);
      setWarning(false);
      signingOutRef.current = false;
      return;
    }

    signingOutRef.current = false;

    // BroadcastChannel
    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        bc = new BroadcastChannel(CHANNEL_NAME);
        bc.onmessage = (ev) => {
          const data = ev.data as { type: string; ts?: number } | null;
          if (!data) return;
          if (data.type === "logout") {
            void doSignOut();
          } else if (data.type === "activity" && typeof data.ts === "number") {
            scheduleFrom(data.ts);
            setWarning(false);
          }
        };
        channelRef.current = bc;
      }
    } catch { /* noop */ }

    // Fallback storage event
    const onStorage = (e: StorageEvent) => {
      if (e.key === LAST_ACTIVITY_KEY && e.newValue) {
        const ts = Number.parseInt(e.newValue, 10);
        if (Number.isFinite(ts)) {
          scheduleFrom(ts);
          setWarning(false);
        }
      }
    };
    window.addEventListener("storage", onStorage);

    // Checagem inicial (retorno após horas/dias)
    setCheckingStale(true);
    const last = readLast();
    if (last && now() - last >= idleMs) {
      void doSignOut();
    } else {
      const anchor = last || now();
      writeLast(anchor);
      scheduleFrom(anchor);
    }
    setCheckingStale(false);

    // Listeners de atividade (throttle 15s p/ eventos frequentes)
    let lastRegister = 0;
    const THROTTLE_MS = 15_000;
    const activity = () => {
      const t = now();
      if (t - lastRegister < THROTTLE_MS) return;
      lastRegister = t;
      registerActivity();
    };
    const activityImmediate = () => {
      lastRegister = now();
      registerActivity();
    };

    // clique/toque/tecla/foco: imediato (baixa frequência)
    window.addEventListener("click", activityImmediate, { passive: true });
    window.addEventListener("keydown", activityImmediate);
    window.addEventListener("touchstart", activityImmediate, { passive: true });
    window.addEventListener("focusin", activityImmediate);
    // scroll/mousemove: throttled
    window.addEventListener("scroll", activity, { passive: true });
    window.addEventListener("mousemove", activity, { passive: true });

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const l = readLast();
      if (l && now() - l >= idleMs) {
        void doSignOut();
      } else {
        scheduleFrom(l || now());
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimers();
      window.removeEventListener("click", activityImmediate);
      window.removeEventListener("keydown", activityImmediate);
      window.removeEventListener("touchstart", activityImmediate);
      window.removeEventListener("focusin", activityImmediate);
      window.removeEventListener("scroll", activity);
      window.removeEventListener("mousemove", activity);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      if (bc) {
        try { bc.close(); } catch { /* noop */ }
      }
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, idleMs, warnMs]);

  return useMemo(
    () => ({ warning, secondsLeft, checkingStale, keepAlive, signOutNow }),
    [warning, secondsLeft, checkingStale, keepAlive, signOutNow],
  );
}
