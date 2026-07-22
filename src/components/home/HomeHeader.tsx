import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { usePrivacyMode } from "@/context/PrivacyModeContext";
import { NotificationBell } from "@/components/NotificationBell";

export function HomeHeader() {
  const { profile } = useAuth();
  const { valuesHidden, toggleValues } = usePrivacyMode();
  const name = (profile?.display_name ?? "").split(" ")[0] || "por aqui";
  return (
    <header className="flex items-start justify-between gap-3 pt-1">
      <div className="min-w-0">
        <p className="text-[12px] text-muted-foreground">Olá, {name}</p>
        <h1 className="font-display text-[20px] font-bold leading-tight text-foreground">
          Seu dinheiro, com clareza.
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => void toggleValues()}
          aria-label={valuesHidden ? "Mostrar valores" : "Ocultar valores"}
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {valuesHidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <div className="grid h-10 w-10 place-items-center">
          <NotificationBell />
        </div>
      </div>
    </header>
  );
}
