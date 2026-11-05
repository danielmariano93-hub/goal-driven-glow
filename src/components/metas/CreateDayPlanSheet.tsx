import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { parseMoney } from "@/lib/mapa/questions";
import { formatBRL } from "@/lib/engine/facts";
import { dayMonth, useCancelDayPlan, useCreateDayPlan, weekdayName, type DayPlanRow } from "@/lib/behavioral/dayPlan";
import {
  addDaysIso, goalRoomPerOccurrence, nextOccurrence, planSpanDays, suggestTarget, typicalForWeekday,
  type PlanSuggestion,
} from "@/lib/behavioral/dayPlanCreate";

// "Criar um plano": a pessoa escolhe categoria, dia e quanto cabe; o Nino sugere com o que sabe (o padrão desse dia,
// o que a meta permite e, se o corte pedido for grande, um degrau no meio do caminho). Um plano ativo por vez.

export type PlanCategoryOption = {
  categoryId: string;
  name: string;
  /** Meta de gasto ativa da categoria (null = sem meta: a sugestão parte do próprio padrão). */
  goal: { remainingAmount: number; periodEnd: string; targetAmount: number } | null;
};

const WEEKDAY_CHIPS = [
  { index: 1, label: "seg" }, { index: 2, label: "ter" }, { index: 3, label: "qua" }, { index: 4, label: "qui" },
  { index: 5, label: "sex" }, { index: 6, label: "sáb" }, { index: 0, label: "dom" },
] as const;

const WHEN: Record<number, string> = {
  1: "nas segundas", 2: "nas terças", 3: "nas quartas", 4: "nas quintas", 5: "nos fins de semana (sex a dom)", 6: "nos sábados", 0: "nos domingos",
};

export function suggestionText(s: PlanSuggestion, categoryName: string, weekday: number): string {
  const label = WHEN[weekday] ?? "nesse dia";
  switch (s.kind) {
    case "goal_step":
      return `Você costuma gastar ${formatBRL(s.typical)} ${label}. A meta de ${categoryName} pede ${formatBRL(s.goalRoom ?? 0)}. Sugerimos ${formatBRL(s.target)}, um passo no meio do caminho.`;
    case "goal_direct":
      return `Você costuma gastar ${formatBRL(s.typical)} ${label}. A meta de ${categoryName} permite ${formatBRL(s.goalRoom ?? 0)}, e é isso que sugerimos.`;
    case "goal_fits":
      return `Seu padrão (${formatBRL(s.typical)} ${label}) já cabe na meta de ${categoryName}. Sugerimos manter e acompanhar.`;
    case "average_cut":
      return `Sem meta em ${categoryName}. Você costuma gastar ${formatBRL(s.typical)} ${label}; sugerimos 10% abaixo disso, uma redução pequena e fácil de testar.`;
    default:
      return "Ainda não há histórico suficiente desse dia. Escolha um valor que faça sentido para você.";
  }
}

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  today: string;
  txs: Array<Record<string, unknown>>;
  options: PlanCategoryOption[];
  activePlan: DayPlanRow | null;
};

export function CreateDayPlanSheet({ open, onOpenChange, today, txs, options, activePlan }: Props) {
  const create = useCreateDayPlan();
  const cancel = useCancelDayPlan();
  const [categoryId, setCategoryId] = useState(options[0]?.categoryId ?? "");
  const [weekday, setWeekday] = useState(5);
  const [targetText, setTargetText] = useState("");
  const [touched, setTouched] = useState(false);
  const option = options.find((o) => o.categoryId === categoryId) ?? options[0];

  // Dia mais forte da categoria: o de maior gasto típico.
  const strongest = useMemo(() => {
    if (!option) return 5;
    let best = 5;
    let bestValue = -1;
    for (const day of [1, 2, 3, 4, 5, 6, 0]) {
      const v = typicalForWeekday(txs as never, option.categoryId, day, today);
      if (v > bestValue) { best = day; bestValue = v; }
    }
    return best;
  }, [option, txs, today]);

  useEffect(() => { if (open) { setWeekday(strongest); setTouched(false); } }, [open, strongest]);

  const suggestion = useMemo<PlanSuggestion | null>(() => {
    if (!option) return null;
    const typical = typicalForWeekday(txs as never, option.categoryId, weekday, today);
    const goalRoom = option.goal
      ? goalRoomPerOccurrence({ txs: txs as never, categoryId: option.categoryId, weekday, today, periodEnd: option.goal.periodEnd, remainingAmount: option.goal.remainingAmount })
      : null;
    return suggestTarget({ typical, goalRoom });
  }, [option, txs, weekday, today]);

  useEffect(() => { if (!touched && suggestion) setTargetText(suggestion.target > 0 ? String(suggestion.target) : ""); }, [suggestion, touched]);

  if (!option) return null;
  const date = nextOccurrence(today, weekday);
  const span = planSpanDays(weekday);
  const whenLabel = span > 1 ? `sexta a domingo (${dayMonth(date)} a ${dayMonth(addDaysIso(date, span - 1))})` : `${weekdayName(date)}, ${dayMonth(date)}`;

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const value = parseMoney(targetText);
    if (value === null || value <= 0) return void toast.error("Informe um valor maior que zero.");
    create.mutate(
      {
        category: option.name, date, target: value, expected: suggestion && suggestion.typical > 0 ? suggestion.typical : null,
        anchorKind: option.goal ? "goal" : "average", anchorAmount: option.goal ? option.goal.targetAmount : suggestion && suggestion.typical > 0 ? suggestion.typical : null,
      },
      {
        onSuccess: () => { toast.success("Plano criado", { description: `${option.name} até ${formatBRL(value)}. Depois eu te conto como foi.` }); onOpenChange(false); },
        onError: (error) => toast.error(/habits_v2_not_enabled/.test(error.message) ? "Os planos estão disponíveis para quem usa o WhatsApp com o Nino." : "Não consegui criar o plano agora. Tente de novo."),
      },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-3xl">
        <SheetHeader className="text-left">
          <SheetTitle>Criar um plano</SheetTitle>
          <SheetDescription>Um limite para um dia da semana. O Nino acompanha pelos seus lançamentos e conta o resultado no dia seguinte.</SheetDescription>
        </SheetHeader>

        {activePlan ? (
          <div data-testid="plan-active-notice" className="mt-4 space-y-3">
            <p className="rounded-xl bg-muted/50 p-3 text-[13px] leading-5">
              Já existe um plano {activePlan.status === "accepted" ? "combinado" : "proposto"}: <strong>{activePlan.category}</strong>, {weekdayName(activePlan.friday)} ({dayMonth(activePlan.friday)}), até {formatBRL(activePlan.target_amount ?? 0)}.
              Só um plano ativo por vez, para você focar em uma coisa.
            </p>
            <div className="flex flex-wrap gap-2">
              {activePlan.status === "accepted" ? (
                <button type="button" disabled={cancel.isPending} onClick={() => cancel.mutate({ category: activePlan.category, date: activePlan.friday }, { onSuccess: () => toast.success("Plano cancelado") })} className="min-h-11 rounded-xl border border-border px-4 text-sm font-semibold disabled:opacity-60">
                  Cancelar esse plano
                </button>
              ) : null}
              <button type="button" onClick={() => onOpenChange(false)} className="min-h-11 rounded-xl px-4 text-sm font-medium text-muted-foreground">Fechar</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
            <div>
              <p className="text-sm font-semibold">Categoria</p>
              <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Categoria">
                {options.map((o) => (
                  <button key={o.categoryId} type="button" aria-pressed={o.categoryId === option.categoryId} onClick={() => { setCategoryId(o.categoryId); setTouched(false); }}
                    className={`min-h-10 rounded-full px-3.5 text-[13px] ${o.categoryId === option.categoryId ? "border-2 border-primary bg-accent font-semibold text-accent-foreground" : "border border-border"}`}>
                    {o.name}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">Dia da semana</p>
                <p className="text-[11px] text-muted-foreground">Seu dia mais forte em {option.name}: {weekdayName(nextOccurrence(today, strongest))}</p>
              </div>
              <div className="mt-2 flex gap-1.5" role="group" aria-label="Dia da semana">
                {WEEKDAY_CHIPS.map((d) => (
                  <button key={d.index} type="button" aria-pressed={d.index === weekday} onClick={() => { setWeekday(d.index); setTouched(false); }}
                    className={`min-h-10 flex-1 rounded-[10px] text-xs ${d.index === weekday ? "border-2 border-primary bg-accent font-semibold text-accent-foreground" : "border border-border"}`}>
                    {d.label}
                  </button>
                ))}
              </div>
              <p data-testid="plan-when" className="mt-1.5 text-[11px] text-muted-foreground">Vale para {whenLabel}.</p>
            </div>

            <div>
              <label htmlFor="plan-target" className="text-sm font-semibold">Quanto cabe</label>
              <div className="mt-2 flex items-center gap-2 rounded-2xl border-2 border-primary bg-card px-4 py-2.5">
                <span className="text-lg font-semibold text-muted-foreground">R$</span>
                <input id="plan-target" inputMode="decimal" autoComplete="off" value={targetText} onChange={(e) => { setTargetText(e.target.value); setTouched(true); }} placeholder="0"
                  className="min-w-0 flex-1 bg-transparent text-2xl font-bold outline-none" />
              </div>
              {suggestion ? <p data-testid="plan-suggestion" className="mt-2 rounded-xl bg-muted/50 p-3 text-xs leading-[18px] text-muted-foreground">{suggestionText(suggestion, option.name, weekday)}</p> : null}
            </div>

            <button type="submit" disabled={create.isPending} className="btn-brand min-h-12 disabled:opacity-60">
              {create.isPending ? "Criando..." : "Começar o plano"}
            </button>
            <p className="text-center text-[11px] text-muted-foreground">Só um plano ativo por vez, para você focar em uma coisa.</p>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
