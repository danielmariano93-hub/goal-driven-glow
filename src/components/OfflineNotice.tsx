import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Estado amigável de ausência de conexão. Não simula sucesso de nada:
 * apenas avisa e oferece nova tentativa.
 */
export function OfflineNotice() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (online) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 z-[150] flex items-center justify-center gap-3 border-b border-border bg-secondary px-4 py-2 text-xs text-foreground"
      style={{ top: "env(safe-area-inset-top)" }}
    >
      <WifiOff size={14} className="text-muted-foreground" />
      <span>Sem conexão. Os dados podem estar desatualizados.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-full border border-border px-2 py-0.5 font-medium"
      >
        Tentar de novo
      </button>
    </div>
  );
}
