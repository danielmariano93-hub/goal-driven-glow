import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { MessageCircle, Sparkles } from "lucide-react";
import { WhatsAppLinkSheet } from "@/components/whatsapp/WhatsAppLinkSheet";
import { useAssessor } from "@/context/AssessorContext";

/**
 * Sheet apresentado quando o usuário toca no FAB do Assessor:
 * oferece as duas formas de conversar (dentro do app ou no WhatsApp).
 */
export function AssessorActionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { openAssessor } = useAssessor();
  const [wa, setWa] = useState(false);

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => (!o ? onClose() : null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader className="text-left">
            <SheetTitle>Falar com seu assessor</SheetTitle>
            <SheetDescription>Escolha por onde prefere continuar essa conversa.</SheetDescription>
          </SheetHeader>
          <div className="mt-4 grid gap-2">
            <button
              type="button"
              onClick={() => { onClose(); openAssessor("fab"); }}
              className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4 text-left transition hover:border-primary/50"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary">
                <Sparkles size={18} />
              </span>
              <span className="min-w-0">
                <strong className="block text-sm">Aqui no app</strong>
                <span className="block text-xs text-muted-foreground">Ideal para enviar prints e revisar em lote.</span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => { onClose(); setWa(true); }}
              className="flex items-center gap-3 rounded-2xl border border-success/25 bg-gradient-to-r from-success/10 to-success/5 p-4 text-left transition hover:border-success/50"
            >
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-success/15 text-success">
                <MessageCircle size={18} />
              </span>
              <span className="min-w-0">
                <strong className="block text-sm">No WhatsApp</strong>
                <span className="block text-xs text-muted-foreground">Anote gastos por mensagem, onde já conversa.</span>
              </span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
      <WhatsAppLinkSheet open={wa} onClose={() => setWa(false)} />
    </>
  );
}
