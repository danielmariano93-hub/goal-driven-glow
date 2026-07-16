import { useEffect, useState } from "react";
import { Download, Loader2, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { groupByMonth, byCategory, filterPeriod, toCsv, type ReportTxn } from "@/lib/reports/aggregations";
import { formatBRL } from "@/lib/split/math";

export default function Relatorios() {
  const [txns, setTxns] = useState<ReportTxn[] | null>(null);
  const today = new Date();
  const [from, setFrom] = useState(new Date(today.getFullYear(), today.getMonth() - 5, 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("transactions")
        .select("type,amount,occurred_at,category_id,categories(name)")
        .order("occurred_at", { ascending: false });
      setTxns((data ?? []).map((t: any) => ({
        type: t.type, amount: Number(t.amount), occurred_at: t.occurred_at,
        category_id: t.category_id, category_name: t.categories?.name ?? null,
      })));
    })();
  }, []);

  if (txns === null) return <div className="grid place-items-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>;

  const filtered = filterPeriod(txns, from, to);
  const monthly = groupByMonth(filtered);
  const byCat = byCategory(filtered);
  const totalIncome = monthly.reduce((s, m) => s + m.income, 0);
  const totalExpense = monthly.reduce((s, m) => s + m.expense, 0);
  const maxCat = Math.max(1, ...byCat.map(c => c.total));

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

      <div className="surface-card p-3 flex gap-2 print:hidden">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="surface-card p-3"><p className="text-[10px] text-muted-foreground">Receitas</p><p className="text-sm font-bold text-success">{formatBRL(totalIncome)}</p></div>
        <div className="surface-card p-3"><p className="text-[10px] text-muted-foreground">Despesas</p><p className="text-sm font-bold text-destructive">{formatBRL(totalExpense)}</p></div>
        <div className="surface-card p-3"><p className="text-[10px] text-muted-foreground">Saldo</p><p className={`text-sm font-bold ${totalIncome-totalExpense>=0?"text-success":"text-destructive"}`}>{formatBRL(totalIncome - totalExpense)}</p></div>
      </div>

      <section>
        <h2 className="text-sm font-semibold mb-2">Mensal</h2>
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
        <div className="surface-card p-4 space-y-2">
          {byCat.map(c => (
            <div key={c.category}>
              <div className="flex justify-between text-xs">
                <span>{c.category}</span>
                <span className="font-medium">{formatBRL(c.total)} · {c.count}x</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                <div className="h-full bg-primary" style={{ width: `${(c.total/maxCat)*100}%` }} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">Valores factuais. Não incluímos projeções ou score inventado.</p>
      </section>
    </div>
  );
}
