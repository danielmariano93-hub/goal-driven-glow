// Renderer universal para ChartArtifact vindo do assessor.
// Suporta bar, line/area, donut, progress e forecast_band. Sem cálculo — só
// consome o payload já pronto do motor analítico.
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  LineChart, Line, Area, ComposedChart, PieChart, Pie, Cell,
} from "recharts";
import type { ChartArtifact } from "@/types/artifacts";

const BRL = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
const PALETTE = ["#6D3BFF", "#8B5CF6", "#FF6B4A", "#FF9F1C", "#16A37A", "#3B82F6"];

function fmt(units: ChartArtifact["chart"]["units"], v: number) {
  if (!Number.isFinite(v)) return "—";
  if (units === "pct") return `${Math.round(v * 100)}%`;
  if (units === "count") return String(v);
  return BRL(v);
}

function ConfidencePill({ level }: { level: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    high: { label: "confiança alta", cls: "bg-emerald-100 text-emerald-900 border-emerald-200" },
    medium: { label: "confiança média", cls: "bg-amber-100 text-amber-900 border-amber-200" },
    low: { label: "confiança baixa", cls: "bg-rose-100 text-rose-900 border-rose-200" },
    insufficient_data: { label: "amostra pequena", cls: "bg-slate-100 text-slate-800 border-slate-200" },
  };
  const it = map[level] ?? map.medium;
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${it.cls}`}>{it.label}</span>;
}

export function ChartArtifactRenderer({ artifact }: { artifact: ChartArtifact }) {
  const { chart, metrics, provenance, headline, narrative } = artifact;
  const rows = chart.x_labels.map((label, i) => {
    const row: Record<string, string | number> = { label };
    for (const s of chart.series) row[s.name] = s.data[i];
    return row;
  });

  const trendAnn = chart.annotations?.find((a) => /trend|tend/i.test(a.x) || /↓|↑|→/.test(a.label));
  const trendCls = trendAnn && /↓|falling|reduzindo/i.test(trendAnn.label)
    ? "bg-emerald-100 text-emerald-900 border-emerald-200"
    : trendAnn && /↑|rising|subindo/i.test(trendAnn.label)
    ? "bg-rose-100 text-rose-900 border-rose-200"
    : "bg-slate-100 text-slate-800 border-slate-200";

  return (
    <div className="w-full max-w-full rounded-2xl border border-border bg-background p-3 shadow-sm">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{headline}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{narrative}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <ConfidencePill level={provenance.confidence} />
          {trendAnn && (
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${trendCls}`}>
              {trendAnn.label}
            </span>
          )}
        </div>
      </div>

      {metrics.length > 0 && (
        <div className="mb-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {metrics.slice(0, 6).map((m) => (
            <div key={m.label} className="rounded-lg bg-secondary/60 px-2 py-1.5">
              <p className="text-[10px] text-muted-foreground">{m.label}</p>
              <p className="text-xs font-semibold tabular-nums">{m.value}</p>
            </div>
          ))}
        </div>
      )}

      <div className="h-48 w-full">
        <ResponsiveContainer>
          {chart.type === "bar" || chart.type === "stacked_bar" ? (
            <BarChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
              <XAxis dataKey="label" fontSize={10} interval={0} angle={-15} height={40} />
              <YAxis fontSize={10} tickFormatter={(v) => fmt(chart.units, v)} width={60} />
              <Tooltip formatter={(v: number) => fmt(chart.units, v)} />
              {chart.series.map((s, i) => (
                <Bar key={s.name} dataKey={s.name} fill={s.color ?? PALETTE[i % PALETTE.length]}
                  stackId={chart.type === "stacked_bar" ? "s" : undefined} />
              ))}
            </BarChart>
          ) : chart.type === "line" || chart.type === "area" ? (
            <LineChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
              <XAxis dataKey="label" fontSize={10} />
              <YAxis fontSize={10} tickFormatter={(v) => fmt(chart.units, v)} width={60} />
              <Tooltip formatter={(v: number) => fmt(chart.units, v)} />
              {chart.series.map((s, i) => (
                <Line key={s.name} dataKey={s.name} stroke={s.color ?? PALETTE[i % PALETTE.length]}
                  type="monotone"
                  dot={false} strokeWidth={i === 0 ? 2.5 : 1.5}
                  strokeDasharray={i === 0 ? undefined : "4 3"} />
              ))}
            </LineChart>
          ) : chart.type === "forecast_band" ? (
            <ComposedChart data={rows}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.25} />
              <XAxis dataKey="label" fontSize={10} />
              <YAxis fontSize={10} tickFormatter={(v) => fmt(chart.units, v)} width={60} />
              <Tooltip formatter={(v: number) => fmt(chart.units, v)} />
              <Area type="monotone" dataKey="Projeção" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.15} />
              <Line type="monotone" dataKey="Observado" stroke="#6D3BFF" strokeWidth={2} dot={false} />
            </ComposedChart>
          ) : chart.type === "donut" ? (
            <PieChart>
              <Pie data={rows} dataKey={chart.series[0]?.name} nameKey="label" innerRadius="55%" outerRadius="85%">
                {rows.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => fmt(chart.units, v)} />
            </PieChart>
          ) : chart.type === "progress" ? (
            <div className="grid h-full place-items-center">
              <div className="w-full max-w-xs">
                <div className="mb-1 flex justify-between text-xs">
                  <span>Progresso</span>
                  <span className="font-semibold tabular-nums">{fmt("pct", chart.series[0]?.data[0] ?? 0)}</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.min(100, (chart.series[0]?.data[0] ?? 0) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="grid h-full place-items-center text-xs text-muted-foreground">
              Tipo de gráfico não suportado ({chart.type}).
            </div>
          )}
        </ResponsiveContainer>
      </div>

      <p className="mt-2 text-[10px] text-muted-foreground">
        {provenance.period.from} → {provenance.period.to} · {provenance.row_count} registros · {provenance.formula_version}
      </p>
    </div>
  );
}
