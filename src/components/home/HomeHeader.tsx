import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { usePrivacyMode } from "@/context/PrivacyModeContext";
import { NotificationBell } from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";

export function HomeHeader() {
  const { profile } = useAuth();
  const { valuesHidden, toggleValues } = usePrivacyMode();
  const name = (profile?.display_name ?? "").split(" ")[0] || "por aqui";
  return (
    <header className="flex items-center justify-between gap-3 pt-1">
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-muted-foreground">Olá, {name}</p>
        <h1 className="font-display text-[20px] font-bold leading-[1.2] text-foreground">
          Seu dinheiro, com clareza.
        </h1>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => void toggleValues()}
          aria-label={valuesHidden ? "Mostrar valores" : "Ocultar valores"}
          className="h-11 w-11 rounded-full text-muted-foreground"
        >
          {valuesHidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </Button>
        <div className="grid h-11 w-11 place-items-center">
          <NotificationBell />
        </div>
      </div>
    </header>
  );
}
