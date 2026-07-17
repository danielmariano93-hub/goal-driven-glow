import { Link } from "react-router-dom";
import { Loader2, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useAccounts, useAllTransactions, useGoals, useInvestments, useDebts } from "@/lib/db/finance";
import { computeNetWorth, computeMonthlyIncomeExpense, currentMonthYM, formatBRL } from "@/lib/engine/facts";
import { AssistantTipCard } from "@/components/home/AssistantTipCard";
import { QuickActions } from "@/components/home/QuickActions";
import { WhatsAppCta } from "@/components/home/WhatsAppCta";
import { ParaPagarResumo } from "@/components/home/ParaPagarResumo";
import { ComecePorAqui } from "@/components/home/ComecePorAqui";
import { PulseHero } from "@/components/home/PulseHero";
import { PatrimonioCard } from "@/components/home/PatrimonioCard";
import { EmotionalCheckinCard } from "@/components/home/EmotionalCheckinCard";
import { ResumoContas } from "@/components/home/ResumoContas";

export default function Index() {
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

  const monthlyAccount = computeMonthlyIncomeExpense(tx.map((t) => ({ ...t, amount: Number(t.amount) })) as never, currentMonthYM(), { origin: "account" });
  const monthlyCard = computeMonthlyIncomeExpense(tx.map((t) => ({ ...t, amount: Number(t.amount) })) as never, currentMonthYM(), { origin: "credit_card" });

  const hasAccount = acc.length > 0;
  const hasTransaction = tx.length > 0;
  const hasGoal = (goals ?? []).length > 0;
  const isFresh = !hasAccount && !hasTransaction && !hasGoal;

  return (
    <div className="space-y-5">
      <PulseHero />

      <PatrimonioCard cash={nw.cash} cardsOwed={nw.cardsOwed} invested={nw.invested} otherDebts={nw.otherDebts} net={nw.net} loading={loading} />

      <AssistantTipCard />

      <ResumoContas cash={nw.cash} cardsOwed={nw.cardsOwed} invested={nw.invested} otherDebts={nw.otherDebts} />

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
            value={formatBRL(monthlyAccount.income)}
            icon={<ArrowUpRight />}
            accent="text-success"
          />
          <Kpi
            label="Saiu da conta este mês"
            value={formatBRL(monthlyAccount.expense)}
            icon={<ArrowDownRight />}
            accent="text-destructive"
            sub={monthlyCard.expense > 0 ? `+ ${formatBRL(monthlyCard.expense)} foi para a fatura do cartão` : undefined}
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

