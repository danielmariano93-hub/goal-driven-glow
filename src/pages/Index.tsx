import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { Loader2, ArrowUpRight, ArrowDownRight, CalendarDays } from "lucide-react";
import { useAccounts, useAccountBalanceSnapshots, useAllTransactions, useGoals, useInvestments, useDebts } from "@/lib/db/finance";
import { computeNetWorth, formatBRL, round2, txOrigin } from "@/lib/engine/facts";
import { AssistantTipCard } from "@/components/home/AssistantTipCard";
import { QuickActions } from "@/components/home/QuickActions";
import { WhatsAppCta } from "@/components/home/WhatsAppCta";
import { ParaPagarResumo } from "@/components/home/ParaPagarResumo";
import { ComecePorAqui } from "@/components/home/ComecePorAqui";
import { PulseHero } from "@/components/home/PulseHero";
import { PatrimonioCard } from "@/components/home/PatrimonioCard";
import { EmotionalCheckinCard } from "@/components/home/EmotionalCheckinCard";
import { AReceberRoleResumo } from "@/components/home/AReceberRoleResumo";

type Period = "month" | "30d" | "90d" | "custom";

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function Index() {
  const [period, setPeriod] = useState<Period>("month");
  const [customStart, setCustomStart] = useState(isoDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [customEnd, setCustomEnd] = useState(isoDate(new Date()));
  const { data: accounts, isLoading: la } = useAccounts();
  const { data: balanceSnapshots, isLoading: lbs } = useAccountBalanceSnapshots();
  const { data: txs, isLoading: lt } = useAllTransactions();
  const { data: goals } = useGoals();
  const { data: investments } = useInvestments();
  const { data: debts } = useDebts();

  const loading = la || lt || lbs;
  const acc = accounts ?? [];
  const tx = txs ?? [];

  const nw = computeNetWorth(
    acc.map((a) => ({ id: a.id, name: a.name, type: a.type, opening_balance: Number(a.opening_balance), active: a.active })),
    tx.map((t) => ({ ...t, amount: Number(t.amount) })) as never,
    (investments ?? []).map((i) => ({ id: i.id, name: i.name, invested_amount: Number(i.invested_amount), current_value: Number(i.current_value), goal_id: i.goal_id })),
    (debts ?? []).map((d) => ({ id: d.id, name: d.name, outstanding_balance: Number(d.outstanding_balance), original_amount: Number(d.original_amount), status: d.status })),
    (balanceSnapshots ?? []).map((s) => ({ ...s, balance: Number(s.balance) }))
  );

  const periodSummary = useMemo(() => {
    const end = period === "custom" ? customEnd : isoDate(new Date());
    const startDate = new Date();
    if (period === "month") startDate.setDate(1);
    if (period === "30d") startDate.setDate(startDate.getDate() - 29);
    if (period === "90d") startDate.setDate(startDate.getDate() - 89);
    const start = period === "custom" ? customStart : isoDate(startDate);
    const filtered = tx.filter((item) => item.status === "confirmed" && item.type !== "transfer" &&
      !["internal_transfer","investment_application","investment_redemption"].includes((item as { movement_kind?: string }).movement_kind ?? "transaction") &&
      item.occurred_at >= start && item.occurred_at <= end);
    const accountIncome = filtered.filter((item) => item.type === "income" && txOrigin(item as never) === "account").reduce((sum, item) => sum + Number(item.amount), 0);
    const accountExpense = filtered.filter((item) => item.type === "expense" && txOrigin(item as never) === "account").reduce((sum, item) => sum + Number(item.amount), 0);
    const cardExpense = filtered.filter((item) => item.type === "expense" && txOrigin(item as never) === "credit_card").reduce((sum, item) => sum + Number(item.amount), 0);
    return { income: round2(accountIncome), expense: round2(accountExpense), cardExpense: round2(cardExpense), start, end };
  }, [tx, period, customStart, customEnd]);

  const periodLabel = period === "month" ? "este mês" : period === "30d" ? "nos últimos 30 dias" : period === "90d" ? "nos últimos 90 dias" : "no período";

  const hasAccount = acc.length > 0;
  const hasTransaction = tx.length > 0;
  const hasGoal = (goals ?? []).length > 0;
  const isFresh = !hasAccount && !hasTransaction && !hasGoal;

  return (
    <div className="space-y-5">
      <PeriodFilter period={period} setPeriod={setPeriod} customStart={customStart} customEnd={customEnd} setCustomStart={setCustomStart} setCustomEnd={setCustomEnd} />
      <PatrimonioCard cash={nw.cash} cardsOwed={nw.cardsOwed} invested={nw.invested} otherDebts={nw.otherDebts} net={nw.net} loading={loading} />

      <PulseHero />

      <AssistantTipCard />

      <QuickActions />

      <WhatsAppCta />

      <ParaPagarResumo />

      <AReceberRoleResumo />

      {loading ? (
        <div className="grid place-items-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isFresh ? (
        <ComecePorAqui hasAccount={hasAccount} hasTransaction={hasTransaction} hasGoal={hasGoal} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Kpi
            label={`Entrou ${periodLabel}`}
            value={formatBRL(periodSummary.income)}
            icon={<ArrowUpRight />}
            accent="text-success"
          />
          <Kpi
            label={`Saiu da conta ${periodLabel}`}
            value={formatBRL(periodSummary.expense)}
            icon={<ArrowDownRight />}
            accent="text-destructive"
            sub={periodSummary.cardExpense > 0 ? `+ ${formatBRL(periodSummary.cardExpense)} foi para a fatura do cartão` : undefined}
          />
        </div>
      )}

      <EmotionalCheckinCard />

      {!isFresh && (
        <div className="flex justify-center pt-1">
          <Link
            to="/app/mais"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Ver tudo que dá pra fazer aqui
          </Link>
        </div>
      )}
    </div>
  );
}

function PeriodFilter({ period, setPeriod, customStart, customEnd, setCustomStart, setCustomEnd }: {
  period: Period; setPeriod: (value: Period) => void; customStart: string; customEnd: string;
  setCustomStart: (value: string) => void; setCustomEnd: (value: string) => void;
}) {
  return <section className="rounded-2xl border border-border bg-card p-3 shadow-sm" aria-label="Período das movimentações">
    <div className="flex items-center gap-2">
      <CalendarDays size={15} className="text-primary" />
      <label htmlFor="home-period" className="text-xs font-semibold">Período das movimentações</label>
      <select id="home-period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="ml-auto rounded-full border border-border bg-background px-3 py-1.5 text-xs">
        <option value="month">Este mês</option><option value="30d">Últimos 30 dias</option><option value="90d">Últimos 90 dias</option><option value="custom">Personalizado</option>
      </select>
    </div>
    {period === "custom" ? <div className="mt-3 grid grid-cols-2 gap-2">
      <label className="text-[11px] text-muted-foreground">De<input type="date" value={customStart} max={customEnd} onChange={(e) => setCustomStart(e.target.value)} className="input-base mt-1" /></label>
      <label className="text-[11px] text-muted-foreground">Até<input type="date" value={customEnd} min={customStart} onChange={(e) => setCustomEnd(e.target.value)} className="input-base mt-1" /></label>
    </div> : null}
    <p className="mt-2 text-[10px] text-muted-foreground">O filtro ajusta entradas e gastos. Seu patrimônio continua mostrando a posição de hoje.</p>
  </section>;
}

function Kpi({ label, value, icon, accent, sub }: { label: string; value: string; icon: React.ReactNode; accent: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card min-w-0">
      <div className={`flex items-center gap-2 text-[11px] ${accent}`}>
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        <span className="font-medium truncate">{label}</span>
      </div>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</p>
      {sub ? <p className="mt-0.5 text-[10px] text-muted-foreground leading-tight">{sub}</p> : null}
    </div>
  );
}
