import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { hbErrorMessage, useAnswerAutomaticity, type HabitView } from "@/lib/habits/api";

const LABEL: Record<number, string> = { 1: "nada", 4: "mais ou menos", 7: "totalmente" };

/** Autorrelato de automaticidade (1 a 7). Aparece a cada 14 dias; só a pessoa sabe a resposta. */
export function AutomaticityCard({ view, compact = false }: { view: HabitView; compact?: boolean }) {
  const answer = useAnswerAutomaticity();
  const { auto, habit } = view;
  const send = async (score: number | null) => {
    try {
      await answer.mutateAsync({ habit_id: habit.id, score, skipped: score == null });
      if (score != null) toast.success("Anotado, obrigado.");
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };
  const trend = auto.delta == null ? null : auto.delta > 0 ? `subiu ${auto.delta} desde a primeira resposta` : auto.delta < 0 ? `caiu ${Math.abs(auto.delta)} desde a primeira resposta` : "igual à primeira resposta";
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Automaticidade">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-medium text-muted-foreground">Quão automático está?</h2>
        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">você responde</span>
      </div>
      {view.auto_due ? (
        <>
          <p className="mt-2 text-[15px] font-semibold leading-6">“{habit.title}” já acontece quase sem você pensar?</p>
          <div className="mt-3 grid grid-cols-7 gap-1.5" role="group" aria-label="De 1 a 7">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <button key={n} type="button" disabled={answer.isPending} onClick={() => void send(n)} aria-label={`${n}${LABEL[n] ? `, ${LABEL[n]}` : ""}`} className={cn("h-11 rounded-xl border border-border bg-card font-display text-base font-semibold hover:bg-muted")}>{n}</button>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>nada</span><span>totalmente</span></div>
          <Button variant="ghost" className="mt-2 h-11 w-full rounded-full text-muted-foreground" disabled={answer.isPending} onClick={() => void send(null)}>Agora não</Button>
        </>
      ) : auto.latest != null ? (
        <>
          <p className="mt-2 font-display text-[34px] font-semibold leading-none tabular-nums">{auto.latest}<span className="text-base font-semibold text-muted-foreground"> de 7</span></p>
          {!compact && trend ? <p className="mt-1 text-xs text-muted-foreground">{trend}.</p> : null}
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Eu pergunto de novo a cada 2 semanas. Quanto mais automático, menos lembretes você recebe.</p>
        </>
      ) : (
        <p className="mt-2 text-sm leading-5 text-muted-foreground">Depois de 2 semanas eu pergunto o quanto o hábito já está automático. Isso ajuda a reduzir lembretes quando você não precisa mais deles.</p>
      )}
    </section>
  );
}
