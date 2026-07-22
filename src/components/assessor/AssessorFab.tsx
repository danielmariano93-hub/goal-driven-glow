import { createPortal } from "react-dom";
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { AssessorActionSheet } from "@/components/assessor/AssessorActionSheet";

/**
 * FAB do Assessor: abre um sheet com dois caminhos (app ou WhatsApp).
 * O painel dentro do app segue sendo renderizado uma única vez em `AppLayout`.
 */
export function AssessorFab() {
  const [open, setOpen] = useState(false);
  const fab = (
    <button
      onClick={() => setOpen(true)}
      aria-label="Falar com meu assessor"
      className="fixed right-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-gradient-brand text-white shadow-brand transition-transform active:scale-95 md:h-14 md:w-14"
      style={{
        bottom: "calc(58px + env(safe-area-inset-bottom) + 16px)",
      }}
    >
      <MessageCircle size={22} />
    </button>
  );

  return (
    <>
      {typeof document !== "undefined" ? createPortal(fab, document.body) : null}
      <AssessorActionSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
