import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { hbErrorMessage, useSetMeasurement, type GoalData, type GoalMeasure, type HabitView } from "@/lib/habits/api";
import { addDays, weekRows, weekStart, type LogRow } from "@/lib/habits/engine";
import { averageChange, changeText, measureStats, movingAverage, nextDue, type MeasurePoint } from "@/lib/habits/engine/goals";
import { weekHistory } from "@/lib/habits/engine/rhythm";

/** Cartões do Objetivo. Um matiz só (roxo) e neutros; o que importa vem em texto. */

const MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTH[Number(iso.slice(5, 7)) - 1]}`;
const dmShort = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const num = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

const Card = ({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label={title}>
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-[12px] font-medium text-muted-foreground">{title}</h2>
      {tag ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">{tag}</span> : null}
    </div>
    {children}
  </section>
);

const ERROR_NOTE = "A fita métrica erra cerca de 1 cm. Meça sempre no mesmo ponto e no mesmo horário; olhe a linha, não uma medida isolada.";

/** Registra (ou corrige) a medida de um dia. */
export function MeasureSheet({ measure, today, open, onOpenChange }: { measure: GoalMeasure | null; today: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const set = useSetMeasurement();
  const [text, setText] = useState("");
  const [date, setDate] = useState(today);
  const value = Number(text.replace(",", "."));
  const ok = !!measure && Number.isFinite(value) && value > 0 && value < 1000 && date <= today && date >= addDays(today, -400);
  const save = async () => {
    if (!measure || !ok) return;
    try {
      await set.mutateAsync({ measure: measure.id, date, value });
      toast.success("Medida registrada");
      setText("");
      onOpenChange(false);
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <div className="mx-auto w-full max-w-md pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="font-display text-[18px] font-semibold tracking-[-0.02em]">Registrar {measure?.label.toLowerCase() ?? "medida"}</DrawerTitle>
            <DrawerDescription>{measure?.kind === "weight" ? "Pese-se sempre nas mesmas condições (de manhã, depois de ir ao banheiro). O gráfico mostra a média da semana." : ERROR_NOTE}</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-3 px-4">
            <label className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
              Valor ({measure?.unit})
              <input inputMode="decimal" autoFocus value={text} onChange={(e) => setText(e.target.value.replace(/[^0-9.,]/g, ""))} aria-label={`Valor em ${measure?.unit}`} className="h-11 rounded-2xl border border-border/70 bg-card px-4 font-display text-[18px] font-semibold tabular-nums text-foreground" />
            </label>
            <label className="flex flex-col gap-1.5 text-[12px] text-muted-foreground">
              Dia
              <input type="date" value={date} max={today} min={addDays(today, -400)} onChange={(e) => setDate(e.target.value)} aria-label="Dia da medida" className="h-11 rounded-2xl border border-border/70 bg-card px-4 text-[14px] text-foreground" />
            </label>
            <Button className="h-11 rounded-full text-[14px] font-medium" disabled={!ok || set.isPending} onClick={() => void save()}>Salvar</Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function DueButton({ measure, startedOn, today, onRecord }: { measure: GoalMeasure; startedOn: string; today: string; onRecord: () => void }) {
  const last = measure.points.length ? measure.points[measure.points.length - 1].date : null;
  const due = nextDue(measure.cadence, last, startedOn, today);
  const text = due.state === "due" ? "Hora de medir · registrar agora" : `Próxima medida: ${dm(due.due_on)}`;
  return (
    <button type="button" onClick={onRecord} className={cn("mt-3 w-full rounded-full px-4 py-2.5 text-center text-[14px] font-semibold", due.state === "due" ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}>
      {text}{due.state !== "due" ? " · registrar" : ""}
    </button>
  );
}

/** Linha simples: pontos por medida e, se houver, a linha de média. */
function Chart({ points, avg, unit }: { points: MeasurePoint[]; avg?: MeasurePoint[]; unit: string }) {
  if (points.length < 2) return null;
  const W = 330;
  const H = 110;
  const dates = points.map((p) => p.date);
  const t0 = new Date(`${dates[0]}T12:00:00Z`).getTime();
  const t1 = new Date(`${dates[dates.length - 1]}T12:00:00Z`).getTime();
  const span = Math.max(1, t1 - t0);
  const all = [...points, ...(avg ?? [])].map((p) => p.value);
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const pad = Math.max((hi - lo) * 0.25, 0.4);
  const x = (d: string) => 8 + ((new Date(`${d}T12:00:00Z`).getTime() - t0) / span) * (W - 16);
  const y = (v: number) => 8 + (1 - (v - (lo - pad)) / (hi - lo + pad * 2)) * (H - 28);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label={`Gráfico de ${points.length} medidas, de ${dm(dates[0])} a ${dm(dates[dates.length - 1])}`}>
      {avg && avg.length >= 2 ? <polyline points={avg.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ")} fill="none" stroke="hsl(var(--primary))" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /> : null}
      {points.map((p) => <circle key={p.date} cx={x(p.date)} cy={y(p.value)} r={avg ? 2.4 : 3.4} fill="hsl(var(--primary))" fillOpacity={avg ? 0.3 : 1} />)}
      <text x="8" y={H - 4} fontSize="10" fill="hsl(var(--muted-foreground))">{dmShort(dates[0])}</text>
      <text x={W - 8} y={H - 4} fontSize="10" fill="hsl(var(--muted-foreground))" textAnchor="end">{dmShort(dates[dates.length - 1])}</text>
      <title>{unit}</title>
    </svg>
  );
}

/** Peso: pesagens soltas + média móvel de 7 dias; a variação usa só a média (o peso oscila 1 a 2 kg por dia). */
export function WeightCard({ goal, measure, today, onRecord }: { goal: GoalData; measure: GoalMeasure; today: string; onRecord: () => void }) {
  const points = useMemo(() => measure.points.map((p) => ({ date: p.date, value: p.value })), [measure.points]);
  const avg = useMemo(() => (points.length >= 4 ? movingAverage(points).filter((_, i) => i >= 0) : undefined), [points]);
  const change = useMemo(() => averageChange(points), [points]);
  const recent = useMemo(() => {
    const last = points[points.length - 1];
    if (!last) return null;
    const win = points.filter((p) => p.date >= addDays(last.date, -6)).map((p) => p.value);
    return win.reduce((a, b) => a + b, 0) / win.length;
  }, [points]);
  const weeks = change && points.length ? Math.max(1, Math.round((new Date(`${points[points.length - 1].date}T12:00:00Z`).getTime() - new Date(`${points[0].date}T12:00:00Z`).getTime()) / (7 * 86_400_000))) : 0;
  return (
    <Card title={`${measure.label} · média da semana`} tag={measure.cadence === "weekly" ? "semanal" : "mensal"}>
      {recent == null ? (
        <p className="mt-2 text-[12px] leading-[18px] text-muted-foreground">Nenhuma pesagem ainda. Registre algumas e o gráfico mostra a média da semana, que é o que vale.</p>
      ) : (
        <>
          <p className="mt-2 font-display text-[18px] font-semibold leading-tight tracking-[-0.02em]">{change ? `${changeText(change.change, measure.unit)} em ${weeks} ${weeks === 1 ? "semana" : "semanas"}` : `${num(recent)} ${measure.unit} de média`}</p>
          <p className="mt-1 text-[12px] leading-[18px] text-muted-foreground">
            {change ? `Média ${num(change.start)} → ${num(change.now)} ${measure.unit}. ` : "A variação aparece com 4 pesagens e 2 semanas de histórico. "}
            Os pontos claros são cada pesagem; a linha é a média dos últimos 7 dias. Oscilar 1 a 2 kg de um dia para o outro é normal.
          </p>
          <Chart points={points} avg={avg} unit={measure.unit} />
        </>
      )}
      <DueButton measure={measure} startedOn={goal.started_on} today={today} onRecord={onRecord} />
    </Card>
  );
}

/** Cintura, braço, coxa: poucas medidas (mensais); mostra primeira → última e só desenha tendência a partir de 4. */
export function BodyMeasureCard({ goal, measure, today, onRecord }: { goal: GoalData; measure: GoalMeasure; today: string; onRecord: () => void }) {
  const points = useMemo(() => measure.points.map((p) => ({ date: p.date, value: p.value })), [measure.points]);
  const st = measureStats(points);
  return (
    <Card title={measure.kind === "waist" ? `${measure.label} · na altura do umbigo` : measure.label} tag={measure.cadence === "monthly" ? "mensal" : "semanal"}>
      {st.n === 0 ? (
        <p className="mt-2 text-[12px] leading-[18px] text-muted-foreground">Nenhuma medida ainda. {ERROR_NOTE}</p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-muted/60 px-3 py-2.5">
              <p className="font-display text-[16px] font-semibold leading-tight tabular-nums">{st.n >= 2 ? `${num(st.first!.value)} → ${num(st.last!.value)} ${measure.unit}` : `${num(st.last!.value)} ${measure.unit}`}</p>
              <p className="text-[11px] text-muted-foreground">{st.n >= 2 ? "primeira → última" : "primeira medida"}</p>
            </div>
            <div className="rounded-xl bg-muted/60 px-3 py-2.5">
              <p className="font-display text-[16px] font-semibold leading-tight tabular-nums">{st.change != null ? changeText(st.change, measure.unit) : "-"}</p>
              <p className="text-[11px] text-muted-foreground">desde o início</p>
            </div>
          </div>
          {st.trend_ready ? <Chart points={points} unit={measure.unit} /> : null}
          <p className="mt-3 rounded-xl bg-primary/5 px-3.5 py-2.5 text-[12px] leading-[18px] text-muted-foreground">
            {ERROR_NOTE}{!st.trend_ready ? ` Com ${st.n} ${st.n === 1 ? "medida" : "medidas"} ainda é cedo para falar em tendência; ela aparece a partir da 4ª.` : ""}
          </p>
        </>
      )}
      <DueButton measure={measure} startedOn={goal.started_on} today={today} onRecord={onRecord} />
    </Card>
  );
}

/** Treinos por semana contra a meta, com a leitura do corpo no mesmo período. Descritivo: andam juntos, sem dizer que um causa o outro. */
export function TrainingVsBodyCard({ goal, view, logs, today }: { goal: GoalData; view: HabitView; logs: LogRow[]; today: string }) {
  const weeks = useMemo(() => {
    const from = weekStart(goal.started_on);
    return weekRows(view.def, logs.filter((l) => l.habit_id === view.habit.id), today, view.pauses).filter((w) => w.week_start >= from).slice(-6);
  }, [goal.started_on, view, logs, today]);
  const hist = weekHistory(weeks);
  const waist = goal.measures.find((m) => m.kind === "waist");
  const weight = goal.measures.find((m) => m.kind === "weight");
  const waistChange = waist ? measureStats(waist.points.map((p) => ({ date: p.date, value: p.value }))).change : null;
  const weightChange = weight ? averageChange(weight.points.map((p) => ({ date: p.date, value: p.value }))) : null;
  const parts: string[] = [];
  if (waist && waistChange != null) parts.push(`a cintura variou ${changeText(waistChange, waist.unit)}`);
  if (weight && weightChange) parts.push(`${parts.length ? "a média do peso, " : "a média do peso variou "}${changeText(weightChange.change, weight.unit)}`);
  const max = Math.max(...weeks.map((w) => Math.max(w.target, w.count)), 1);
  if (weeks.length === 0) return null;
  return (
    <Card title="Treinos × corpo" tag={hist.closed >= 2 ? `${hist.met} de ${hist.closed} semanas` : undefined}>
      <p className="mt-2 font-display text-[18px] font-semibold leading-tight tracking-[-0.02em]">{hist.closed >= 2 ? `Meta batida em ${hist.met} de ${hist.closed} semanas fechadas` : "Treinos por semana"}</p>
      <p className="mt-1 text-[12px] leading-[18px] text-muted-foreground">
        {parts.length > 0 && hist.closed >= 2 ? `No mesmo período ${parts.join(" e ")}. Isso mostra que as coisas andam juntas, não que uma causa a outra.` : "Aqui o treino e as medidas aparecem lado a lado, para você ver se andam juntos."}
      </p>
      <div className="mt-4 flex items-end gap-2" style={{ height: 76 }} role="img" aria-label={`Treinos por semana: ${weeks.map((w) => `${dmShort(w.week_start)} ${num(w.count)} de ${num(w.target)}`).join(", ")}`}>
        {weeks.map((w) => (
          <div key={w.week_start} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[11px] tabular-nums text-foreground">{num(w.count)}</span>
            <i className={cn("block w-full rounded-[6px]", !w.closed ? "border border-dashed border-primary bg-primary/5" : w.met ? "bg-primary" : "bg-primary/30")} style={{ height: `${Math.max(8, (w.count / max) * 52)}px` }} />
            <span className="text-[10px] text-muted-foreground">{dmShort(w.week_start)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-[3px] bg-primary" />Meta batida</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-[3px] bg-primary/30" />Abaixo da meta</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-[3px] border border-dashed border-primary" />Em andamento</span>
      </div>
    </Card>
  );
}
