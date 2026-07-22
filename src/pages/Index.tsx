import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, CalendarDays, Users, FileBarChart, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { useAccounts, useAccountBalanceSnapshots, useAllTransactions, useGoals, useInvestments, useDebts } from "@/lib/db/finance";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { computeNetWorth, formatBRL, round2, computeAccountStatementTotals } from "@/lib/engine/facts";
import { AssistantTipCard } from "@/components/home/AssistantTipCard";
import { QuickActions } from "@/components/home/QuickActions";
import { WhatsAppCta } from "@/components/home/WhatsAppCta";
import { ParaPagarResumo } from "@/components/home/ParaPagarResumo";
import { ComecePorAqui } from "@/components/home/ComecePorAqui";
import { PulseHero } from "@/components/home/PulseHero";
import { PatrimonioCard } from "@/components/home/PatrimonioCard";
import { PonteCaixaCard } from "@/components/home/PonteCaixaCard";
import { EmotionalCheckinCard } from "@/components/home/EmotionalCheckinCard";
import { AReceberRoleResumo } from "@/components/home/AReceberRoleResumo";
import { GastoMedioDiarioCard } from "@/components/home/GastoMedioDiarioCard";

import { getPeriod, setPeriod as savePeriod, type PeriodKind as Period } from "@/lib/ui/periodStore";

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export default function Index() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const categorizationStarted = useRef(false);
  const initial = useRef(getPeriod()).current;
  const [period, setPeriod] = useState<Period>(initial.period);
  const [customStart, setCustomStart] = useState(initial.customStart);
  const [customEnd, setCustomEnd] = useState(initial.customEnd);

  useEffect(() => {
    savePeriod({ period, customStart, customEnd });
  }, [period, customStart, customEnd]);
  const { data: accounts, isLoading: la } = useAccounts();
  const { data: balanceSnapshots, isLoading: lbs } = useAccountBalanceSnapshots();
  const { data: txs, isLoading: lt } = useAllTransactions();
  const { data: goals } = useGoals();
  const { data: investments } = useInvestments();
  const { data: debts } = useDebts();

  useEffect(() => {
    if (!user?.id || categorizationStarted.current) return;
    categorizationStarted.current = true;

    void (async () => {
      const { data, error } = await (supabase.rpc as any)("apply_safe_category_suggestions");
      if (error) {
        categorizationStarted.current = false;
        console.warn("[safe-category-bootstrap]", error.message);
        return;
      }
      const updated = Number((data as { updated?: number } | null)?.updated ?? 0);
      if (updated > 0) {
        await queryClient.invalidateQueries({ queryKey: ["transactions"] });
        await queryClient.invalidateQueries({ queryKey: ["assistant-tip"] });
        await queryClient.invalidateQueries({ queryKey: ["pulse"] });
        toast.success(`${updated} lançamento${updated === 1 ? " foi organizado" : "s foram organizados"} com segurança.`);
      }
    })();
  }, [queryClient, user?.id]);

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

  // Âncora de saldo: mais recente snapshot confirmado (informativa, discreta).
  const cashAnchor = useMemo(() => {
    const confirmed = (balanceSnapshots ?? []).filter((s) => (s as { status?: string }).status === "confirmed");
    if (confirmed.length === 0) return null;
    const latest = [...confirmed].sort((a, b) => String(b.balance_date).localeCompare(String(a.balance_date)))[0];
    const source = ((latest as { source?: string }).source === "manual" ? "manual" : "statement") as "manual" | "statement";
    return { date: String(latest.balance_date), source };
  }, [balanceSnapshots]);

  const periodSummary = useMemo(() => {
    const end = period === "custom" ? customEnd : isoDate(new Date());
    const startDate = new Date();
    if (period === "month") startDate.setDate(1);
    if (period === "30d") startDate.setDate(startDate.getDate() - 29);
    if (period === "90d") startDate.setDate(startDate.getDate() - 89);
    const start = period === "custom" ? customStart : isoDate(startDate);
    // Fluxo bancário literal: entradas/saídas brutas (inclui resgate/aplicação/estorno)
    // e fatura do cartão separada. Ver computeAccountStatementTotals.
    const totals = computeAccountStatementTotals(
      tx.map((t) => ({ ...t, amount: Number(t.amount) })) as never,
      { start, end },
    );
    return {
      income: round2(totals.accountIn),
      expense: round2(totals.accountOut),
      cardExpense: round2(totals.cardOut),
      start,
      end,
    };
  }, [tx, period, customStart, customEnd]);

  const periodLabel = period === "month" ? "este mês" : period === "30d" ? "nos últimos 30 dias" : period === "90d" ? "nos últimos 90 dias" : "no período";

  const hasAccount = acc.length > 0;
  const hasTransaction = tx.length > 0;
  const hasGoal = (goals ?? []).length > 0;
  const isFresh = !hasAccount && !hasTransaction && !hasGoal;
  return (
    <div className="space-y-5">
      <PeriodFilter period={period} setPeriod={setPeriod} customStart={customStart} customEnd={customEnd} setCustomStart={setCustomStart} setCustomEnd={setCustomEnd} />
      <PatrimonioCard cash={nw.cash} cardsOwed={nw.cardsOwed} invested={nw.invested} otherDebts={nw.otherDebts} net={nw.net} loading={loading} cashAnchor={cashAnchor} />

      <GastoMedioDiarioCard
        txs={tx.map((t) => ({ ...t, amount: Number(t.amount) })) as never}
        range={{ start: periodSummary.start, end: periodSummary.end }}
        loading={loading}
      />

      <PulseHero />

      <AssistantTipCard />

      <QuickActions />

      <div className="grid grid-cols-2 gap-2" aria-label="Atalhos importantes">
        <HomeShortcut to="/app/divisao-do-role" icon={<Users size={16} />} title="Divisão do Rolê" subtitle="Acompanhar cobranças" />
        <HomeShortcut to="/app/relatorios" icon={<FileBarChart size={16} />} title="Relatórios" subtitle="Entender seus números" />
      </div>

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
        <PonteCaixaCard
          income={periodSummary.income}
          expense={periodSummary.expense}
          closing={nw.cash}
          periodLabel={periodLabel}
        />
      )}
      {!isFresh && !loading && periodSummary.cardExpense > 0 && (
        <p className="-mt-2 text-center text-[11px] text-muted-foreground">
          Consumo no cartão {periodLabel}: <strong className="text-foreground">{formatBRL(periodSummary.cardExpense)}</strong> (não entra na ponte de caixa).
        </p>
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
  return <section className="rounded-xl border border-border/70 bg-card px-3 py-2 shadow-sm" aria-label="Período das movimentações">
    <div className="flex items-center gap-2">
      <CalendarDays size={15} className="text-primary" />
      <label htmlFor="home-period" className="text-xs font-medium text-muted-foreground">Movimentações</label>
      <select id="home-period" value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="ml-auto rounded-full border border-border bg-background px-3 py-1 text-xs font-medium">
        <option value="month">Este mês</option><option value="30d">Últimos 30 dias</option><option value="90d">Últimos 90 dias</option><option value="custom">Personalizado</option>
      </select>
    </div>
    {period === "custom" ? <div className="mt-3 grid grid-cols-2 gap-2">
      <label className="text-[11px] text-muted-foreground">De<input type="date" value={customStart} max={customEnd} onChange={(e) => setCustomStart(e.target.value)} className="input-base mt-1" /></label>
      <label className="text-[11px] text-muted-foreground">Até<input type="date" value={customEnd} min={customStart} onChange={(e) => setCustomEnd(e.target.value)} className="input-base mt-1" /></label>
    </div> : null}
  </section>;
}

function HomeShortcut({to,icon,title,subtitle}:{to:string;icon:React.ReactNode;title:string;subtitle:string}) {
  return <Link to={to} className="flex min-w-0 items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-card">
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">{icon}</span>
    <span className="min-w-0"><strong className="block truncate text-xs">{title}</strong><span className="block truncate text-[10px] text-muted-foreground">{subtitle}</span></span>
  </Link>;
}
