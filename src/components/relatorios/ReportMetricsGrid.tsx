import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatBRL } from "@/lib/split/math";
import { cn } from "@/lib/utils";
import type { ReportMetricRow } from "@/lib/reports/intelligent/client";

const PRIMARY_KEYS = ["income_total", "expense_total", "net_result", "savings_rate"];

function formatValue(m: ReportMetricRow): string {
  if (m.metric_value === null || m.metric_value === undefined) return m.metric_text ?? "—";
  switch (m.unit) {
    case "BRL": return formatBRL(Number(m.metric_value));
    case "pct": return `${Number(m.metric_value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
    case "days": return `${Number(m.metric_value)} dia${Number(m.metric_value) === 1 ? "" : "s"}`;
    case "count": return String(Number(m.metric_value));
    case "score": return Number(m.metric_value).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
    default: return m.metric_text ?? String(m.metric_value);
  }
}

function Delta({ pct }: { pct: number | null }) {
  if (pct === null || pct === undefined) return null;
  const up = pct > 0;
  const flat = Math.abs(pct) < 0.05;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-medium",
      flat ? "text-muted-foreground" : up ? "text-rose-600" : "text-emerald-600")}>
      <Icon size={12} />
      {Math.abs(pct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
    </span>
  );
}

export default function ReportMetricsGrid({ metrics }: { metrics: ReportMetricRow[] }) {
  const primary = PRIMARY_KEYS
    .map((k) => metrics.find((m) => m.metric_key === k))
    .filter((m): m is ReportMetricRow => !!m);
  const secondary = metrics.filter((m) => !PRIMARY_KEYS.includes(m.metric_key));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {primary.map((m) => (
          <div key={m.metric_key} className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{m.metric_label}</p>
            <p className="mt-1 font-display text-lg font-bold tabular-nums">{formatValue(m)}</p>
            <Delta pct={m.comparison_percentage} />
          </div>
        ))}
      </div>
      {secondary.length > 0 && (
        <div className="rounded-2xl border border-border bg-card shadow-card divide-y divide-border">
          {secondary.map((m) => (
            <div key={m.metric_key} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <span className="text-xs text-muted-foreground">
                {m.metric_label}
                {m.metric_text && m.unit === "BRL" && m.metric_key !== "biggest_expense" ? ` · ${m.metric_text}` : ""}
              </span>
              <span className="text-sm font-semibold tabular-nums">{formatValue(m)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
