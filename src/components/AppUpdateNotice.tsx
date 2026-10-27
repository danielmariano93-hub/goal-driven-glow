import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { checkForNewVersion } from "@/lib/appUpdate";

const MIN_GAP_MS = 2 * 60_000;
const POLL_MS = 10 * 60_000;

/** Avisa quando há versão nova publicada e deixa o usuário atualizar (sem recarregar sozinho). */
export function AppUpdateNotice() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let last = 0;
    let stopped = false;
    const run = async () => {
      if (stopped || Date.now() - last < MIN_GAP_MS) return;
      last = Date.now();
      if (await checkForNewVersion()) setAvailable(true);
    };
    const onVisible = () => { if (document.visibilityState === "visible") void run(); };
    const first = window.setTimeout(() => void run(), 8_000);
    const poll = window.setInterval(() => void run(), POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  if (!available) return null;
  return (
    <div
      role="status"
      data-testid="app-update-notice"
      className="fixed inset-x-0 z-[150] flex items-center justify-center gap-3 border-b border-border bg-primary px-4 py-2 text-xs text-primary-foreground"
      style={{ top: "env(safe-area-inset-top)" }}
    >
      <RefreshCw size={14} />
      <span>Nova versão do Nino disponível.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-full border border-primary-foreground/40 px-2 py-0.5 font-medium"
      >
        Atualizar
      </button>
    </div>
  );
}
