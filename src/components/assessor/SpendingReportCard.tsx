import { BarChart3, Download } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type SpendingReport = {
  kind: "spending_report";
  period: { from: string; to: string; days: number };
  totals: { expense: number; income: number; net: number };
  transactions_count: number;
  categories: Array<{ name: string; value: number }>;
  daily: Array<{ date: string; value: number }>;
  top_category: { name: string; value: number } | null;
  uncategorized: number;
  data_limit: "no_data" | "small_sample" | null;
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
}[char] ?? char));

export function SpendingReportCard({ report }: { report: SpendingReport }) {
  const chart = report.categories.slice(0, 6);

  function printReport() {
    const rows = report.categories.map((item) => `<tr><td>${esc(item.name)}</td><td>${esc(money.format(item.value))}</td></tr>`).join("");
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) return;
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório financeiro</title><style>body{font:15px system-ui;color:#181326;max-width:760px;margin:48px auto;padding:0 24px}h1{font-size:28px}small{color:#706979}.hero{padding:24px;border-radius:20px;background:linear-gradient(135deg,#4c1d95,#7c3aed,#f97373);color:white;margin:24px 0}.value{font-size:36px;font-weight:800}table{width:100%;border-collapse:collapse}td{padding:12px;border-bottom:1px solid #e8e5ee}td:last-child{text-align:right;font-weight:700}@media print{button{display:none}}</style></head><body><h1>Relatório financeiro</h1><small>${esc(date(report.period.from))} a ${esc(date(report.period.to))} · ${esc(report.transactions_count)} lançamentos</small><div class="hero"><div>Total gasto</div><div class="value">${esc(money.format(report.totals.expense))}</div></div><h2>Gastos por categoria</h2><table>${rows}</table><p><strong>Destaque:</strong> ${esc(report.top_category ? `${report.top_category.name} — ${money.format(report.top_category.value)}` : "Sem despesas no período")}</p><button onclick="window.print()">Imprimir ou salvar como PDF</button></body></html>`);
    popup.document.close();
  }

  return (
    <section className="w-full max-w-[min(92vw,360px)] overflow-hidden rounded-2xl border border-primary/20 bg-background p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary"><BarChart3 size={14} /> Relatório</p>
          <p className="mt-1 text-2xl font-bold">{money.format(report.totals.expense)}</p>
          <p className="text-[11px] text-muted-foreground">{date(report.period.from)} a {date(report.period.to)} · {report.transactions_count} lançamentos</p>
        </div>
        <button type="button" onClick={printReport} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border" aria-label="Baixar relatório em PDF" title="Imprimir ou salvar em PDF"><Download size={15} /></button>
      </div>
      {chart.length > 0 ? (
        <div className="mt-3 h-44 w-full" aria-label="Gráfico de gastos por categoria">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} layout="vertical" margin={{ left: 0, right: 8, top: 2, bottom: 2 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} opacity={0.25} />
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={86} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value: number) => money.format(value)} cursor={{ fill: "hsl(var(--secondary))" }} />
              <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : <p className="mt-3 rounded-xl bg-secondary p-3 text-xs text-muted-foreground">Ainda não há despesas nesse período.</p>}
      {report.uncategorized > 0 && <p className="mt-2 text-xs text-amber-700">Há {money.format(report.uncategorized)} sem categoria. Categorizar melhora a análise.</p>}
      {report.data_limit === "small_sample" && <p className="mt-2 text-[11px] text-muted-foreground">Esta é uma leitura inicial com poucos lançamentos; ela ficará mais precisa com o uso.</p>}
    </section>
  );
}
