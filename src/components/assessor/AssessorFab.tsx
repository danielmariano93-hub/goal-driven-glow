import { createPortal } from "react-dom";
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { AssessorActionSheet } from "@/components/assessor/AssessorActionSheet";

/**
 * FAB do Assessor: abre um sheet com dois caminhos (app ou WhatsApp).
 */
export function AssessorFab() {
  const [open, setOpen] = useState(false);
  const fab = (
    <button
      onClick={() => setOpen(true)}
      aria-label="Falar com meu assessor"
      className="fixed right-4 z-40 grid place-items-center rounded-full text-white transition-transform active:scale-95"
      style={{
        height: 54,
        width: 54,
        background: "var(--gradient-fab)",
        boxShadow: "var(--shadow-fab)",
        bottom: "calc(56px + env(safe-area-inset-bottom) + 16px)",
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
