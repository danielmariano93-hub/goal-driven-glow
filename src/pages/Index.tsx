import { Link } from "react-router-dom";
import { Loader2, PlusCircle, ArrowUpRight, ArrowDownRight, PiggyBank, Target, TrendingUp, AlertOctagon, Info } from "lucide-react";
import { useAccounts, useAllTransactions, useGoals, useInvestments, useDebts, useContributions, useCategories } from "@/lib/db/finance";
import {
  computeNetWorth,
  computeMonthlyIncomeExpense,
  computeCategoryBreakdown,
  computeGoalProgress,
  currentMonthYM,
  formatBRL,
} from "@/lib/engine/facts";
import { useAuth } from "@/context/AuthContext";

export default function Index() {
  const { profile } = useAuth();
  const { data: accounts, isLoading: la } = useAccounts();
  const { data: txs, isLoading: lt } = useAllTransactions();
  const { data: goals } = useGoals();
  const { data: contribs } = useContributions();
  const { data: investments } = useInvestments();
  const { data: debts } = useDebts();
  const { data: categories } = useCategories();

  const loading = la || lt;
  const ym = currentMonthYM();
  const acc = accounts ?? [];
  const tx = txs ?? [];

  const nw = computeNetWorth(
    acc.map((a) => ({ id: a.id, name: a.name, type: a.type, opening_balance: Number(a.opening_balance), active: a.active })),
    tx.map((t) => ({ ...t, amount: Number(t.amount) })) as never,
    (investments ?? []).map((i) => ({ id: i.id, name: i.name, invested_amount: Number(i.invested_amount), current_value: Number(i.current_value), goal_id: i.goal_id })),
    (debts ?? []).map((d) => ({ id: d.id, name: d.name, outstanding_balance: Number(d.outstanding_balance), original_amount: Number(d.original_amount), status: d.status }))
  );

  const monthly = computeMonthlyIncomeExpense(tx.map((t) => ({ ...t, amount: Number(t.amount) })) as never, ym);
  const catBreakdown = computeCategoryBreakdown(
    tx.map((t) => ({ ...t, amount: Number(t.amount) })) as never,
    (categories ?? []).map((c) => ({ id: c.id, name: c.name, type: c.type })),
    ym,
    "expense"
  );

  return (
    <div>
      <div className="mb-6 rounded-3xl bg-gradient-brand p-6 text-white shadow-brand md:p-8">
        <p className="text-xs font-medium uppercase tracking-wider opacity-80">Olá{profile?.display_name ? `, ${profile.display_name}` : ""}</p>
        <p className="mt-1 font-display text-2xl font-bold md:text-3xl">Patrimônio líquido</p>
        <p className="mt-2 text-3xl font-bold tabular-nums md:text-4xl">{loading ? "…" : formatBRL(nw.net)}</p>
        <p className="mt-2 text-xs opacity-80">
          <Info size={11} className="inline" /> Caixa {formatBRL(nw.cash)} + Investimentos {formatBRL(nw.invested)} − Dívidas ativas {formatBRL(nw.owed)}
        </p>
      </div>

      {loading ? (
        <div className="grid place-items-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3">
            <Kpi label="Receitas do mês" value={formatBRL(monthly.income)} icon={<ArrowUpRight />} accent="text-success" />
            <Kpi label="Despesas do mês" value={formatBRL(monthly.expense)} icon={<ArrowDownRight />} accent="text-destructive" />
          </div>

          <QuickActions />

          <section className="mt-6">
            <h2 className="mb-3 text-sm font-semibold">Despesas por categoria — este mês</h2>
            {catBreakdown.length === 0 ? (
              <EmptyBlock text="Ainda não há despesas registradas este mês." />
            ) : (
              <ul className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-card">
                {catBreakdown.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="truncate">{c.name}</span>
                      <span className="font-medium tabular-nums">{formatBRL(c.amount)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(c.share * 100)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-6 grid gap-3 md:grid-cols-2">
            <Card icon={<Target />} title="Metas ativas" href="/app/metas">
              {(goals ?? []).filter((g) => g.status === "active").length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhuma meta ativa. Crie uma para acompanhar o progresso.</p>
              ) : (
                <ul className="space-y-2">
                  {(goals ?? [])
                    .filter((g) => g.status === "active")
                    .slice(0, 3)
                    .map((g) => {
                      const p = computeGoalProgress(g, contribs ?? []);
                      return (
                        <li key={g.id}>
                          <div className="flex items-center justify-between text-sm">
                            <span className="truncate">{g.name}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">{Math.round(p.pct * 100)}%</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                            <div className="h-full rounded-full bg-gradient-brand" style={{ width: `${Math.round(p.pct * 100)}%` }} />
                          </div>
                        </li>
                      );
                    })}
                </ul>
              )}
            </Card>

            <Card icon={<TrendingUp />} title="Investimentos" href="/app/investimentos">
              {(investments ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">Ainda não há dados suficientes.</p>
              ) : (
                <p className="text-lg font-semibold tabular-nums">{formatBRL(nw.invested)}</p>
              )}
            </Card>

            <Card icon={<AlertOctagon />} title="Dívidas ativas" href="/app/dividas">
              {nw.owed === 0 ? (
                <p className="text-xs text-muted-foreground">Sem dívidas ativas.</p>
              ) : (
                <p className="text-lg font-semibold tabular-nums text-destructive">{formatBRL(nw.owed)}</p>
              )}
            </Card>

            <Card icon={<PiggyBank />} title="Contas" href="/app/contas">
              <p className="text-lg font-semibold tabular-nums">{formatBRL(nw.cash)}</p>
              <p className="text-xs text-muted-foreground">Saldo consolidado de {acc.filter((a) => a.active).length} conta(s)</p>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, icon, accent }: { label: string; value: string; icon: React.ReactNode; accent: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className={`flex items-center gap-2 text-xs ${accent}`}>
        <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        <span className="font-medium">{label}</span>
      </div>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function EmptyBlock({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-xs text-muted-foreground">{text}</div>;
}

function Card({ icon, title, href, children }: { icon: React.ReactNode; title: string; href: string; children: React.ReactNode }) {
  return (
    <Link to={href} className="block rounded-2xl border border-border bg-card p-4 shadow-card transition-colors hover:border-primary/40">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-secondary text-primary [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        {title}
      </div>
      {children}
    </Link>
  );
}

function QuickActions() {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Link to="/app/lancamentos" className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-card p-3 text-xs font-medium hover:border-primary/40">
        <PlusCircle className="h-5 w-5 text-primary" /> Novo lançamento
      </Link>
      <Link to="/app/metas" className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-card p-3 text-xs font-medium hover:border-primary/40">
        <Target className="h-5 w-5 text-primary" /> Aportar em meta
      </Link>
      <Link to="/app/planejamento" className="flex flex-col items-center gap-1 rounded-2xl border border-border bg-card p-3 text-xs font-medium hover:border-primary/40">
        <Info className="h-5 w-5 text-primary" /> Antes de gastar
      </Link>
    </div>
  );
}
