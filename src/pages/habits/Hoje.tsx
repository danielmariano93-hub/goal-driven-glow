import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dial, Dots, ModePill } from "@/components/hb/ui";
import { DayActionsSheet } from "@/components/hb/DayActionsSheet";
import { aggregateAdherence, dayAggregates, rowsFor } from "@/lib/habits/aggregate";
import { hbErrorMessage, useHabitViews, useLogHabit, useSetHbMode, useUnlogHabit, type HabitView } from "@/lib/habits/api";
import { addDays, dayRows } from "@/lib/habits/engine";

const pluralDias = (n: number) => `${n} ${n === 1 ? "dia" : "dias"}`;

function subtitle(v: HabitView): string {
  const { habit, summary } = v;
  const parts: string[] = [];
  if (habit.kind === "do_quantity" && summary.model === "daily") {
    parts.push(`${summary.today.quantity ?? 0} de ${habit.quantity_target} ${habit.quantity_unit ?? ""}`.trim());
  } else if (summary.model === "weekly" && summary.week) {
    const w = summary.week;
    parts.push(habit.kind === "do_quantity" ? `${Math.round(w.count)} de ${Math.round(w.target)} ${habit.quantity_unit ?? ""}`.trim() : `${Math.min(Math.round(w.count * 10) / 10, 99)} de ${w.target} esta semana`);
  } else if (habit.cue_text) parts.push(habit.cue_text);
  if (summary.streak >= 2) parts.push(`${summary.streak} ${summary.model === "weekly" ? "semanas" : "dias"} seguidos`);
  return parts.join(" · ");
}

export default function Hoje() {
  const navigate = useNavigate();
  const { views, today, logs, isLoading, isError, refetch } = useHabitViews();
  const log = useLogHabit();
  const unlog = useUnlogHabit();
  const setMode = useSetHbMode();
  const [sheet, setSheet] = useState<{ id: string; date: string } | null>(null);

  const model = useMemo(() => {
    if (!today) return null;
    const inputs = views.map((v) => ({ def: v.def, pauses: v.pauses }));
    const from = addDays(today, -29);
    const rows = rowsFor(inputs, logs, from, today, today);
    const days = dayAggregates(rows, from, today, today);
    const daily = views.filter((v) => v.summary.model === "daily");
    const dueToday = daily.filter((v) => v.summary.today.outcome !== "not_expected");
    const total = dueToday.filter((v) => v.summary.today.outcome !== "rest").length;
    const done = dueToday.filter((v) => v.summary.today.outcome === "done" || v.summary.today.outcome === "minimum").length;
    return {
      days, total, done,
      dueToday,
      weekly: views.filter((v) => v.summary.model === "weekly"),
      notToday: daily.filter((v) => v.summary.today.outcome === "not_expected"),
      adherence30: aggregateAdherence(rows, today, 30),
      longest: daily.reduce((m, v) => Math.max(m, v.summary.streak), 0),
      firm: views.filter((v) => v.summary.phase === "firm" || v.summary.phase === "maintenance").length,
    };
  }, [views, logs, today]);

  const dotsFor = (v: HabitView) => dayRows(v.def, logs, addDays(today!, -6), today!, today!, v.pauses);

  const quickToggle = async (v: HabitView) => {
    if (!today) return;
    if (v.habit.kind === "do_quantity" && v.summary.model === "daily") {
      setSheet({ id: v.habit.id, date: today });
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
        <p className="font-display text-lg font-bold">Não consegui carregar seus hábitos</p>
        <p className="mt-1 text-sm text-muted-foreground">Seus dados estão salvos. Tente de novo.</p>
        <Button className="mt-4 rounded-full" onClick={() => void refetch()}>Tentar novamente</Button>
      </div>
    );
  }

  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const active = sheet ? views.find((v) => v.habit.id === sheet.id) : undefined;

  const renderRow = (v: HabitView) => {
    const o = v.summary.today.outcome;
    const doneNow = o === "done" || o === "minimum";
    return (
      <li key={v.habit.id} className="flex items-center gap-3 rounded-[20px] bg-card p-3 shadow-card">
        <button
          type="button"
          onClick={() => void quickToggle(v)}
          aria-pressed={doneNow}
          aria-label={doneNow ? `Desmarcar ${v.habit.title}` : `Marcar ${v.habit.title} como feito`}
          className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 transition-colors", doneNow ? "border-success bg-success text-success-foreground" : o === "rest" ? "border-warning bg-warning/20" : "border-border bg-card")}
        >
          {doneNow ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg> : o === "rest" ? <span className="text-[10px] font-bold">folga</span> : null}
        </button>
        <Link to={`/h/habito/${v.habit.id}`} className="min-w-0 flex-1 py-1">
          <p className={cn("truncate font-display text-[16.5px] font-bold leading-5", doneNow && "text-muted-foreground")}>{v.habit.title}</p>
          <p className="truncate text-xs leading-4 text-muted-foreground">{subtitle(v) || "Toque para ver o plano"}</p>
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
            <p className="text-[13px] font-semibold capitalize tracking-wide text-white/75">{weekday}</p>
            <h1 className="mt-0.5 font-display text-2xl font-extrabold tracking-tight">Hoje</h1>
          </div>
          <ModePill tone="hero" current="habits" onChange={(m) => m === "money" && goMoney()} />
        </div>
        {views.length > 0 ? (
          <>
            <div className="mx-auto mt-1 max-w-[720px]"><Dial days={model.days} done={model.done} total={model.total} /></div>
            <dl className="mx-auto -mt-1 flex max-w-[720px] justify-center gap-6 text-[13px]">
              <div><dt className="sr-only">Adesão em 30 dias</dt><dd><b className="text-[15px]">{model.adherence30 == null ? "-" : `${Math.round(model.adherence30 * 100)}%`}</b> <span className="text-white/75">em 30 dias</span></dd></div>
              <div><dt className="sr-only">Maior sequência</dt><dd><b className="text-[15px]">{pluralDias(model.longest)}</b> <span className="text-white/75">seguidos</span></dd></div>
              <div><dt className="sr-only">Hábitos firmes</dt><dd><b className="text-[15px]">{model.firm}</b> <span className="text-white/75">{model.firm === 1 ? "firme" : "firmes"}</span></dd></div>
            </dl>
          </>
        ) : (
          <div className="mx-auto max-w-[720px] pb-6 pt-8">
            <h2 className="font-display text-[28px] font-extrabold leading-[1.1] tracking-tight">Um hábito vira seu em semanas ou meses.</h2>
            <p className="mt-3 text-[15px] leading-6 text-white/80">Escolha um só para começar, diga em que momento do dia vai fazê-lo e comece pequeno. Sem pontos, sem ranking.</p>
          </div>
        )}
      </section>

      <div className="-mt-6 rounded-t-[28px] bg-background px-4 pt-5">
        <div className="mx-auto max-w-[720px]">
          {views.length === 0 ? (
            <Button asChild className="h-12 w-full rounded-full text-[15px] font-semibold">
              <Link to="/h/novo"><Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Criar meu primeiro hábito</Link>
            </Button>
          ) : (
            <>
              {model.dueToday.length > 0 ? <ul className="flex flex-col gap-2" aria-label="Hábitos de hoje">{model.dueToday.map(renderRow)}</ul> : null}
              {model.weekly.length > 0 ? (
                <>
                  <h2 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Esta semana</h2>
                  <ul className="flex flex-col gap-2" aria-label="Hábitos de meta semanal">{model.weekly.map(renderRow)}</ul>
                </>
              ) : null}
              {model.notToday.length > 0 ? (
                <p className="mt-5 text-xs leading-5 text-muted-foreground">Não previstos hoje: {model.notToday.map((v) => v.habit.title).join(", ")}.</p>
              ) : null}
              {views.length < 5 ? (
                <Button asChild variant="ghost" className="mt-4 h-11 w-full rounded-full text-primary">
                  <Link to="/h/novo"><Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Novo hábito</Link>
                </Button>
              ) : null}
            </>
          )}
        </div>
      </div>

      {active && sheet ? <DayActionsSheet view={active} date={sheet.date} today={today} logs={logs} open onOpenChange={(o) => !o && setSheet(null)} /> : null}
    </div>
  );
}
