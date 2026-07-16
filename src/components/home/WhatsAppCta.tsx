import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { copy } from "@/lib/copy/strings";
import { WhatsAppLinkSheet } from "@/components/whatsapp/WhatsAppLinkSheet";

export function WhatsAppCta() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-3 rounded-2xl border border-success/25 bg-gradient-to-r from-success/10 to-success/5 p-4 text-left shadow-card hover:border-success/50"
      >
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-success/15 text-success">
          <MessageCircle size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{copy.whatsapp.ctaTitle}</p>
          <p className="text-xs text-muted-foreground">{copy.whatsapp.ctaBody}</p>
        </div>
      </button>
      <WhatsAppLinkSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
