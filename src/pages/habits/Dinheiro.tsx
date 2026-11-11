import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/hb/ui";
import { useExpenseCategories, useHabitViews, useQuitMoney, useWeeklyCategorySpend, type HabitView } from "@/lib/habits/api";
import { moneyInsight, weekPoints } from "@/lib/habits/engine";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function InsightCard({ view, categoryId, categoryName, today, logs }: { view: HabitView; categoryId: string; categoryName: string; today: string; logs: ReturnType<typeof useHabitViews>["logs"] }) {
  const spend = useWeeklyCategorySpend(categoryId, 12);
  const insight = useMemo(() => (spend.data ? moneyInsight(weekPoints(view.def, logs, today, spend.data, view.pauses)) : null), [spend.data, view, logs, today]);
  return (
    <li className="rounded-2xl border border-border/60 bg-card p-4 shadow-card">
      <Link to={`/h/habito/${view.habit.id}`} className="font-display text-base font-semibold">{view.habit.title}</Link>
      <p className="text-xs text-muted-foreground">Gasto semanal em {categoryName}</p>
      {!insight ? <Loader2 className="mt-3 h-4 w-4 animate-spin text-primary" aria-label="Carregando" /> : insight.status === "ok" ? (
        <>
          <p className="mt-3 text-[15px] leading-6">Nas semanas em que você manteve este hábito (a partir de 70% dos dias), o gasto médio em {categoryName} foi de <b>{brl(insight.mean_high)}</b>; nas outras, <b>{brl(insight.mean_low)}</b>.</p>
          <p className="mt-1 text-[13px] leading-5 text-muted-foreground">Baseado em {insight.weeks} semanas ({insight.high_n} firmes e {insight.low_n} nas demais). É uma associação, não prova que um causa o outro.</p>
        </>
      ) : insight.status === "no_difference" ? (
        <p className="mt-3 text-sm leading-5 text-muted-foreground">Em {insight.weeks} semanas, não vejo diferença relevante no gasto entre as semanas firmes e as demais.</p>
      ) : (
        <p className="mt-3 text-sm leading-5 text-muted-foreground">
          {insight.reason === "weeks" ? `Ainda é cedo: preciso de pelo menos 8 semanas de dados e tenho ${insight.weeks}. Faltam ${insight.needed}.` : "Ainda é cedo: preciso de pelo menos 3 semanas firmes e 3 nas demais para comparar."} Não vou tirar conclusão com pouca informação.
        </p>
      )}
    </li>
  );
}

/** Hábitos e dinheiro: o que o hábito medido e o gasto da categoria mostram juntos. */
export default function Dinheiro() {
  const { views, quitViews, rules, today, logs, isLoading } = useHabitViews();
  const categories = useExpenseCategories(true);
  const money = useQuitMoney(quitViews.length > 0);
  if (isLoading || !today) return <div className="grid min-h-[50vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-primary" aria-label="Carregando" /></div>;
  const nameOf = (id: string) => (categories.data ?? []).find((c) => c.id === id)?.name ?? "a categoria";
  const measured = views.map((v) => ({ v, rule: rules.find((r) => r.habit_id === v.habit.id) })).filter((x): x is { v: HabitView; rule: (typeof rules)[number] } => !!x.rule);
  const total = quitViews.reduce((s, q) => s + (money.data?.[q.habit.id]?.estimate ?? 0), 0);
  const empty = measured.length === 0 && quitViews.length === 0;
  return (
    <div className="px-4 pb-6">
      <PageHeader title="Hábitos e dinheiro" subtitle="Só o que o Nino consegue medir pelos seus lançamentos" back="/h/mais" />
      {empty ? (
        <div className="rounded-2xl border border-border/60 bg-card p-5 text-center shadow-card">
          <p className="font-display text-lg font-semibold">Nada ligado ao dinheiro ainda</p>
          <p className="mx-auto mt-1 max-w-xs text-sm leading-5 text-muted-foreground">Crie um hábito de largar (como delivery por impulso) ou, no detalhe de um hábito, escolha “Medir pelo Nino”.</p>
        </div>
      ) : null}
      {quitViews.length > 0 ? (
        <section className="mb-4 rounded-2xl border border-border/60 bg-card p-4 shadow-card" aria-label="Dinheiro que ficou com você">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-medium text-muted-foreground">Dinheiro que ficou com você</h2>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[12px] font-medium text-primary">estimativa</span>
          </div>
          <p className="mt-2 font-display text-[30px] font-semibold leading-none tabular-nums">{brl(total)}</p>
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {quitViews.map((q) => <li key={q.habit.id} className="flex justify-between gap-3"><Link to={`/h/largar/${q.habit.id}`} className="truncate">{q.habit.title}</Link><span className="shrink-0 tabular-nums text-muted-foreground">{money.data?.[q.habit.id]?.estimate != null ? brl(money.data[q.habit.id].estimate as number) : "sem base"}</span></li>)}
          </ul>
          <p className="mt-2 text-[13px] leading-5 text-muted-foreground">Média de gasto antes de começar menos o que você gastou depois. É uma estimativa, não um extrato.</p>
        </section>
      ) : null}
      {measured.length > 0 ? (
        <ul className="flex flex-col gap-3" aria-label="Hábitos medidos">
          {measured.map(({ v, rule }) => <InsightCard key={v.habit.id} view={v} categoryId={rule.category_id} categoryName={nameOf(rule.category_id)} today={today} logs={logs} />)}
        </ul>
      ) : null}
    </div>
  );
}
