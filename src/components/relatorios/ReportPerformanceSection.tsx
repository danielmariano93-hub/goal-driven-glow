import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { formatBRL } from "@/lib/engine/facts";
import { cn } from "@/lib/utils";
import { customPeriodOf, previousOf } from "@/lib/reports/intelligent/periods";
import type { ReportDetail } from "@/lib/reports/intelligent/client";

/**
 * O que mudou no período DO RELATÓRIO ABERTO. Os números vêm das métricas já
 * persistidas (`financial_report_metrics`) — nada é recalculado aqui, e nada
 * usa "mês até hoje": o recorte é o do relatório.
 */
export default function ReportPerformanceSection({ report }: { report: ReportDetail }) {
  const expense = report.metrics.find((m) => m.metric_key === "expense_total");
  if (!expense || expense.metric_value == null || expense.comparison_value == null) return null;

  const current = Number(expense.metric_value);
  const previousValue = Number(expense.comparison_value);
  const delta = current - previousValue;

  const previousPeriod = previousOf(
    customPeriodOf({ start: report.period_start, end: report.period_end }),
    report.report_type,
  );

  const series = [
    { label: previousPeriod.label, valor: previousValue, atual: false },
    { label: "Este período", valor: current, atual: true },
  ];

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-base font-bold tracking-tight">O que mudou no período</h2>
        <p className="text-xs text-muted-foreground">
          Comparação com os mesmos dias imediatamente anteriores ({previousPeriod.label}).
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-semibold text-muted-foreground">Gasto no recorte comparado</p>
          <p className={cn("font-display text-lg font-bold tabular-nums", delta > 0 ? "text-rose-600" : "text-emerald-600")}>
            {delta > 0 ? "+" : "−"}{formatBRL(Math.abs(delta))}
          </p>
        </div>
        <div className="mt-2 h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 18, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--muted-foreground))" />
              <YAxis hide />
              <Bar dataKey="valor" radius={[8, 8, 0, 0]} maxBarSize={72}>
                {series.map((row) => (
                  <Cell key={row.label} fill={row.atual ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"} fillOpacity={row.atual ? 1 : 0.35} />
                ))}
                <LabelList
                  dataKey="valor"
                  position="top"
                  fontSize={11}
                  formatter={(v: number) => formatBRL(Number(v ?? 0))}
                  fill="hsl(var(--foreground))"
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
