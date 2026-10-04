import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { GuideStep } from "@/lib/guide/catalog";

export type TourSpec = {
  title: string;
  summary?: string;
  steps: GuideStep[];
  to: string;
  cta: string;
};

/**
 * Tutorial passo a passo. O último passo leva à tela de verdade; fechar ou
 * concluir avisa quem chamou (para marcar como visto).
 */
export function GuideTourSheet({
  tour, onClose, onFinish,
}: { tour: TourSpec | null; onClose: () => void; onFinish: (tour: TourSpec) => void }) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);

  useEffect(() => { setIndex(0); }, [tour?.title]);

  if (!tour) return null;
  const total = tour.steps.length;
  const step = tour.steps[Math.min(index, total - 1)];
  const last = index >= total - 1;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="mx-auto max-w-[720px] rounded-t-3xl pb-[calc(env(safe-area-inset-bottom)+1.25rem)]">
        <SheetHeader className="text-left">
          <SheetTitle className="font-display text-lg">{tour.title}</SheetTitle>
          <SheetDescription>{tour.summary ?? `Passo ${index + 1} de ${total}`}</SheetDescription>
        </SheetHeader>

        <div className="mt-4 rounded-2xl bg-primary/5 p-4" aria-live="polite">
          <p className="text-[11px] font-bold uppercase tracking-wide text-primary">Passo {index + 1} de {total}</p>
          <h3 className="mt-1 text-base font-bold">{step.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
        </div>

        <div className="mt-3 flex justify-center gap-1.5" aria-hidden="true">
          {tour.steps.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-primary" : "w-1.5 bg-muted-foreground/30"}`} />
          ))}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
          </Button>
          <div className="flex-1" />
          {last ? (
            <Button onClick={() => { onFinish(tour); navigate(tour.to); }}>
              {tour.cta} <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}>
              Próximo <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
