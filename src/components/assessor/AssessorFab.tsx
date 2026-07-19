import { createPortal } from "react-dom";
import { MessageCircle } from "lucide-react";
import { useAssessor } from "@/context/AssessorContext";

/**
 * Botão flutuante que apenas dispara `openAssessor()`. O painel em si é
 * renderizado pelo `AppLayout` (uma única instância global), evitando
 * duplicação com a rota `/app/assessor`.
 */
export function AssessorFab() {
  const { openAssessor } = useAssessor();

  const fab = (
    <button
      onClick={() => openAssessor("fab")}
      aria-label="Falar com meu assessor"
      className="fixed right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-gradient-brand text-white shadow-brand transition-transform active:scale-95 md:h-14 md:w-14"
      style={{
        // Fica acima da BottomTabBar (58px + safe-area no mobile)
        bottom: "calc(58px + env(safe-area-inset-bottom) + 16px)",
      }}
    >
      <MessageCircle size={22} />
    </button>
  );

  return typeof document !== "undefined" ? createPortal(fab, document.body) : null;
}
