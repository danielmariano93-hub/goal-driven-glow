import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { HabitTile } from "@/components/hb/kit";
import { useLogTimes, type HabitView } from "@/lib/habits/api";
import { clockText, regularity, regularityDays, REGULARITY_FORMS, type Regularity } from "@/lib/habits/engine/regularity";

/** Horários dos registros por hábito (só os que têm dias suficientes e uma forma em que o horário faz sentido). */
export function useRegularity(habitIds: string[]): { map: Map<string, Regularity>; days: Map<string, number> } {
  const data = useLogTimes();
  return useMemo(() => {
    const out = new Map<string, Regularity>();
    const days = new Map<string, number>();
    if (!data.data) return { map: out, days };
    for (const id of habitIds) {
      const mine = data.data.logs.filter((l) => l.habit_id === id);
      days.set(id, regularityDays(mine, data.data.timezone));
      const r = regularity(mine, data.data.timezone);
      if (r) out.set(id, r);
    }
    return { map: out, days };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data, habitIds.join(",")]);
}

const Bar = ({ share }: { share: number }) => (
  <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><i className="block h-full rounded-full bg-primary" style={{ width: `${Math.round(share * 100)}%` }} /></div>
);

const advice = (r: Regularity) =>
  r.share >= 0.7
    ? "Fazer no mesmo horário ajuda o hábito a ficar automático (Lally e colegas, 2010). Você já tem um horário firme."
    : r.share >= 0.4
      ? "Seu horário varia um pouco. Ligar o hábito a um gatilho fixo (por exemplo, depois do café) ajuda a firmar."
      : "Seu horário varia bastante. Escolher um gatilho fixo (por exemplo, depois do café) é o que mais ajuda a firmar o hábito.";

/** Detalhe do hábito: a hora em que você costuma fazer e o quanto ela se repete. */
export function RegularityCard({ view }: { view: HabitView }) {
  const eligible = REGULARITY_FORMS.has(view.form) && view.habit.kind !== "quit";
  const ids = useMemo(() => (eligible ? [view.habit.id] : []), [eligible, view.habit.id]);
  const r = useRegularity(ids).map.get(view.habit.id);
  if (!eligible || !r) return null;
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Regularidade do horário">
      <h2 className="text-[12px] font-medium text-muted-foreground">Regularidade do horário</h2>
      <p className="mt-1.5 font-display text-[18px] font-semibold leading-tight tracking-[-0.02em]">Você costuma fazer por volta de {clockText(r.typical_min)}</p>
      <p className="mt-1 text-[12px] leading-[18px] text-muted-foreground">Em {r.within} de {r.days} dias foi a até 1 hora desse horário. Conta o horário em que você marcou no app, só nos dias em que marcou no próprio dia.</p>
      <div className="mt-3"><Bar share={r.share} /></div>
      <p className="mt-3 rounded-xl bg-primary/5 px-3.5 py-2.5 text-[12px] leading-[18px] text-muted-foreground">{advice(r)}</p>
    </section>
  );
}

/** Progresso: um resumo dos horários dos hábitos que já têm dados. */
export function RegularityOverview({ views }: { views: HabitView[] }) {
  const eligible = useMemo(() => views.filter((v) => REGULARITY_FORMS.has(v.form) && v.habit.kind !== "quit"), [views]);
  const ids = useMemo(() => eligible.map((v) => v.habit.id), [eligible]);
  const { map } = useRegularity(ids);
  const rows = eligible.filter((v) => map.has(v.habit.id));
  if (rows.length === 0) return null;
  return (
    <section className="mt-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Horário dos hábitos">
      <h2 className="text-[12px] font-medium text-muted-foreground">Horário dos hábitos</h2>
      <ul className="mt-2 divide-y divide-border/60">
        {rows.map((v) => {
          const r = map.get(v.habit.id)!;
          return (
            <li key={v.habit.id} className="py-2.5 first:pt-1 last:pb-0">
              <div className="flex items-center gap-2.5">
                <HabitTile title={v.habit.title} form={v.form} area={v.habit.area} size={28} />
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{v.habit.title}</p>
                <p className="shrink-0 text-right text-[12px] tabular-nums text-muted-foreground"><b className="font-display text-[14px] font-semibold text-foreground">{clockText(r.typical_min)}</b> · {r.within} de {r.days} dias</p>
              </div>
              <div className={cn("mt-1.5")}><Bar share={r.share} /></div>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">Mostra o horário em que você costuma marcar e em quantos dias ficou a até 1 hora dele. Horário estável ajuda o hábito a ficar automático.</p>
    </section>
  );
}
