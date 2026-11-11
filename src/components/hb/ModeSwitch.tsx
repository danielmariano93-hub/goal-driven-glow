import { useLocation, useNavigate } from "react-router-dom";
import { ModePill } from "@/components/hb/ui";
import { useHabitsEnabled, useSetHbMode } from "@/lib/habits/api";
import { isMoneyTabRoot } from "@/lib/habits/modeRoutes";

/**
 * Único ponto de contato do Hábitos com as telas financeiras: uma barra com o seletor Dinheiro | Hábitos acima do conteúdo.
 * Sem liberação (`hb_access`), carregando ou em erro, não renderiza NADA: o DOM fica idêntico ao de antes.
 */
export function ModeSwitch() {
  const enabled = useHabitsEnabled();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const setMode = useSetHbMode();
  if (enabled.data !== true || !isMoneyTabRoot(pathname)) return null;
  return (
    <div className="mb-2 flex justify-end" data-testid="hb-mode-switch">
      <ModePill
        current="money"
        onChange={(m) => {
          if (m === "habits") {
            setMode.mutate("habits");
            navigate("/h/hoje");
          }
        }}
      />
    </div>
  );
}
