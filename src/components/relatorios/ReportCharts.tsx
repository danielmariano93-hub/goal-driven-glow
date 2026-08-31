import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatBRL } from "@/lib/split/math";
import type { ReportPayload } from "@/lib/reports/intelligent/types";

const COLORS = ["hsl(var(--primary))", "#4338FF", "#FF6B5F", "#2FC99A", "#F5A524", "#8A8FA3"];

export default function ReportCharts({ payload }: { payload: ReportPayload }) {
  const series = (payload.series ?? []).map((p) => ({ label: p.label, Gasto: p.expense, Acumulado: p.cumulativeExpense }));
  const categories = (payload.categories ?? []).slice(0, 6).map((c) => ({
    name: c.category.length > 14 ? `${c.category.slice(0, 13)}…` : c.category,
    total: c.total,
  }));

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
        <h3 className="text-sm font-semibold">Gastos no período</h3>
        <p className="text-[11px] text-muted-foreground">Gasto do dia e acumulado dentro do período fechado</p>
        <div className="mt-3 h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="reportExpense" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
              <Tooltip formatter={(v: number) => formatBRL(Number(v))} labelClassName="text-xs" />
              <Area type="monotone" dataKey="Acumulado" stroke="hsl(var(--primary))" fill="url(#reportExpense)" strokeWidth={2} />
              <Area type="monotone" dataKey="Gasto" stroke="#FF6B5F" fill="transparent" strokeWidth={1.5} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {categories.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <h3 className="text-sm font-semibold">Para onde o dinheiro foi</h3>
          <p className="text-[11px] text-muted-foreground">Maiores categorias de despesa do período</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Compras de cartão entram pelo mês da fatura; o restante, pela data do lançamento.
          </p>

          <div className="mt-3 h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categories} layout="vertical" margin={{ top: 0, right: 12, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => formatBRL(Number(v))} />
                <Bar dataKey="total" radius={[0, 6, 6, 0]}>
                  {categories.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <ul className="mt-2 space-y-1">
            {(payload.categories ?? []).slice(0, 6).map((c, i) => (
              <li key={c.category} className="flex items-center justify-between text-[11px]">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="h-2 w-2 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                  {c.category}
                </span>
                <span className="tabular-nums">
                  {formatBRL(c.total)} · {Math.round(c.share * 100)}%
                  {c.deltaPct !== null && (
                    <span className={c.deltaPct > 0 ? "ml-1 text-rose-600" : "ml-1 text-emerald-600"}>
                      {c.deltaPct > 0 ? "+" : ""}{c.deltaPct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
