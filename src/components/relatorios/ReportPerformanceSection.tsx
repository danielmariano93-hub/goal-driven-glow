import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usePerformanceDetail } from "@/lib/hooks/usePerformanceDetail";
import { formatBRL } from "@/lib/engine/facts";
import { cn } from "@/lib/utils";

/**
 * Seção acionável do relatório: o que mudou, por que mudou (drivers com
 * residual) e o que fazer. Todos os números vêm de `financial_performance.v1`
 * e `financial_comparison.v1` — a UI apenas apresenta.
 */
export default function ReportPerformanceSection() {
  const { data, loading } = usePerformanceDetail();

  if (loading) return <div className="h-40 animate-pulse rounded-2xl bg-muted" aria-hidden />;
  if (!data || data.highlights.length === 0) return null;

  const expense = data.comparisons.find((c) => c.metric === "expense");
  const series = expense
    ? [
        { label: "Período anterior", atual: null as number | null, anterior: expense.previous.value },
        { label: "Período atual", atual: expense.current.value, anterior: null as number | null },
      ]
    : [];

  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-base font-bold tracking-tight">O que mudou e o que fazer</h2>
        <p className="text-xs text-muted-foreground">{data.snapshot.methodology ?? "Comparação equivalente do mês"}</p>
      </div>

      {expense ? (
        <div className="rounded-2xl border border-border bg-card p-3 shadow-card">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-semibold text-muted-foreground">Gasto no recorte comparado</p>
            <p className={cn("font-display text-lg font-bold tabular-nums", expense.delta_abs > 0 ? "text-rose-600" : "text-emerald-600")}>
              {expense.delta_abs > 0 ? "+" : "−"}{formatBRL(Math.abs(expense.delta_abs))}
            </p>
          </div>
          <div className="mt-2 h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="perfNow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--muted-foreground))" />
                <YAxis hide />
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", fontSize: 12 }}
                  formatter={(v) => formatBRL(Number(v ?? 0))}
                />
                <Area type="monotone" dataKey="anterior" name="Período anterior" stroke="hsl(var(--muted-foreground))" strokeOpacity={0.5} fill="hsl(var(--muted))" fillOpacity={0.4} strokeWidth={2} connectNulls />
                <Area type="monotone" dataKey="atual" name="Período atual" stroke="hsl(var(--primary))" fill="url(#perfNow)" strokeWidth={2.5} connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      <ul className="space-y-3">
        {data.highlights.map((h) => (
          <li key={h.id} className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                h.sentiment === "negative" ? "bg-rose-500/10 text-rose-600"
                  : h.sentiment === "positive" ? "bg-emerald-500/10 text-emerald-600"
                  : "bg-primary/10 text-primary",
              )}>
                {h.sentiment === "negative" ? "Atenção" : h.sentiment === "positive" ? "Melhora" : "Leitura"}
              </span>
              {h.structural_or_timing === "timing" ? (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Efeito de calendário
                </span>
              ) : null}
            </div>
            <p className="mt-1.5 text-sm font-semibold leading-snug">{h.title_fact}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{h.interpretation}</p>

            {h.drivers.length > 0 ? (
              <dl className="mt-2 space-y-1 rounded-xl bg-muted/40 p-2.5 text-[11px]">
                {h.drivers.map((d) => (
                  <div key={d.label} className="flex items-center justify-between gap-2">
                    <dt className="truncate text-muted-foreground">{d.label}</dt>
                    <dd className={cn("tabular-nums font-semibold", d.delta_abs > 0 ? "text-rose-600" : "text-emerald-600")}>
                      {d.delta_abs > 0 ? "+" : "−"}{formatBRL(Math.abs(d.delta_abs))}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <p className="mt-2 text-[11px] text-muted-foreground">
              Variação observada {formatBRL(h.evidence.observed_change)} · calendário {formatBRL(h.evidence.timing_effect)} ·
              hábito {formatBRL(h.evidence.behavioral_change)} · limpa de calendário {formatBRL(h.evidence.normalized_change)}
              {h.evidence.reconciles ? "" : " · decomposição parcial"}
            </p>
            {h.recommended_action ? (
              <p className="mt-2 text-xs font-semibold text-primary">{h.recommended_action}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
