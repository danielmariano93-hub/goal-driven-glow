import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { HabitView } from "@/lib/habits/api";
import {
  achievementsFor, addDays, ceilingStats, dayRows, hhmm, projectStats, recurringStatus, timeStats, valueTrend, weekRows, type LogRow,
} from "@/lib/habits/engine";
import { DayRhythmCard } from "@/components/hb/Rhythm";
import { ReadingNotes } from "@/components/hb/ReadingNotes";
import { weekHistory } from "@/lib/habits/engine/rhythm";
import { OUT_OF_REACH_HINT, paceNote, paceOf, paceTone, targetText, weekTargetNote } from "@/lib/habits/present";

const num = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const WD = ["D", "S", "T", "Q", "Q", "S", "S"];

const Card = ({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) => (
  <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label={title}>
    <div className="flex items-center justify-between"><h2 className="text-[12px] font-medium text-muted-foreground">{title}</h2>{tag ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">{tag}</span> : null}</div>
    {children}
  </section>
);

/** Barras dos últimos 7 dias com linha de meta opcional. */
function Bars({ values, labels, target, today }: { values: Array<number | null>; labels: string[]; target?: number; today: number }) {
  const max = Math.max(target ?? 0, ...values.map((v) => v ?? 0), 1);
  return (
    <div>
      <div className="relative mt-3 grid h-16 grid-cols-7 items-end gap-1.5">
        {target ? <i className="pointer-events-none absolute inset-x-0 border-t border-dashed border-primary/40" style={{ bottom: `${(target / max) * 100}%` }} aria-hidden="true" /> : null}
        {values.map((v, i) => <i key={i} className={cn("block w-full rounded-md transition-[height] duration-500", i === today ? "bg-primary" : v ? "bg-primary/35" : "bg-muted")} style={{ height: `${Math.max(5, ((v ?? 0) / max) * 100)}%` }} />)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1.5">{labels.map((l, i) => <span key={i} className="text-center text-[11px] text-muted-foreground">{l}</span>)}</div>
    </div>
  );
}

function Spark({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const d = points.map((p, i) => `${(i / (points.length - 1)) * 100},${40 - ((p - min) / span) * 32 - 4}`).join(" ");
  return <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="mt-3 h-11 w-full" role="img" aria-label="Tendência"><polyline points={d} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" /></svg>;
}

/** Progresso próprio de cada forma de medir: o que a pessoa vê muda conforme o hábito. */
export function FormProgress({ view, today, logs }: { view: HabitView; today: string; logs: LogRow[] }) {
  const mine = useMemo(() => logs.filter((l) => l.habit_id === view.habit.id), [logs, view.habit.id]);
  const days7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const qtyOf = (d: string) => mine.find((l) => l.local_date === d && l.status === "quantity")?.quantity ?? null;
  const labels = days7.map((d) => WD[new Date(`${d}T12:00:00Z`).getUTCDay()]);
  const target = view.habit.quantity_target ?? 0;
  const unit = view.habit.quantity_unit ?? "";

  switch (view.form) {
    case "amount":
    case "duration": {
      const vals = days7.map(qtyOf);
      const filled = vals.filter((v): v is number => v != null && v > 0);
      const avg = filled.length ? filled.reduce((a, b) => a + b, 0) / filled.length : null;
      const best = filled.length ? Math.max(...filled) : null;
      const totalMin = view.form === "duration" ? mine.reduce((a, l) => a + (l.status === "quantity" ? l.quantity ?? 0 : 0), 0) : 0;
      return (
        <>
        {view.form === "amount" && target > 0 ? <DayRhythmCard view={view} today={today} logs={logs} /> : null}
        <Card title={view.form === "duration" ? "Minutos por dia" : `${unit ? unit[0].toUpperCase() + unit.slice(1) : "Quantidade"} por dia`} tag="meta tracejada">
          <Bars values={vals} labels={labels} target={target} today={6} />
          <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div><dd className="font-display text-lg font-semibold tabular-nums">{avg == null ? "-" : num(avg)}</dd><dt className="text-[11px] text-muted-foreground">média (7 dias)</dt></div>
            <div><dd className="font-display text-lg font-semibold tabular-nums">{best == null ? "-" : num(best)}</dd><dt className="text-[11px] text-muted-foreground">melhor dia</dt></div>
            <div><dd className="font-display text-lg font-semibold tabular-nums">{view.form === "duration" ? `${Math.floor(totalMin / 60)} h` : view.summary.streak}</dd><dt className="text-[11px] text-muted-foreground">{view.form === "duration" ? "no total" : "dias seguidos"}</dt></div>
          </dl>
        </Card>
        </>
      );
    }
    case "weekly": {
      const weeks = weekRows(view.def, mine, today, view.pauses).slice(-8);
      const cur = weeks[weeks.length - 1];
      const hist = weekHistory(weeks);
      return (
        <Card title="Esta semana" tag={`${view.summary.streak} ${view.summary.streak === 1 ? "semana" : "semanas"} seguidas`}>
          {cur ? (
            <>
              <p className="mt-2 font-display text-[22px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{Math.min(Math.round(cur.count * 10) / 10, 99)}<span className="text-[15px] font-normal text-muted-foreground"> de {cur.target}</span></p>
              <div className="mt-3 flex gap-1.5" aria-hidden="true">{Array.from({ length: cur.target }, (_, i) => <i key={i} className={cn("h-2 flex-1 rounded-full", i < Math.floor(cur.count) ? "bg-primary" : "bg-muted")} />)}</div>
            </>
          ) : null}
          {paceOf(view, today) ? <p className={cn("mt-3 inline-flex rounded-full px-2.5 py-1 text-[12px] font-medium", paceTone(paceOf(view, today)!.state))}>{paceNote(paceOf(view, today))}</p> : null}
          {paceOf(view, today)?.state === "out_of_reach" ? <p className="mt-2 text-[12px] leading-[18px] text-muted-foreground">{OUT_OF_REACH_HINT}</p> : null}
          {weekTargetNote(view, cur) ? <p className="mt-3 rounded-xl bg-primary/5 px-3.5 py-2.5 text-[12px] leading-[18px] text-muted-foreground">{weekTargetNote(view, cur)}</p> : null}
          <p className="mt-4 text-[12px] text-muted-foreground">{hist.closed >= 2 ? `Meta batida em ${hist.met} de ${hist.closed} semanas fechadas` : "Últimas semanas"}</p>
          <div className="mt-1 grid grid-cols-8 items-end gap-1.5" style={{ height: 44 }}>{weeks.map((w) => <i key={w.week_start} title={dm(w.week_start)} className={cn("block w-full rounded-md", w.met ? "bg-primary" : w.progress > 0 ? "bg-primary/35" : "bg-muted")} style={{ height: `${Math.max(10, w.progress * 100)}%` }} />)}</div>
        </Card>
      );
    }
    case "time": {
      const vals = mine.filter((l) => l.status === "quantity" && l.quantity != null).slice(-14).map((l) => l.quantity as number);
      const st = timeStats(vals, target);
      return (
        <Card title="Regularidade do horário" tag={targetText(view)}>
          {st.n === 0 ? <p className="mt-2 text-[14px] text-muted-foreground">Registre o horário por alguns dias e eu mostro a sua regularidade.</p> : (
            <>
              <p className="mt-2 font-display text-[22px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{hhmm(st.avg_min ?? 0)}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">horário médio nos últimos {st.n} registros</p>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div><dd className="font-display text-lg font-semibold tabular-nums">{st.within}/{st.n}</dd><dt className="text-[11px] text-muted-foreground">dentro do alvo</dt></div>
                <div><dd className="font-display text-lg font-semibold tabular-nums">±{st.spread_min} min</dd><dt className="text-[11px] text-muted-foreground">variação</dt></div>
                <div><dd className="font-display text-lg font-semibold tabular-nums">{(st.vs_target_min ?? 0) > 0 ? "+" : ""}{st.vs_target_min} min</dd><dt className="text-[11px] text-muted-foreground">vs. o alvo</dt></div>
              </dl>
            </>
          )}
        </Card>
      );
    }
    case "ceiling": {
      const rows = dayRows(view.def, mine, addDays(today, -13), today, today, view.pauses);
      const vals = rows.map((r) => mine.find((l) => l.local_date === r.date)?.quantity).filter((v): v is number => v != null);
      const st = ceilingStats(vals, target, rows.filter((r) => r.outcome !== "not_expected" && r.outcome !== "unlogged").length);
      const todayQ = qtyOf(today);
      return (
        <Card title="Dentro do limite" tag={targetText(view)}>
          <p className="mt-2 font-display text-[22px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{st.within}<span className="text-[15px] font-normal text-muted-foreground"> de {st.days} dias</span></p>
          <div className="mt-3 h-2 rounded-full bg-muted" role="img" aria-label="Hoje contra o limite"><i className={cn("block h-full rounded-full transition-[width] duration-500", (todayQ ?? 0) > target ? "bg-destructive" : "bg-primary")} style={{ width: `${Math.min(100, target > 0 ? ((todayQ ?? 0) / target) * 100 : (todayQ ?? 0) > 0 ? 100 : 0)}%` }} /></div>
          <p className="mt-2 text-[12px] text-muted-foreground">Hoje: {todayQ == null ? "nada registrado" : `${num(todayQ)} ${unit}`}{st.avg != null ? ` · média: ${num(st.avg)}` : ""}. Dias sem registro contam como dentro do limite.</p>
        </Card>
      );
    }
    case "value": {
      const pts = mine.filter((l) => l.status === "quantity" && (l.quantity ?? 0) > 0).map((l) => ({ date: l.local_date, value: l.quantity as number }));
      const t = valueTrend(pts, today, target > 0 ? target : null);
      return (
        <Card title="Tendência" tag={target > 0 ? `meta ${num(target)}` : "sem meta"}>
          {t.last == null ? <p className="mt-2 text-[14px] text-muted-foreground">Registre o primeiro valor e eu desenho a tendência.</p> : (
            <>
              <p className="mt-2 font-display text-[22px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{num(t.last)}<span className="text-[15px] font-normal text-muted-foreground"> {unit}</span></p>
              <Spark points={pts.slice(-30).map((p) => p.value)} />
              <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div><dd className="font-display text-lg font-semibold tabular-nums">{t.delta_30 == null ? "-" : `${t.delta_30 > 0 ? "+" : ""}${num(t.delta_30)}`}</dd><dt className="text-[11px] text-muted-foreground">em 30 dias</dt></div>
                <div><dd className="font-display text-lg font-semibold tabular-nums">{num(t.min ?? 0)}</dd><dt className="text-[11px] text-muted-foreground">menor</dt></div>
                <div><dd className="font-display text-lg font-semibold tabular-nums">{num(t.max ?? 0)}</dd><dt className="text-[11px] text-muted-foreground">maior</dt></div>
              </dl>
              {t.toward_goal != null ? <p className="mt-2 text-[12px] text-muted-foreground">{t.toward_goal ? "Você está se aproximando da meta." : "Você está se afastando da meta neste período. Isso oscila; olhe a tendência, não um dia."}</p> : null}
            </>
          )}
        </Card>
      );
    }
    case "project": {
      const proj = view.project;
      const recent = days7.map((d) => qtyOf(d) ?? 0);
      const recent15 = Array.from({ length: 15 }, (_, i) => qtyOf(addDays(today, i - 14)) ?? 0);
      const p = proj ? projectStats(proj.total, proj.current, recent15, today) : null;
      return (
        <>
          <Card title={proj ? proj.title : "Projeto"} tag={p ? `${p.percent}%` : undefined}>
            {proj && p ? (
              <>
                <p className="mt-2 font-display text-[22px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{num(proj.current)}<span className="text-[15px] font-normal text-muted-foreground"> de {num(proj.total)} {proj.unit ?? ""}</span></p>
                <div className="relative mt-3 h-2 rounded-full bg-muted"><i className="block h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${p.percent}%` }} />{[25, 50, 75].map((m) => <b key={m} className="absolute top-[-2px] h-3 w-0.5 bg-card" style={{ left: `${m}%` }} aria-hidden="true" />)}</div>
                <div className="mt-1 flex justify-between text-[11px] text-muted-foreground" aria-hidden="true"><span>0</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
                <div className="mt-3 rounded-xl bg-primary/5 px-3.5 py-2.5 text-[12px] leading-5">
                  {p.done ? "Projeto concluído." : p.eta && p.days_left != null ? <><b className="font-medium">Termina em {p.days_left} {p.days_left === 1 ? "dia" : "dias"} ({dm(p.eta)})</b><span className="text-muted-foreground"> no ritmo de {num(p.pace ?? 0)} {proj.unit ?? ""} por dia (média dos dias fechados, contando os sem leitura). Faltam {num(p.remaining)}.</span></> : <span className="text-muted-foreground">Faltam {num(p.remaining)} {proj.unit ?? ""}. A previsão aparece depois de 3 dias com leitura.</span>}
                </div>
                <Bars values={recent} labels={labels} today={6} />
              </>
            ) : <p className="mt-2 text-[14px] text-muted-foreground">Nenhum projeto em andamento. Toque no hábito em Hoje para começar o próximo.</p>}
          </Card>
          <ReadingNotes view={view} today={today} />
          {view.projects_done.length > 0 ? (
            <Card title="Concluídos" tag={String(view.projects_done.length)}>
              <ul className="mt-2 divide-y divide-border/60">{view.projects_done.map((x) => <li key={x.id} className="flex items-center justify-between gap-3 py-2 text-[14px]"><span className="truncate font-medium">{x.title}</span><span className="shrink-0 text-[12px] text-muted-foreground">{x.finished_on ? dm(x.finished_on) : ""}</span></li>)}</ul>
            </Card>
          ) : null}
        </>
      );
    }
    case "steps": {
      const rows = dayRows(view.def, mine, addDays(today, -13), today, today, view.pauses);
      const full = rows.filter((r) => r.outcome === "done").length;
      return (
        <Card title="Rotina de hoje" tag={`${view.steps_today.length} de ${view.steps.length}`}>
          <ul className="mt-2 flex flex-col gap-1.5">{view.steps.map((s) => <li key={s.id} className="flex items-center gap-2.5 text-[14px]"><i className={cn("block h-2.5 w-2.5 rounded-full", view.steps_today.includes(s.id) ? "bg-primary" : "border border-muted-foreground/40")} /><span className={cn(view.steps_today.includes(s.id) && "text-muted-foreground line-through")}>{s.title}</span></li>)}</ul>
          <p className="mt-3 text-[12px] text-muted-foreground">Rotina completa em {full} dos últimos 14 dias.</p>
        </Card>
      );
    }
    case "recurring": {
      const last = mine.map((l) => l.local_date).sort().pop() ?? null;
      const st = recurringStatus(last, view.habit.started_on, view.habit.interval_days ?? 30, today);
      return (
        <Card title="Próximo cuidado" tag={`a cada ${view.habit.interval_days} dias`}>
          <p className={cn("mt-2 font-display text-[22px] font-semibold leading-tight tracking-[-0.02em]", st.state === "overdue" && "text-destructive")}>
            {st.state === "overdue" ? `Atrasado há ${Math.abs(st.days_to ?? 0)} dias` : st.days_to === 0 ? "É hoje" : `Em ${st.days_to} dias`}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">{st.next ? `Previsto para ${dm(st.next)}.` : ""} {last ? `Última vez: ${dm(last)}.` : "Ainda não registrado."}</p>
        </Card>
      );
    }
    default:
      return null;
  }
}

/** Conquistas de marco: progresso real, sem pontos nem ranking. */
export function AchievementsCard({ view, today, logs }: { view: HabitView; today: string; logs: LogRow[] }) {
  const mine = logs.filter((l) => l.habit_id === view.habit.id);
  const proj = view.project ? projectStats(view.project.total, view.project.current, [], today) : null;
  const weeks = view.summary.model === "weekly" ? view.summary.streak : 0;
  const list = achievementsFor({
    form: view.form, best_streak: view.summary.best_streak,
    total_minutes: view.form === "duration" ? mine.reduce((a, l) => a + (l.status === "quantity" ? l.quantity ?? 0 : 0), 0) : 0,
    project_percent: proj?.percent ?? 0, projects_done: view.projects_done.length, weeks_in_a_row: weeks,
  });
  if (list.length === 0) return null;
  const earned = list.filter((a) => a.earned).length;
  return (
    <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Conquistas">
      <div className="flex items-center justify-between"><h2 className="text-[12px] font-medium text-muted-foreground">Conquistas</h2><span className="text-[12px] text-muted-foreground">{earned} de {list.length}</span></div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {list.map((a) => <li key={a.key} title={a.hint} className={cn("rounded-full border px-3 py-1 text-[12px] font-medium", a.earned ? "border-primary/40 bg-primary/10 text-foreground" : "border-border text-muted-foreground")}>{a.title}</li>)}
      </ul>
      <p className="mt-2 text-[12px] text-muted-foreground">Marcos do seu próprio progresso. Sem pontos e sem ranking.</p>
    </section>
  );
}
