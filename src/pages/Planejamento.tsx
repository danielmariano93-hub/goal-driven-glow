import { useMemo, useState } from "react";
import { Calculator, Info } from "lucide-react";
import { useAccounts, useAllTransactions, useDebts, useGoals, useContributions } from "@/lib/db/finance";
import { computeBeforeSpending, formatBRL } from "@/lib/engine/facts";

export default function Planejamento() {
  const { data: accounts } = useAccounts();
  const { data: txs } = useAllTransactions();
  const { data: debts } = useDebts();
  const { data: goals } = useGoals();
  const { data: contribs } = useContributions();

  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState<string>("");

  const result = useMemo(() => {
    const amt = Number(amount.replace(",", ".")) || 0;
    if (!amt || amt <= 0) return null;
    return computeBeforeSpending({
      amount: amt,
      accountId: accountId || null,
      accounts: (accounts ?? []).map((a) => ({ id: a.id, name: a.name, type: a.type, opening_balance: Number(a.opening_balance), active: a.active })),
      txs: (txs ?? []).map((t) => ({ ...t, amount: Number(t.amount) })) as never,
      recurring: [],
      debts: (debts ?? []).map((d) => ({
        id: d.id,
        name: d.name,
        outstanding_balance: Number(d.outstanding_balance),
        original_amount: Number(d.original_amount),
        installment_amount: d.installment_amount != null ? Number(d.installment_amount) : null,
        status: d.status,
      })),
      goals: (goals ?? []).map((g) => ({ id: g.id, name: g.name, target_amount: Number(g.target_amount), target_date: g.target_date, status: g.status })),
      contributions: (contribs ?? []).map((c) => ({ goal_id: c.goal_id, amount: Number(c.amount), occurred_at: c.occurred_at })),
    });
  }, [amount, accountId, accounts, txs, debts, goals, contribs]);

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight">Antes de comprar</h1>
        <p className="text-sm text-muted-foreground">Veja como essa compra pode mexer com o seu mês.</p>
      </header>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-card md:p-6">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-medium">Valor da compra (R$)</label>
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" className="input-base" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">Conta usada (opcional)</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input-base">
              <option value="">Não especificar</option>
              {accounts?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {result ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-border bg-background p-4">
              <p className="text-xs text-muted-foreground">Saldo total após a compra e compromissos previstos</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${result.availableAfter < 0 ? "text-destructive" : "text-foreground"}`}>{formatBRL(result.availableAfter)}</p>
            </div>

            <dl className="grid grid-cols-2 gap-2 text-xs">
              <Row label="Saldo total atual" value={formatBRL(result.totalCash)} />
              {result.accountBalance !== null && <Row label="Saldo da conta escolhida" value={formatBRL(result.accountBalance)} />}
              <Row label="Compromissos previstos" value={formatBRL(result.upcomingExpense)} />
              <Row label="Receitas previstas" value={formatBRL(result.upcomingIncome)} />
            </dl>

            {result.goalsAtRisk.length > 0 && (
              <div className="rounded-xl border border-brand-coral/40 bg-brand-coral/10 p-3 text-xs">
                <p className="font-medium">Metas potencialmente afetadas</p>
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {result.goalsAtRisk.map((g) => (
                    <li key={g.id}>
                      {g.name} — restam {formatBRL(g.remaining)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Premissas:</p>
              <ul className="list-disc pl-4">
                {result.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>

            {result.missingData.length > 0 && (
              <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs">
                <p className="mb-1 flex items-center gap-1.5 font-medium">
                  <Info size={12} /> Dados que podem melhorar o cálculo
                </p>
                <ul className="list-disc pl-4 text-muted-foreground">
                  {result.missingData.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="mt-6 rounded-xl border border-dashed border-border bg-background p-6 text-center">
            <Calculator className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-xs text-muted-foreground">Informe um valor para calcular o impacto.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary/60 px-3 py-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}
