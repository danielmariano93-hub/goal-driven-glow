import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { usePrivacyMode } from "@/context/PrivacyModeContext";
import { NotificationBell } from "@/components/NotificationBell";

export function HomeHeader() {
  const { profile } = useAuth();
  const { valuesHidden, toggleValues } = usePrivacyMode();
  const name = (profile?.display_name ?? "").split(" ")[0] || "por aqui";
  return (
    <header className="flex items-center justify-between gap-3 pt-1">
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-[color:var(--home-text-2)]">Olá, {name}</p>
        <h1
          className="font-display text-[20px] font-bold leading-[1.2] text-[color:var(--home-text-1)]"
          style={{ letterSpacing: "-0.02em" }}
        >
          Seu dinheiro, com clareza.
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => void toggleValues()}
          aria-label={valuesHidden ? "Mostrar valores" : "Ocultar valores"}
          className="grid h-9 w-9 place-items-center rounded-full text-[color:var(--home-text-2)] transition-colors hover:bg-[color:var(--home-surface-soft)] hover:text-[color:var(--home-text-1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {valuesHidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <div className="grid h-9 w-9 place-items-center">
          <NotificationBell />
        </div>
      </div>
    </header>
  );
}
