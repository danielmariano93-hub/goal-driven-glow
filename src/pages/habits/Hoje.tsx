import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dial, Dots, ModePill } from "@/components/hb/ui";
import { AutomaticityCard } from "@/components/hb/AutomaticityCard";
import { DayActionsSheet } from "@/components/hb/DayActionsSheet";
import { QuickLogSheet } from "@/components/hb/QuickLogSheet";
import { countsDone, dayFraction, formSubtitle, paceNote, paceOf, paceShort, paceTone, recurringLine } from "@/lib/habits/present";
import { aggregateAdherence, dayAggregates, rowsFor } from "@/lib/habits/aggregate";
import { AreaTile, RowCard, SectionLabel, WeekSteps } from "@/components/hb/kit";
import { sentenceCase } from "@/lib/habits/format";
import { hbErrorMessage, useHabitViews, useHbTemplates, useLogHabit, useSetHbMode, useUnlogHabit, type HabitView } from "@/lib/habits/api";
import { addDays, dayRows } from "@/lib/habits/engine";

const pluralDias = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;

export default function Hoje() {
  const navigate = useNavigate();
  const { views, quitViews, activeCount, today, logs, isLoading, isError, refetch } = useHabitViews();
  const log = useLogHabit();
  const unlog = useUnlogHabit();
  const setMode = useSetHbMode();
  const templates = useHbTemplates();
  const [sheet, setSheet] = useState<{ id: string; date: string } | null>(null);
  const [quick, setQuick] = useState<string | null>(null);

  const model = useMemo(() => {
    if (!today) return null;
    const inputs = views.map((v) => ({ def: v.def, pauses: v.pauses }));
    const from = addDays(today, -29);
    const rows = rowsFor(inputs, logs, from, today, today);
    const days = dayAggregates(rows, from, today, today);
    const daily = views.filter((v) => v.summary.model === "daily");
    const dueToday = daily.filter((v) => v.summary.today.outcome !== "not_expected");
    // Teto só fecha no fim do dia, então não entra na contagem de "feitos hoje".
    const counted = dueToday.filter((v) => v.form !== "ceiling");
    // Hábito semanal entra na conta como um item: "em dia" ou "meta batida" conta como feito; atrasado fica pendente.
    const weeklyAll = views.filter((v) => v.summary.model === "weekly");
    const weeklyPace = weeklyAll.map((v) => ({ v, p: paceOf(v, today) }));
    const pendingWeekly = weeklyPace.filter((x) => x.p && x.p.state !== "met" && x.p.state !== "on_track").map((x) => ({ v: x.v, p: x.p }));
    const total = counted.filter((v) => v.summary.today.outcome !== "rest").length + weeklyAll.length;
    const done = counted.filter(countsDone).length + weeklyPace.filter((x) => x.p && (x.p.state === "met" || x.p.state === "on_track")).length;
    return {
      days, total, done, pendingWeekly,
      dueToday,
      weekly: views.filter((v) => v.summary.model === "weekly"),
      notToday: daily.filter((v) => v.summary.today.outcome === "not_expected"),
      adherence30: aggregateAdherence(rows, today, 30, 7),
      longest: daily.reduce((m, v) => Math.max(m, v.summary.streak), 0),
      firm: views.filter((v) => v.summary.phase === "firm" || v.summary.phase === "maintenance").length,
    };
  }, [views, logs, today]);

  const dotsFor = (v: HabitView) => dayRows(v.def, logs, addDays(today!, -6), today!, today!, v.pauses);

  const quickToggle = async (v: HabitView) => {
    if (!today) return;
    // Só "feito ou não" e "X por semana" marcam com um toque; as outras formas abrem o registro certo.
    if (v.form !== "check" && v.form !== "weekly") {
      setQuick(v.habit.id);
      return;
    }
    try {
      const o = v.summary.today.outcome;
      if (o === "done") await unlog.mutateAsync({ habit_id: v.habit.id, date: today });
      else await log.mutateAsync({ habit_id: v.habit.id, date: today, status: "done" });
    } catch (e) {
      toast.error(hbErrorMessage(e));
    }
  };

  const goMoney = () => {
    setMode.mutate("money");
    navigate("/app");
  };

  if (isLoading) {
    return <div className="grid min-h-[60vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" /></div>;
  }
  if (isError || !today || !model) {
    return (
      <div className="px-4 pt-10 text-center">
        <p className="font-display text-lg font-semibold">Não consegui carregar seus hábitos</p>
        <p className="mt-1 text-sm text-muted-foreground">Seus dados estão salvos. Tente de novo.</p>
        <Button className="mt-4 rounded-full" onClick={() => void refetch()}>Tentar novamente</Button>
      </div>
    );
  }

  const weekday = sentenceCase(new Date(`${today}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }));
  const starters = (templates.data ?? []).filter((t) => ["meditar-5", "caminhar-20", "agua-2l"].includes(t.slug));
  const active = sheet ? views.find((v) => v.habit.id === sheet.id) : undefined;
  const quickView = quick ? views.find((v) => v.habit.id === quick) : undefined;
  const recurring = views.filter((v) => v.summary.model === "recurring");
  const limits = views.filter((v) => v.form === "ceiling");
  const outsideParts = [limits.length > 0 ? `${limits.length} ${limits.length === 1 ? "limite" : "limites"}` : null, recurring.length > 0 ? `${recurring.length} ${recurring.length === 1 ? "cuidado" : "cuidados"}` : null].filter(Boolean) as string[];
  const outsideCount = outsideParts.length;
  const outsideText = `Fora desta conta: ${outsideParts.join(" e ")}.`;

  const renderRow = (v: HabitView) => {
    const o = v.summary.today.outcome;
    const doneNow = countsDone(v);
    const simple = v.form === "check" || v.form === "weekly";
    const frac = dayFraction(v);
    return (
      <li key={v.habit.id} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 pr-2 shadow-card">
        <button
          type="button"
          onClick={() => void quickToggle(v)}
          aria-pressed={simple ? doneNow : undefined}
          aria-label={simple ? (doneNow ? `Desmarcar ${v.habit.title}` : `Marcar ${v.habit.title} como feito`) : `Registrar ${v.habit.title}`}
          className={cn("relative grid h-10 w-10 shrink-0 place-items-center rounded-full border-2 transition-[transform,background-color,border-color] duration-200 active:scale-90", doneNow ? "border-primary bg-primary text-primary-foreground" : o === "rest" ? "border-primary/30 bg-primary/10" : simple ? "border-border bg-card hover:border-primary/50" : "border-primary/30 bg-primary/5 text-primary")}
        >
          {!doneNow && frac != null && frac > 0 ? (
            <svg viewBox="0 0 48 48" className="absolute inset-[-2px] h-[calc(100%+4px)] w-[calc(100%+4px)] -rotate-90" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="none" stroke="hsl(var(--primary))" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${frac * 138.2} 138.2`} /></svg>
          ) : null}
          {doneNow ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="animate-in zoom-in-50 fade-in duration-200"><path d="M5 12l5 5 9-10" /></svg> : o === "rest" ? <span className="text-[10px] font-medium">folga</span> : !simple ? <Plus className="h-5 w-5" strokeWidth={2.4} aria-hidden="true" /> : null}
        </button>
        <Link to={`/h/habito/${v.habit.id}`} className="min-w-0 flex-1 py-1">
          <p className={cn("truncate font-display text-[14px] font-semibold leading-5", doneNow && "text-muted-foreground")}>{v.habit.title}</p>
          <p className="truncate text-xs leading-4 text-muted-foreground">{formSubtitle(v, today) || "Toque para ver o plano"}</p>
          {paceOf(v, today) ? <span className={cn("mt-1 inline-flex max-w-full rounded-full px-2 py-0.5 text-[11px] font-medium leading-4", paceTone(paceOf(v, today)!.state))}>{paceNote(paceOf(v, today))}</span> : null}
        </Link>
        <Dots rows={dotsFor(v)} />
        <button
          type="button"
          aria-label={`Mais opções de ${v.habit.title}`}
          onClick={() => setSheet({ id: v.habit.id, date: today })}
          className="grid h-11 w-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
        </button>
      </li>
    );
  };

  return (
    <div>
      <section className="bg-gradient-hero px-5 pb-10 pt-5 text-primary-foreground" aria-label="Resumo de hoje">
        <div className="mx-auto flex max-w-[720px] items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-medium text-white/75">{weekday}</p>
            <h1 className="mt-1 font-display text-[24px] font-semibold leading-none tracking-[-0.03em]">Hoje</h1>
          </div>
          <ModePill tone="hero" current="habits" onChange={(m) => m === "money" && goMoney()} />
        </div>
        {views.length > 0 ? (
          <>
            <div className="mx-auto mt-1 max-w-[720px]"><Dial days={model.days} done={model.done} total={model.total} withWeekly={model.weekly.length > 0} /></div>
            {model.pendingWeekly.length > 0 ? (
              <ul className="mx-auto -mt-1 mb-2 flex max-w-[720px] flex-wrap justify-center gap-1.5" aria-label="Metas semanais que pedem atenção">
                {model.pendingWeekly.slice(0, 2).map(({ v, p }) => <li key={v.habit.id} className="rounded-full bg-white/15 px-3 py-1 text-[12px] font-medium text-white">{v.habit.title}: {paceShort(p)}</li>)}
                {model.pendingWeekly.length > 2 ? <li className="rounded-full bg-white/15 px-3 py-1 text-[12px] font-medium text-white">+{model.pendingWeekly.length - 2}</li> : null}
              </ul>
            ) : null}
            {outsideCount > 0 ? <p className="mx-auto -mt-1 mb-2 max-w-[720px] text-center text-[12px] text-white/65">{outsideText}</p> : null}
            <dl className="mx-auto -mt-1 flex max-w-[720px] justify-center gap-6 text-[12px]">
              <div><dt className="sr-only">Adesão em 30 dias</dt><dd><b className="text-[14px]">{model.adherence30 == null ? "-" : `${Math.round(model.adherence30 * 100)}%`}</b> <span className="text-white/75">em 30 dias</span></dd></div>
              <div><dt className="sr-only">Maior sequência</dt><dd><b className="text-[14px]">{pluralDias(model.longest)}</b> <span className="text-white/75">seguidos</span></dd></div>
              <div><dt className="sr-only">Hábitos firmes</dt><dd><b className="text-[14px]">{model.firm}</b> <span className="text-white/75">{model.firm === 1 ? "firme" : "firmes"}</span></dd></div>
            </dl>
          </>
        ) : (
          <div className="mx-auto max-w-[720px] pb-6 pt-8">
            <h2 className="font-display text-[24px] font-semibold leading-[1.15] tracking-[-0.025em]">Um hábito vira seu em semanas ou meses.</h2>
            <p className="mt-3 text-[14px] leading-6 text-white/80">Escolha um só para começar, diga em que momento do dia vai fazê-lo e comece pequeno. Sem pontos, sem ranking.</p>
            <WeekSteps className="mt-6" />
          </div>
        )}
      </section>

      <div className="-mt-6 rounded-t-[28px] bg-background px-4 pt-5">
        <div className="mx-auto max-w-[720px]">
          {views.length === 0 && quitViews.length === 0 ? (
            <div>
              {starters.length > 0 ? (
                <>
                  <SectionLabel className="mt-1">Para começar</SectionLabel>
                  <ul className="flex flex-col gap-2">
                    {starters.map((t) => (
                      <li key={t.id}>
                        <Link to={`/h/novo?t=${t.slug}`} className="block">
                          <RowCard lead={<AreaTile area={t.area} title={t.title} />} title={t.title} hint={t.cue_suggestion ? `${t.cue_suggestion}. Dia ruim: ${(t.minimum_suggestion ?? "").toLowerCase()}` : t.why_it_works} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <Button asChild className="mt-4 h-11 w-full rounded-full text-base font-medium">
                <Link to="/h/novo"><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Criar meu primeiro hábito</Link>
              </Button>
            </div>
          ) : (
            <>
              {model.dueToday.length > 0 ? <ul className="flex flex-col gap-2" aria-label="Hábitos de hoje">{model.dueToday.map(renderRow)}</ul> : null}
              {model.weekly.length > 0 ? (
                <>
                  <h2 className="mb-2 mt-5 text-[12px] font-medium text-muted-foreground">Esta semana</h2>
                  <ul className="flex flex-col gap-2" aria-label="Hábitos de meta semanal">{model.weekly.map(renderRow)}</ul>
                </>
              ) : null}
              {recurring.length > 0 ? (
                <>
                  <SectionLabel>Cuidados</SectionLabel>
                  <ul className="flex flex-col gap-2" aria-label="Cuidados recorrentes">
                    {recurring.map((v) => {
                      const last = [...logs].filter((l) => l.habit_id === v.habit.id).map((l) => l.local_date).sort().pop() ?? null;
                      const r = recurringLine(v, last, today);
                      return (
                        <li key={v.habit.id} className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3 pr-2 shadow-card">
                          <AreaTile area={v.habit.area} title={v.habit.title} />
                          <Link to={`/h/habito/${v.habit.id}`} className="min-w-0 flex-1 py-1">
                            <p className="truncate font-display text-[14px] font-semibold leading-5">{v.habit.title}</p>
                            <p className={cn("truncate text-xs leading-4", r.tone === "overdue" ? "text-destructive" : "text-muted-foreground")}>{r.text}</p>
                          </Link>
                          <button type="button" onClick={() => setQuick(v.habit.id)} className="h-9 rounded-full bg-primary/10 px-3.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/15">Fiz hoje</button>
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
              {quitViews.length > 0 ? (
                <>
                  <h2 className="mb-2 mt-5 text-[12px] font-medium text-muted-foreground">Largando</h2>
                  <ul className="flex flex-col gap-2" aria-label="Hábitos que você está largando">
                    {quitViews.map((q) => (
                      <li key={q.habit.id}>
                        <Link to={`/h/largar/${q.habit.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card p-4 shadow-card">
                          <div className="min-w-0"><p className="truncate font-display text-[14px] font-semibold leading-5">{q.habit.title}</p><p className="text-xs text-muted-foreground">recorde {pluralDias(q.stats.best)}</p></div>
                          <p className="shrink-0 text-right font-display text-2xl font-semibold tabular-nums leading-none">{q.stats.days_clean}<span className="block text-[11px] font-semibold text-muted-foreground">{q.stats.days_clean === 1 ? "dia sem" : "dias sem"}</span></p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {model.notToday.length > 0 ? (
                <p className="mt-5 text-xs leading-5 text-muted-foreground">Não previstos hoje: {model.notToday.map((v) => v.habit.title).join(", ")}.</p>
              ) : null}
              {views.some((v) => v.auto_due) ? (
                <div className="mt-5"><AutomaticityCard view={views.find((v) => v.auto_due)!} compact /></div>
              ) : null}
              {activeCount < 5 ? (
                <Button asChild variant="ghost" className="mt-4 h-11 w-full rounded-full text-primary">
                  <Link to="/h/novo"><Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Novo hábito</Link>
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {quickView ? <QuickLogSheet key={quickView.habit.id} view={quickView} date={today} open onOpenChange={(o) => !o && setQuick(null)} /> : null}
      {active && sheet ? <DayActionsSheet view={active} date={sheet.date} today={today} logs={logs} open onOpenChange={(o) => !o && setSheet(null)} /> : null}
    </div>
  );
}
