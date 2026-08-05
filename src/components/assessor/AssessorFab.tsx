import { createPortal } from "react-dom";
import { useState } from "react";
import { ChatCircle } from "@phosphor-icons/react";
import { AssessorActionSheet } from "@/components/assessor/AssessorActionSheet";
import { Button } from "@/components/ui/button";

/**
 * FAB do Assessor: abre um sheet com dois caminhos (app ou WhatsApp).
 */
export function AssessorFab() {
  const [open, setOpen] = useState(false);
  const fab = (
     <Button
       type="button"
       size="icon"
      onClick={() => setOpen(true)}
      aria-label="Falar com meu assessor"
       className="fixed right-4 z-40 h-[54px] w-[54px] rounded-full bg-primary text-primary-foreground shadow-lg active:scale-95"
      style={{
        bottom: "calc(56px + env(safe-area-inset-bottom) + 16px)",
      }}
    >
       <ChatCircle size={23} weight="duotone" />
     </Button>
  );

  return (
    <>
      {typeof document !== "undefined" ? createPortal(fab, document.body) : null}
      <AssessorActionSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
