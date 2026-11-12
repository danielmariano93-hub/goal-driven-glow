import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/hb/ui";
import { WeekSummary } from "@/components/hb/WeekSummary";
import { RegularityOverview, useRegularity } from "@/components/hb/RegularityCard";
import { LockedIndicators, type IndicatorProgress } from "@/components/hb/LockedIndicators";
import { REGULARITY_FORMS, MIN_REGULARITY_DAYS } from "@/lib/habits/engine/regularity";
import { aggregateAdherence, resilience, rowsFor, weekdayAdherence, weakestWeekday, weeklyConsistency, windowDelta } from "@/lib/habits/aggregate";
import { useHabitViews, useNarrateWeek } from "@/lib/habits/api";
import { addDays, weeklyReview } from "@/lib/habits/engine";
import { diffDays } from "@/lib/habits/engine/dates";

const WINDOWS = [7, 30, 90] as const;
const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const WEEKDAY_FULL = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const MONTH = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dm = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTH[Number(iso.slice(5, 7)) - 1]}`;
const pct = (n: number | null) => (n == null ? "-" : `${Math.round(n * 100)}%`);

export default function Progresso() {
  const { views, today, logs, isLoading } = useHabitViews();
  const [win, setWin] = useState<(typeof WINDOWS)[number]>(30);
  const narrate = useNarrateWeek();
  const [aiText, setAiText] = useState<string | null>(null);
  const regIds = useMemo(() => views.filter((v) => REGULARITY_FORMS.has(v.form) && v.habit.kind !== "quit").map((v) => v.habit.id), [views]);
  const reg = useRegularity(regIds);

  const m = useMemo(() => {
    if (!today) return null;
    const inputs = views.map((v) => ({ def: v.def, pauses: v.pauses }));
    const rows = rowsFor(inputs, logs, addDays(today, -(win * 2 + 90)), today, today);
    const adh = aggregateAdherence(rows, today, win, 7);
    const delta = windowDelta(rows, today, win);
    const weekdays = weekdayAdherence(rowsFor(inputs, logs, addDays(today, -83), today, today), today, 84, 4);
    const weeks = weeklyConsistency(rowsFor(inputs, logs, addDays(today, -7 * 12 - 7), today, today), today, 12);
    const res = resilience(rowsFor(inputs, logs, addDays(today, -95), today, today), today, 90);
    return { adh, delta, weekdays, hasWeekdays: weekdays.some((w) => w.adherence != null), weeks, res, weakest: weakestWeekday(weekdays) };
  }, [views, logs, today, win]);

  if (isLoading || !today || !m) return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" /></div>;

  const perHabit = (v: (typeof views)[number]) => (v.summary.closed_count < (v.summary.model === "weekly" ? 2 : 7) ? null : win === 7 ? v.summary.adherence7 : win === 30 ? v.summary.adherence30 : v.summary.adherence90);
  const review = weeklyReview(views.filter((v) => v.habit.sensitivity === "normal").map((v) => ({ def: v.def, pauses: v.pauses })), logs, today);
  const askAi = async () => {
    try {
      const r = await narrate.mutateAsync();
      if (r.source === "ai" && r.text) setAiText(r.text);
      else toast.message("Não consegui reescrever agora. O resumo acima continua valendo.");
    } catch {
      toast.message("Não consegui reescrever agora. O resumo acima continua valendo.");
    }
  };
  const dailyViews = views.filter((v) => v.summary.model === "daily");
  const closedDays = dailyViews.reduce((a, v) => Math.max(a, v.summary.closed_count), 0);
  const weeksWithData = m.weeks.filter((w) => w.value != null && w.n >= 3).length;
  const firstStart = views.reduce<string | null>((a, v) => (a == null || v.habit.started_on < a ? v.habit.started_on : a), null);
  const weeksOfUse = firstStart ? Math.floor(diffDays(firstStart, today) / 7) : 0;
  const bestRegDays = regIds.reduce((a, id) => Math.max(a, reg.days.get(id) ?? 0), 0);
  const locked: IndicatorProgress[] = [];
  if (m.adh == null) locked.push({ key: "const", title: "Constância", what: "Quanto dos seus hábitos diários você fez, com a comparação com o período anterior.", have: closedDays, need: 7, unit: "dias fechados" });
  if (weeksWithData < 3) locked.push({ key: "traj", title: "Constância por semana", what: "A direção das últimas 12 semanas, em vez de um número só.", have: weeksWithData, need: 3, unit: "semanas com dados" });
  if (reg.map.size === 0 && regIds.length > 0) locked.push({ key: "reg", title: "Horário dos hábitos", what: "A hora em que você costuma fazer cada hábito e o quanto ela se repete.", have: bestRegDays, need: MIN_REGULARITY_DAYS, unit: "dias marcados no próprio dia" });
  if (!m.hasWeekdays) locked.push({ key: "wd", title: "Quando você mais consegue", what: "O dia da semana em que você vai melhor e o mais fraco.", have: weeksOfUse, need: 4, unit: "semanas de uso" });
  if (m.res.lapses < 3 && m.res.minimum_days === 0) locked.push({ key: "res", title: "Recomeços", what: "Depois de um dia não feito, você voltou no dia seguinte?", condition: "Aparece quando houver dias não feitos para analisar. Sem falhas, não tem o que mostrar, e isso é bom." });
  const firm = views.filter((v) => v.summary.phase === "firm" || v.summary.phase === "maintenance").length;

  return (
    <div className="px-4 pb-6">
      <PageHeader title="Progresso" />
      <div className="flex rounded-xl bg-muted p-0.5" role="group" aria-label="Período">
        {WINDOWS.map((w) => (
          <button key={w} type="button" aria-pressed={win === w} onClick={() => setWin(w)} className={cn("min-h-9 flex-1 rounded-[10px] text-[12px] font-semibold", win === w ? "bg-card shadow-sm" : "text-muted-foreground")}>{w} dias</button>
        ))}
      </div>

      {views.length === 0 ? (
        <p className="mt-6 text-center text-sm text-muted-foreground">Seu progresso aparece aqui depois do primeiro hábito.</p>
      ) : (
        <>
          <section className="mt-3 rounded-2xl bg-gradient-hero p-4 text-primary-foreground shadow-hero" aria-label="Resumo do período">
            <p className="text-[12px] font-medium text-white/75">Constância dos hábitos diários · {win} dias</p>
            {m.adh == null ? (
              <>
                <p className="mt-1.5 font-display text-[16px] font-semibold leading-tight tracking-[-0.02em]">Ainda juntando dados</p>
                <p className="mt-1 text-[11px] leading-4 text-white/65">Aparece depois de 7 dias de registros. Dia completo vale 1, versão mínima vale 0,6, e hoje só entra quando fecha.</p>
              </>
            ) : (
              <>
                <p className="mt-0.5 font-display text-[34px] font-semibold leading-none tracking-[-0.04em] tabular-nums">{Math.round(m.adh * 100)}<span className="text-[20px] text-white/70">%</span></p>
                <p className="mt-1.5 text-[11px] leading-4 text-white/65">Dia completo vale 1, versão mínima vale 0,6, e hoje só entra quando fecha. Metas semanais ficam em "Por hábito".</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-white/15 pt-3">
                  <div>
                    <dd className="font-display text-[15px] font-semibold tabular-nums">{m.delta.delta_pp == null ? "-" : `${m.delta.delta_pp > 0 ? "+" : ""}${m.delta.delta_pp} pts`}</dd>
                    <dt className="text-[11px] text-white/70">vs. {win} dias antes</dt>
                  </div>
                  <div>
                    <dd className="font-display text-[15px] font-semibold tabular-nums">{firm}</dd>
                    <dt className="text-[11px] text-white/70">{firm === 1 ? "hábito firme" : "hábitos firmes"}</dt>
                  </div>
                </dl>
              </>
            )}
          </section>
          {m.adh != null && m.delta.delta_pp == null ? <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">A comparação aparece quando há dados nos dois períodos.</p> : null}

          {review.length > 0 ? (
            <WeekSummary
              rows={review} views={views} logs={logs} today={today} aiText={aiText}
              footer={aiText ? <p className="mt-2 text-xs text-muted-foreground">Os números vêm dos seus registros; a IA só reescreveu o texto.</p> : <Button variant="ghost" className="-ml-3 mt-1 h-10 rounded-full px-3 text-[13px] text-primary" disabled={narrate.isPending} onClick={() => void askAi()}>Reescrever com IA</Button>}
            />
          ) : null}

          <LockedIndicators items={locked} />
          <TrajectoryCard weeks={m.weeks} />
          <RegularityOverview views={views} />
          <ResilienceCard res={m.res} />

          <section className="mt-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Por hábito">
            <h2 className="mb-2 text-[12px] font-medium text-muted-foreground">Por hábito</h2>
            <ul>
              {views.map((v) => {
                const a = perHabit(v);
                return (
                  <li key={v.habit.id} className="flex items-center gap-3 border-t border-border py-2 first:border-t-0">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{v.habit.title}</span>
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden="true"><i className="block h-full rounded-full bg-primary" style={{ width: `${Math.round((a ?? 0) * 100)}%` }} /></span>
                    {a == null ? <span className="w-16 text-right text-[11px] text-muted-foreground">sem dados</span> : <span className="w-14 text-right text-[13px] font-semibold tabular-nums">{pct(a)}</span>}
                  </li>
                );
              })}
            </ul>
            {views.some((v) => v.summary.model === "weekly") ? <p className="mt-2 text-xs text-muted-foreground">Hábitos de meta semanal mostram a média das semanas fechadas.</p> : null}
          </section>

          {m.hasWeekdays ? (
          <section className="mt-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Por dia da semana">
            <h2 className="mb-2 text-[12px] font-medium text-muted-foreground">Quando você mais consegue</h2>
            {m.hasWeekdays ? (
              <>
                <ul className="grid grid-cols-7 items-end gap-1.5" style={{ height: 96 }}>
                  {m.weekdays.map((w) => (
                    <li key={w.dow} className="flex h-full flex-col items-center justify-end gap-1">
                      <i className={cn("block w-full rounded-md", w.adherence == null ? "bg-muted" : "bg-primary")} style={{ height: `${Math.max(6, Math.round((w.adherence ?? 0.06) * 72))}px` }} title={w.adherence == null ? "sem dados suficientes" : `${Math.round(w.adherence * 100)}%`} />
                      <span className="text-[11px] text-muted-foreground">{WEEKDAY[w.dow]}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] leading-4 text-muted-foreground">Baseado nas últimas 12 semanas. Dias em cinza ainda têm poucos dados.</p>
                {m.weakest ? <p className="mt-2 rounded-xl bg-primary/5 px-3 py-2 text-[12px] leading-[18px] text-muted-foreground">Seu dia mais fraco é <b className="font-medium text-foreground">{WEEKDAY_FULL[m.weakest.dow]}</b> ({pct(m.weakest.adherence)}, contra {pct(m.weakest.best)} no melhor). Vale combinar uma versão mínima para esse dia.</p> : null}
              </>
            ) : null}
          </section>
          ) : null}
          <Link to="/h/dinheiro" className="mt-3 block rounded-2xl border border-border/60 bg-card p-4 text-sm font-semibold text-primary shadow-card">Ver hábitos e dinheiro</Link>
          <p className="mt-4 px-1 text-xs leading-5 text-muted-foreground">Os números descrevem o que aconteceu com você. Não provam por que aconteceu.</p>
        </>
      )}
    </div>
  );
}


function TrajectoryCard({ weeks }: { weeks: ReturnType<typeof weeklyConsistency> }) {
  const withData = weeks.filter((w) => w.value != null && w.n >= 3);
  if (withData.length < 3) return null; // o card "Aparecem quando houver dados" explica o que falta
  const closed = weeks.filter((w) => !w.current && w.value != null && w.n >= 3);
  const avg = (list: typeof closed) => (list.length ? list.reduce((a, w) => a + (w.value ?? 0), 0) / list.length : null);
  const recent = avg(closed.slice(-4));
  const before = closed.length >= 8 ? avg(closed.slice(-8, -4)) : null;
  return (
    <section className="mt-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Trajetória por semana">
      <h2 className="text-[12px] font-medium text-muted-foreground">Constância por semana · últimas 12</h2>
      {recent != null ? (
        <p className="mt-1.5 font-display text-[15px] font-semibold leading-tight tracking-[-0.01em]">
          Últimas 4 semanas: {Math.round(recent * 100)}%{before != null ? <span className="text-[12px] font-normal text-muted-foreground"> (as 4 anteriores: {Math.round(before * 100)}%)</span> : null}
        </p>
      ) : null}
      <div className="mt-3 flex items-end gap-1" style={{ height: 56 }} role="img" aria-label={`Constância por semana: ${weeks.filter((w) => w.value != null).map((w) => `${dm(w.week_start)} ${Math.round((w.value ?? 0) * 100)}%`).join(", ")}`}>
        {weeks.map((w) => (
          <i key={w.week_start} title={w.value == null ? `${dm(w.week_start)}: sem dados` : `${dm(w.week_start)}: ${Math.round(w.value * 100)}%`} className={cn("block flex-1 rounded-[4px]", w.value == null || w.n < 3 ? "bg-muted" : w.current ? "border border-dashed border-primary bg-primary/10" : "bg-primary")} style={{ height: w.value == null || w.n < 3 ? 6 : Math.max(8, Math.round(w.value * 56)) }} />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground" aria-hidden="true"><span>{dm(weeks[0].week_start)}</span><span>esta semana</span></div>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">Só dias fechados entram. A semana em andamento aparece tracejada. O que importa é a direção, não uma semana isolada.</p>
    </section>
  );
}

function ResilienceCard({ res }: { res: ReturnType<typeof resilience> }) {
  if (res.lapses < 3 && res.minimum_days === 0) return null;
  const pctBack = res.lapses > 0 ? Math.round((res.recovered / res.lapses) * 100) : null;
  return (
    <section className="mt-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Recomeços">
      <h2 className="text-[12px] font-medium text-muted-foreground">Recomeços · 90 dias</h2>
      {res.lapses >= 3 ? (
        <>
          <p className="mt-1.5 font-display text-[15px] font-semibold leading-tight tracking-[-0.01em]">Você voltou no dia seguinte {res.recovered} de {res.lapses} vezes{pctBack != null ? <span className="text-[12px] font-normal text-muted-foreground"> ({pctBack}%)</span> : null}</p>
          <p className="mt-1 text-[12px] leading-[18px] text-muted-foreground">Falhar um dia isolado pesa muito pouco na formação de um hábito (Lally e colegas, 2010). O que pesa é não voltar. Por isso este é o número a cuidar.</p>
        </>
      ) : null}
      {res.minimum_days > 0 ? <p className="mt-2 rounded-xl bg-primary/5 px-3 py-2 text-[12px] leading-[18px] text-muted-foreground"><b className="font-medium text-foreground">{res.minimum_days}</b> {res.minimum_days === 1 ? "dia foi salvo" : "dias foram salvos"} pela versão mínima e contaram como feitos.</p> : null}
    </section>
  );
}
