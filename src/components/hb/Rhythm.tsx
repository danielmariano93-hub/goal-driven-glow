import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { useRhythmData, type HabitView } from "@/lib/habits/api";
import {
  cravingHours, dayRhythm, hourPattern, localHour, type DatedEntry, type DayRhythm,
} from "@/lib/habits/engine/rhythm";
import type { LogRow } from "@/lib/habits/engine";

/** Gráficos por hora: um matiz só (o roxo da marca) e neutros; o que importa vem em texto, não em cor. */

/** Sem casas decimais a partir de 10 (312,5 ml vira 313 ml); abaixo disso, até 2. */
const num = (n: number) => String(n >= 10 ? Math.round(n) : Math.round(n * 100) / 100).replace(".", ",");
const hh = (h: number) => `${h}h`;
/** "1 litro", "2 litros": o plural do apoio acompanha o número. */
/** Litros abaixo de 1 viram ml (0,125 litros = 125 ml), que é como se bebe. */
const amountText = (n: number, unit: string) => (unit === "litros" && n < 1 ? `${Math.round(n * 1000)} ml` : withUnit(n, unit));
const withUnit = (n: number, unit: string) => `${num(n)}${unit ? ` ${num(n) === "1" && unit.endsWith("s") ? unit.slice(0, -1) : unit}` : ""}`;

const Card = ({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label={title}>
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[12px] font-medium text-muted-foreground">{title}</h2>
      {tag ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">{tag}</span> : null}
    </div>
    {children}
  </section>
);

/** Colunas por hora. `values` na ordem das horas de `from`; `nowHour` marca a hora atual; horas futuras ficam mais claras. */
function HourBars({ from, values, nowHour, max, labelEvery = 3, ariaLabel }: { from: number; values: number[]; nowHour?: number | null; max: number; labelEvery?: number; ariaLabel: string }) {
  return (
    <div role="img" aria-label={ariaLabel} className="mt-4">
      <div className="flex h-[72px] items-end gap-[3px]">
        {values.map((v, k) => {
          const hour = from + k;
          const future = nowHour != null && hour > Math.floor(nowHour);
          const current = nowHour != null && hour === Math.floor(nowHour);
          return (
            <div key={hour} className="flex h-full flex-1 items-end justify-center">
              <i
                className={cn("block w-full rounded-[4px]", v > 0 ? "bg-primary" : future ? "bg-muted/60" : "bg-muted", current && v <= 0 && "ring-1 ring-primary/40")}
                style={{ height: v > 0 ? `${Math.max(10, (v / max) * 100)}%` : "6px" }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-[3px]" aria-hidden="true">
        {values.map((_, k) => <span key={k} className="flex-1 text-center text-[10px] leading-3 text-muted-foreground">{(from + k) % labelEvery === 0 ? from + k : ""}</span>)}
      </div>
    </div>
  );
}

function headline(r: DayRhythm, unit: string): { title: string; note: string } {
  if (r.state === "done") return { title: "Meta do dia batida", note: "O resto do dia é folga." };
  const hours = Math.floor(r.hours_left);
  const hoursText = hours >= 1 ? ` em ${hours} ${hours === 1 ? "hora" : "horas"}` : "";
  const left = `Faltam ${amountText(r.remaining, unit)}${hoursText}`;
  if (r.state === "closed") return { title: `Ficou ${amountText(r.remaining, unit)} abaixo da meta`, note: "O dia de hoje já passou do horário previsto. Amanhã começa do zero." };
  if (r.state === "behind") return { title: `${amountText(r.gap, unit)} abaixo do ritmo`, note: r.per_hour_needed ? `${left} (cerca de ${amountText(r.per_hour_needed, unit)} por hora).` : `${left}.` };
  return { title: "No ritmo", note: `${left}.` };
}

/** Água e outras metas "no mínimo por dia": o que foi feito hora a hora contra o ritmo esperado. */
export function DayRhythmCard({ view, today, logs }: { view: HabitView; today: string; logs: LogRow[] }) {
  const habit = view.habit;
  const data = useRhythmData(habit.id);
  const target = habit.quantity_target ?? 0;
  const unit = habit.quantity_unit ?? "";
  const total = logs.find((l) => l.habit_id === habit.id && l.local_date === today && l.status === "quantity")?.quantity ?? 0;
  const model = useMemo(() => {
    if (!data.data) return null;
    const tz = data.data.timezone;
    const stamped = data.data.entries.filter((e) => e.at != null).map((e) => ({ local_date: e.local_date, amount: e.amount, hour: localHour(e.at as string, tz) })).filter((e): e is DatedEntry => e.hour != null);
    const now = localHour(new Date().toISOString(), tz) ?? 12;
    // O dia só vira às 03:00: antes disso ainda é "ontem", já depois do horário de dormir.
    const nowHour = now < 3 ? 23.99 : now;
    const entries = stamped.filter((e) => e.local_date === today).map((e) => ({ amount: e.amount, hour: Math.min(e.hour < 3 ? 23.99 : e.hour, 23.99) }));
    return { rhythm: dayRhythm({ target, total, entries, nowHour }), nowHour, pattern: hourPattern(stamped.map((e) => ({ ...e, hour: Math.min(e.hour, 23.99) }))) };
  }, [data.data, today, target, total]);

  if (!model || !model.rhythm || target <= 0) return null;
  const r = model.rhythm;
  const { title, note } = headline(r, unit);
  const max = Math.max(...r.perHour.map((p) => p.amount), target * 0.25, 1);
  const expectedPct = Math.min(100, (r.expected / target) * 100);
  const totalPct = Math.min(100, (total / target) * 100);
  const timedCount = r.perHour.reduce((a, p) => a + (p.amount > 0 ? 1 : 0), 0);

  return (
    <>
      <Card title="Ritmo do dia" tag={`${num(total)} de ${withUnit(target, unit)}`}>
        <p className="mt-2 font-display text-[18px] font-semibold leading-tight tracking-[-0.02em]">{title}</p>
        <p className="mt-1 text-[12px] leading-[18px] text-muted-foreground">{note}</p>
        <p className="mt-3 rounded-xl bg-primary/5 px-3.5 py-2.5 text-[12px] leading-[18px] text-muted-foreground">
          <b className="font-medium text-foreground">Sugestão do Nino:</b> cerca de {amountText(r.per_hour_plan, unit)} por hora, ou {amountText(r.per_hour_plan * 2, unit)} a cada 2 horas, das {hh(6)} às {hh(22)}.
        </p>
        <HourBars from={r.from} values={r.perHour.map((p) => p.amount)} nowHour={model.nowHour} max={max} labelEvery={2} ariaLabel={`Quantidade por hora, de ${hh(r.from)} a ${hh(r.to)}`} />
        <div className="relative mt-4 h-2 rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(totalPct)} aria-label="Progresso do dia contra o ritmo esperado">
          <i className="block h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${totalPct}%` }} />
          {r.state !== "done" && r.expected > 0 ? <b className="absolute -top-1 bottom-[-4px] w-[2px] rounded bg-foreground/70" style={{ left: `${expectedPct}%` }} aria-hidden="true" /> : null}
        </div>
        {r.state !== "done" && r.expected > 0 ? <p className="mt-1.5 text-[11px] text-muted-foreground">A marca é onde você estaria agora, com a meta distribuída das {hh(6)} às {hh(22)}.</p> : null}
        {r.untimed > 0 ? <p className="mt-2 text-[11px] text-muted-foreground">{timedCount === 0 ? "Os registros de hoje ainda não têm horário." : `${withUnit(r.untimed, unit)} de hoje sem horário (registrados antes de o ritmo existir ou em "dia anterior").`} A partir da próxima inclusão a hora é guardada.</p> : null}
      </Card>
      {model.pattern ? <HourPatternCard pattern={model.pattern} /> : (
        <p className="px-1 text-[12px] leading-[18px] text-muted-foreground">Os seus horários aparecem depois de 7 dias com registros hora a hora.</p>
      )}
    </>
  );
}

function HourPatternCard({ pattern }: { pattern: NonNullable<ReturnType<typeof hourPattern>> }) {
  const from = 6;
  const to = 22;
  const hours = Array.from({ length: to - from }, (_, k) => from + k);
  const max = Math.max(...hours.map((h) => pattern.share[h]), 0.0001);
  return (
    <Card title={`Seus horários · ${pattern.days} dias com registro`}>
      <div role="img" aria-label="Quanto você costuma registrar em cada hora" className="mt-3">
        <div className="flex gap-[3px]">
          {hours.map((h) => <i key={h} className="h-7 flex-1 rounded-[4px] bg-primary" style={{ opacity: 0.08 + (pattern.share[h] / max) * 0.92 }} />)}
        </div>
        <div className="mt-1 flex gap-[3px]" aria-hidden="true">
          {hours.map((h) => <span key={h} className="flex-1 text-center text-[10px] leading-3 text-muted-foreground">{h % 3 === 0 ? h : ""}</span>)}
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-[18px] text-muted-foreground">
        {pattern.peak ? <>Você registra mais entre <b className="font-medium text-foreground">{hh(pattern.peak.from)} e {hh(pattern.peak.to)}</b>. </> : "Seus registros estão bem distribuídos ao longo do dia. "}
        {pattern.quiet ? <>Das <b className="font-medium text-foreground">{hh(pattern.quiet.from)} às {hh(pattern.quiet.to)}</b> quase não há registro; um registro nesse trecho ajuda a espalhar o dia.</> : null}
      </p>
    </Card>
  );
}

/** Vontades por hora (hábitos de largar ou reduzir). Sem culpa: ceder é um dado, não uma falha. */
export function CravingHoursCard({ habitId }: { habitId: string }) {
  const data = useRhythmData(habitId);
  const model = useMemo(() => {
    if (!data.data) return null;
    const tz = data.data.timezone;
    const pts = data.data.cravings.map((c) => ({ hour: localHour(c.occurred_at, tz), handled: c.handled })).filter((p): p is { hour: number; handled: boolean | null } => p.hour != null);
    return { stats: cravingHours(pts), count: pts.length };
  }, [data.data]);
  if (!model) return null;
  if (!model.stats) {
    return model.count > 0 ? <p className="px-1 text-[12px] leading-[18px] text-muted-foreground">Os horários mais difíceis aparecem depois de 10 vontades registradas (você tem {model.count}).</p> : null;
  }
  const s = model.stats;
  const hours = Array.from({ length: 18 }, (_, k) => 5 + k).filter((h) => h < 24);
  const max = Math.max(...hours.map((h) => s.perHour[h].resisted + s.perHour[h].ceded + s.perHour[h].open), 1);
  return (
    <Card title="Vontades por hora · 30 dias" tag={s.answered > 0 ? `${s.resisted} de ${s.answered} resistidas` : undefined}>
      {s.peak ? <p className="mt-2 font-display text-[18px] font-semibold leading-tight tracking-[-0.02em]">Horário mais difícil: {hh(s.peak.from)} às {hh(s.peak.to)}</p> : <p className="mt-2 font-display text-[18px] font-semibold leading-tight tracking-[-0.02em]">Sem um horário que concentre as vontades</p>}
      <p className="mt-1 text-[12px] leading-[18px] text-muted-foreground">{s.peak ? `${Math.round(s.peak.share * 100)}% das vontades caem nessa janela. Vale ter um plano pronto para ela.` : "As vontades estão espalhadas ao longo do dia."}</p>
      <div role="img" aria-label="Vontades por hora" className="mt-4">
        <div className="flex h-[72px] items-end gap-[3px]">
          {hours.map((h) => {
            const row = s.perHour[h];
            const n = row.resisted + row.ceded + row.open;
            const inPeak = s.peak && h >= s.peak.from && h < s.peak.to;
            return (
              <div key={h} className={cn("flex h-full flex-1 flex-col justify-end gap-[2px] rounded-[5px]", inPeak && "bg-primary/5")}>
                {n === 0 ? <i className="block h-[6px] w-full rounded-[4px] bg-muted" /> : (
                  <>
                    {row.ceded + row.open > 0 ? <i className="block w-full rounded-[4px] bg-primary/35" style={{ height: `${((row.ceded + row.open) / max) * 100}%`, minHeight: 6 }} /> : null}
                    {row.resisted > 0 ? <i className="block w-full rounded-[4px] bg-primary" style={{ height: `${(row.resisted / max) * 100}%`, minHeight: 6 }} /> : null}
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex gap-[3px]" aria-hidden="true">{hours.map((h) => <span key={h} className="flex-1 text-center text-[10px] leading-3 text-muted-foreground">{h % 3 === 0 ? h : ""}</span>)}</div>
      </div>
      <div className="mt-3 flex gap-4 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-[3px] bg-primary" />Resisti</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-[3px] bg-primary/35" />Cedi ou sem resposta (é um dado, sem culpa)</span>
      </div>
    </Card>
  );
}
