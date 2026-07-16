import { useState } from "react";
import { createPortal } from "react-dom";
import { MessageCircle } from "lucide-react";
import { AssessorPanel } from "./AssessorPanel";

export function AssessorFab() {
  const [open, setOpen] = useState(false);

  const fab = (
    <button
      onClick={() => setOpen(true)}
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

  return (
    <>
      {typeof document !== "undefined" ? createPortal(fab, document.body) : null}
      {open ? <AssessorPanel onClose={() => setOpen(false)} /> : null}
    </>
  );
}
