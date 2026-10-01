import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Minus } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import type { DashCategoryRow, ReportDashboard, SeriesPoint } from "@/lib/engine/reportDashboard";

// Gráficos do painel. Barras finas, base ancorada, status com texto, e toda
// leitura tem a tabela equivalente (acessibilidade).

const pct = (ratio: number) => `${Math.round(Math.abs(ratio) * 100)}%`;
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : String(Math.round(n)));

/** Entrou x saiu ao longo do período, com a linha do período anterior. */
export function EvolutionChart({ d }: { d: ReportDashboard }) {
  const [active, setActive] = useState<SeriesPoint | null>(null);
  const series = d.series;
  const showIncome = !d.filtered && d.granularity !== "day";
  const W = 340;
  const H = 180;
  const pad = { top: 14, bottom: 22, left: 6, right: 6 };
  const max = Math.max(1, ...series.map((p) => Math.max(p.expense, showIncome ? p.income : 0, p.previousExpense ?? 0))) * 1.1;
  const band = (W - pad.left - pad.right) / Math.max(1, series.length);
  const barW = Math.max(3, Math.min(26, band - (showIncome ? 6 : 3)) / (showIncome ? 2 : 1));
  const y = (v: number) => pad.top + (H - pad.top - pad.bottom) * (1 - v / max);
  const base = y(0);
  const step = Math.ceil(series.length / 8);
  const prevPath = series
    .map((p, i) => (p.previousExpense == null ? null : `${i === 0 ? "M" : "L"}${(pad.left + band * i + band / 2).toFixed(1)},${y(p.previousExpense).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  const bar = (x: number, v: number, cls: string) => {
    const h = Math.max(0, base - y(v));
    return h > 0 ? <path d={`M${x},${base} V${base - h + 3} q0,-3 3,-3 H${x + barW - 3} q3,0 3,3 V${base} Z`} className={cls} /> : null;
  };

  return (
    <section aria-label="Evolução" className="rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <p className="text-sm font-semibold">Evolução {showIncome ? "· entrou x saiu" : "· quanto saiu"}</p>
      <div className="mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Evolução do período">
          <line x1={pad.left} x2={W - pad.right} y1={base} y2={base} className="stroke-border" strokeWidth={1} />
          {series.map((p, i) => {
            const cx = pad.left + band * i + band / 2;
            const x0 = showIncome ? cx - barW - 1 : cx - barW / 2;
            return (
              <g key={p.key} onMouseEnter={() => setActive(p)} onClick={() => setActive(active?.key === p.key ? null : p)} className="cursor-pointer">
                <rect x={cx - band / 2} y={pad.top} width={band} height={H - pad.top - pad.bottom} fill="transparent" />
                {showIncome ? bar(x0, p.income, "fill-emerald-500") : null}
                {bar(showIncome ? cx + 1 : x0, p.expense, active?.key === p.key ? "fill-primary" : "fill-primary/80")}
                {i % step === 0 ? <text x={cx} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[9px]">{p.label}</text> : null}
              </g>
            );
          })}
          {prevPath ? <path d={prevPath} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="4 3" strokeLinejoin="round" /> : null}
          <text x={pad.left} y={10} className="fill-muted-foreground text-[9px]">{compact(max / 1.1)}</text>
        </svg>
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {showIncome ? <li className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Entrou</li> : null}
          <li className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-primary" /> Saiu</li>
          {d.previous ? <li className="inline-flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-muted-foreground" /> Saiu no período anterior</li> : null}
        </ul>
        {active ? (
          <p className="mt-2 rounded-lg bg-secondary/60 px-2.5 py-1.5 text-[12px]" aria-live="polite">
            <strong>{active.label}:</strong> saiu {formatBRL(active.expense)}
            {showIncome ? ` · entrou ${formatBRL(active.income)} · ${active.net >= 0 ? "sobrou" : "faltou"} ${formatBRL(Math.abs(active.net))}` : ""}
            {active.previousExpense != null ? ` · antes ${formatBRL(active.previousExpense)}` : ""}
          </p>
        ) : null}
      </div>
      <details className="mt-2 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer">Ver em tabela</summary>
        <div className="mt-1 max-h-56 overflow-auto">
          <table className="w-full text-[11px]">
            <thead><tr className="text-left"><th>Período</th><th className="text-right">Saiu</th>{showIncome ? <th className="text-right">Entrou</th> : null}<th className="text-right">Antes</th></tr></thead>
            <tbody>
              {series.map((p) => (
                <tr key={p.key}><td>{p.label}</td><td className="text-right tabular-nums">{formatBRL(p.expense)}</td>{showIncome ? <td className="text-right tabular-nums">{formatBRL(p.income)}</td> : null}<td className="text-right tabular-nums">{p.previousExpense == null ? "—" : formatBRL(p.previousExpense)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  return (
    <svg viewBox="0 0 48 16" className="h-4 w-12 shrink-0" aria-hidden>
      {values.map((v, i) => {
        const h = Math.max(1, (v / max) * 14);
        return <rect key={i} x={i * 8 + 1} y={16 - h} width={5} height={h} rx={1} className={i === values.length - 1 ? "fill-primary" : "fill-primary/35"} />;
      })}
    </svg>
  );
}

function CategoryDelta({ c }: { c: DashCategoryRow }) {
  if (c.deltaPct == null) return <span className="text-[11px] text-muted-foreground">novo</span>;
  const flat = Math.abs(c.deltaPct) < 0.02;
  const up = c.deltaPct > 0;
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${flat ? "text-muted-foreground" : up ? "text-red-700" : "text-emerald-700"}`}>
      <Icon size={11} aria-hidden />{flat ? "estável" : pct(c.deltaPct)}
      <span className="sr-only">{up ? " a mais" : " a menos"} que no período anterior</span>
    </span>
  );
}

const STACK = ["bg-primary", "bg-emerald-500", "bg-amber-500", "bg-sky-500", "bg-rose-500", "bg-violet-500"];

/** Para onde vai o dinheiro: categorias com participação no todo e estabelecimentos dentro. */
export function CategoryBreakdown({ d }: { d: ReportDashboard }) {
  const [open, setOpen] = useState<string | null>(null);
  const cats = d.categories;
  if (!cats.length) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-card p-6 text-center text-[12px] text-muted-foreground">
        Nenhuma despesa neste período e filtros.
      </section>
    );
  }
  const top = cats.slice(0, 5);
  const restShare = Math.max(0, 1 - top.reduce((a, c) => a + c.share, 0));
  return (
    <section aria-label="Para onde vai o dinheiro" className="rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-semibold">Para onde vai o dinheiro</p>
      <p className="text-[11px] text-muted-foreground">Toque numa categoria para ver os estabelecimentos.</p>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-secondary" role="img" aria-label="Participação de cada categoria no gasto">
        {top.map((c, i) => <span key={c.id} className={STACK[i]} style={{ width: `${c.share * 100}%`, marginRight: 2 }} title={`${c.name} ${pct(c.share)}`} />)}
        {restShare > 0.005 ? <span className="bg-slate-300" style={{ width: `${restShare * 100}%` }} title={`Demais ${pct(restShare)}`} /> : null}
      </div>
      <ul className="mt-3 divide-y divide-border">
        {cats.map((c, i) => {
          const isOpen = open === c.id;
          return (
            <li key={c.id}>
              <button type="button" onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen} className="flex w-full items-center gap-2 py-2.5 text-left">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${i < 5 ? STACK[i] : "bg-slate-300"}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold">{c.name}</span>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums">{formatBRL(c.total)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="tabular-nums">{pct(c.share)} do total{d.previous ? ` · antes ${formatBRL(c.previous)}` : ""}</span>
                    <span className="flex items-center gap-2">{d.previous ? <CategoryDelta c={c} /> : null}<Spark values={c.spark} /></span>
                  </span>
                </span>
                <ChevronDown size={14} aria-hidden className={`shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
              </button>
              {isOpen ? (
                <ul className="mb-2 ml-4 space-y-1 border-l border-border pl-3">
                  {c.merchants.map((m) => (
                    <li key={m.key} className="text-[12px]">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate">{m.label}</span>
                        <span className="shrink-0 tabular-nums">{formatBRL(m.total)}</span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary" aria-hidden><span className="block h-full rounded-full bg-primary/70" style={{ width: `${m.share * 100}%` }} /></span>
                        <span className="w-24 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                          {pct(m.share)} da categoria{m.deltaPct != null && Math.abs(m.deltaPct) >= 0.05 ? ` · ${m.deltaPct > 0 ? "+" : "−"}${pct(m.deltaPct)}` : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
