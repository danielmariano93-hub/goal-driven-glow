import { Link } from "react-router-dom";
import { Loader2, ArrowUpRight, ArrowDownRight, Info } from "lucide-react";
import { useAccounts, useAllTransactions, useGoals, useInvestments, useDebts } from "@/lib/db/finance";
import { computeNetWorth, computeMonthlyIncomeExpense, formatBRL } from "@/lib/engine/facts";
import { useAuth } from "@/context/AuthContext";
import { AssistantTipCard } from "@/components/home/AssistantTipCard";
import { QuickActions } from "@/components/home/QuickActions";
import { WhatsAppCta } from "@/components/home/WhatsAppCta";
import { ParaPagarResumo } from "@/components/home/ParaPagarResumo";
import { ComecePorAqui } from "@/components/home/ComecePorAqui";

export default function Index() {
  const { profile } = useAuth();
  const { data: accounts, isLoading: la } = useAccounts();
  const { data: txs, isLoading: lt } = useAllTransactions();
  const { data: goals } = useGoals();
  const { data: investments } = useInvestments();
  const { data: debts } = useDebts();

  const loading = la || lt;
  const acc = accounts ?? [];
  const tx = txs ?? [];

  const nw = computeNetWorth(
    acc.map((a) => ({ id: a.id, name: a.name, type: a.type, opening_balance: Number(a.opening_balance), active: a.active })),
    tx.map((t) => ({ ...t, amount: Number(t.amount) })) as never,
    (investments ?? []).map((i) => ({ id: i.id, name: i.name, invested_amount: Number(i.invested_amount), current_value: Number(i.current_value), goal_id: i.goal_id })),
    (debts ?? []).map((d) => ({ id: d.id, name: d.name, outstanding_balance: Number(d.outstanding_balance), original_amount: Number(d.original_amount), status: d.status }))
  );

  const monthly = computeMonthlyIncomeExpense(tx.map((t) => ({ ...t, amount: Number(t.amount) })) as never, undefined as never);

  const hasAccount = acc.length > 0;
  const hasTransaction = tx.length > 0;
  const hasGoal = (goals ?? []).length > 0;
  const isFresh = !hasAccount && !hasTransaction && !hasGoal;

  return (
    <div className="space-y-5">
      <section className="rounded-3xl bg-gradient-brand p-6 text-white shadow-brand md:p-7">
        <p className="text-[11px] font-medium uppercase tracking-wider opacity-80">
          Olá{profile?.display_name ? `, ${profile.display_name}` : ""}
        </p>
        <p className="mt-1 text-xs opacity-90">Seu patrimônio hoje</p>
        <p className="mt-1 font-display text-3xl font-bold tabular-nums md:text-4xl">
          {loading ? "…" : formatBRL(nw.net)}
        </p>
        <p className="mt-2 text-[11px] opacity-80">
          <Info size={11} className="inline" /> Em caixa {formatBRL(nw.cash)} · Investido {formatBRL(nw.invested)} · Dívidas {formatBRL(nw.owed)}
        </p>
      </section>

      <AssistantTipCard />

      <QuickActions />

      <WhatsAppCta />

      <ParaPagarResumo />

      {loading ? (
        <div className="grid place-items-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : isFresh ? (
        <ComecePorAqui hasAccount={hasAccount} hasTransaction={hasTransaction} hasGoal={hasGoal} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Kpi
            label="Entrou este mês"
            value={formatBRL(monthly.income)}
            icon={<ArrowUpRight />}
            accent="text-success"
          />
          <Kpi
            label="Saiu este mês"
            value={formatBRL(monthly.expense)}
            icon={<ArrowDownRight />}
            accent="text-destructive"
          />
        </div>
      )}

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

function Kpi({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className={`flex items-center gap-2 text-[11px] ${accent}`}>
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        <span className="font-medium">{label}</span>
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}
