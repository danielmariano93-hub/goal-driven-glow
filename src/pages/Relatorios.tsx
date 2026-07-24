import { useEffect, useState } from "react";
import { Download, Lightbulb, Loader2, Printer, TrendingDown } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import {
  groupByMonth,
  byCategory,
  filterCanonicalReportTransactions,
  filterPeriod,
  spendingHighlights,
  toCsv,
  type ReportTxn,
} from "@/lib/reports/aggregations";
import { formatBRL } from "@/lib/split/math";
import { resolvePeriodRange } from "@/lib/ui/periodStore";

export default function Relatorios() {
  const [txns, setTxns] = useState<ReportTxn[] | null>(null);
  const initialRange = resolvePeriodRange();
  const [from, setFrom] = useState(initialRange.start);
  const [to, setTo] = useState(initialRange.end);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("transactions")
        .select("id,account_id,type,status,amount,occurred_at,category_id,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,categories(name)")
        .order("occurred_at", { ascending: false });
      setTxns((data ?? []).map((t: any) => ({
        id: t.id, account_id: t.account_id, type: t.type, status: t.status,
        amount: Number(t.amount), occurred_at: t.occurred_at,
        category_id: t.category_id, category_name: t.categories?.name ?? null,
        transfer_group_id: t.transfer_group_id, payment_method: t.payment_method,
        credit_card_id: t.credit_card_id, settles_card_id: t.settles_card_id,
        movement_kind: t.movement_kind,
      })));
    })();
  }, []);

  if (txns === null) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>;

  const filtered = filterCanonicalReportTransactions(filterPeriod(txns, from, to));
  const monthly = groupByMonth(filtered);
  const byCat = byCategory(filtered);
  const totalIncome = monthly.reduce((s, m) => s + m.income, 0);
  const totalExpense = monthly.reduce((s, m) => s + m.expense, 0);
  const maxCat = Math.max(1, ...byCat.map(c => c.total));
  const highlights = spendingHighlights(byCat, totalExpense);

  const download = () => {
    const csv = toCsv(filtered.map(t => ({
      data: t.occurred_at, tipo: t.type, valor: t.amount, categoria: t.category_name ?? "",
    })));
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `relatorio_${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (filtered.length === 0) {
    return (
      <div className="space-y-5 pt-2">
        <h1 className="font-display text-2xl font-bold tracking-tight">Relatórios</h1>
        <div className="surface-card p-8 text-center">
          <p className="text-sm font-medium">Ainda não há dados no período</p>
          <p className="text-xs text-muted-foreground mt-1">Registre lançamentos para ver seus relatórios factuais.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pt-2 print:pt-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Relatórios</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Análises baseadas apenas nos seus dados</p>
        </div>
        <div className="flex gap-2 print:hidden">
          <button onClick={download} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs"><Download size={12} /> CSV</button>
          <button onClick={() => window.print()} className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs"><Printer size={12} /> Imprimir</button>
        </div>
      </div>

      <div className="surface-card grid min-w-0 grid-cols-1 gap-2 p-3 min-[380px]:grid-cols-2 print:hidden">
        <label className="min-w-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          De
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1 h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-base normal-case tracking-normal text-foreground" />
        </label>
        <label className="min-w-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Até
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1 h-11 w-full min-w-0 rounded-xl border border-border bg-background px-3 text-base normal-case tracking-normal text-foreground" />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="surface-card p-3"><p className="text-[10px] text-muted-foreground">Receitas</p><p className="text-sm font-bold text-success">{formatBRL(totalIncome)}</p></div>
        <div className="surface-card p-3"><p className="text-[10px] text-muted-foreground">Despesas</p><p className="text-sm font-bold text-destructive">{formatBRL(totalExpense)}</p></div>
        <div className="surface-card p-3"><p className="text-[10px] text-muted-foreground">Saldo</p><p className={`text-sm font-bold ${totalIncome-totalExpense>=0?"text-success":"text-destructive"}`}>{formatBRL(totalIncome - totalExpense)}</p></div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Evolução mensal</h2>
        <div className="surface-card mb-3 h-64 p-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthly} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="ym" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
              <Tooltip
                formatter={(value: number) => formatBRL(Number(value))}
                contentStyle={{
                  borderRadius: 14,
                  border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--background))",
                  fontSize: 12,
                }}
              />
              <Line type="monotone" dataKey="income" name="Receitas" stroke="hsl(var(--success))" strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="expense" name="Consumo real" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="surface-card overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-secondary/40">
              <tr><th className="px-3 py-2 text-left">Mês</th><th className="px-3 py-2 text-right">Receitas</th><th className="px-3 py-2 text-right">Despesas</th><th className="px-3 py-2 text-right">Saldo</th></tr>
            </thead>
            <tbody>
              {monthly.map(m => (
                <tr key={m.ym} className="border-t border-border">
                  <td className="px-3 py-2">{m.ym}</td>
                  <td className="px-3 py-2 text-right text-success">{formatBRL(m.income)}</td>
                  <td className="px-3 py-2 text-right text-destructive">{formatBRL(m.expense)}</td>
                  <td className={`px-3 py-2 text-right font-medium ${m.net>=0?"text-success":"text-destructive"}`}>{formatBRL(m.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">Por categoria (despesas)</h2>
        <div className="surface-card p-4 space-y-3">
          {byCat.map(c => (
            <div key={c.category}>
              <div className="flex min-w-0 items-start justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <span className="block truncate font-medium">{c.category}</span>
                  <span className="text-[10px] text-muted-foreground">{c.percentOfExpenses.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% das despesas</span>
                </div>
                <span className="shrink-0 text-right font-medium">{formatBRL(c.total)} · {c.count}x</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${(c.total/maxCat)*100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">Consumo real: exclui transferências, investimentos, empréstimos e pagamento de fatura; estornos reduzem o total.</p>
      </section>

      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Lightbulb size={15} className="text-primary" /> Principais leituras do período</h2>
        <div className="space-y-2">
          {highlights.map((h) => (
            <article key={h.id} className="surface-card p-4">
              <div className="flex min-w-0 gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <TrendingDown size={15} />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold leading-snug">{h.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{h.body}</p>
                  {h.impact ? <p className="mt-2 text-[11px] font-medium text-foreground">{h.impact}</p> : null}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
