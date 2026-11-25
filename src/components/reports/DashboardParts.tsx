import { useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Check, ChevronDown, Equal, Minus, Search, SlidersHorizontal, TrendingDown, TrendingUp, X } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import type { DashHighlight, Delta, Direction, Habit, ReportDashboard, TrendMonth, Verdict } from "@/lib/engine/reportDashboard";
import { COMPARE_OPTIONS, PERIOD_PRESETS, type DashboardQuery } from "@/lib/reports/dashboard/client";

// Painel de Relatórios. Status nunca é só cor: todo estado tem ícone + rótulo.

const pct = (ratio: number) => `${Math.round(Math.abs(ratio) * 100)}%`;

/** Variação com seta + texto. `upIsGood` diz se subir é bom (renda) ou ruim (gasto). */
function DeltaBadge({ delta, upIsGood, label }: { delta: Delta | null; upIsGood: boolean; label?: string }) {
  if (!delta || delta.pct == null) return <span className="text-[11px] text-muted-foreground">{label ?? "sem base de comparação"}</span>;
  const flat = Math.abs(delta.pct) < 0.005;
  const up = delta.pct > 0;
  const good = flat ? null : up === upIsGood;
  const tone = flat ? "text-muted-foreground" : good ? "text-emerald-700" : "text-red-700";
  const Icon = flat ? Minus : up ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${tone}`}>
      <Icon size={11} aria-hidden />
      {flat ? "estável" : `${pct(delta.pct)}`}
      <span className="sr-only">{up ? " a mais" : " a menos"} que no período anterior</span>
    </span>
  );
}

const DIRECTION: Record<Direction, { label: string; cls: string; Icon: typeof Check }> = {
  better: { label: "Melhorou", cls: "bg-emerald-500/15 text-emerald-700", Icon: Check },
  worse: { label: "Piorou", cls: "bg-red-500/15 text-red-700", Icon: X },
  same: { label: "Igual", cls: "bg-slate-500/10 text-slate-600", Icon: Equal },
  unknown: { label: "Sem base", cls: "bg-secondary text-muted-foreground", Icon: Minus },
};

export function DirectionChip({ direction }: { direction: Direction }) {
  const d = DIRECTION[direction];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${d.cls}`}>
      <d.Icon size={11} aria-hidden /> {d.label}
    </span>
  );
}

/** Período, comparação e filtros: tudo em uma barra, sem escolher "tipo de relatório". */
export function PeriodBar({
  query, onChange, categories, today, comparisonAvailable,
}: {
  query: DashboardQuery;
  onChange: (patch: Partial<DashboardQuery>) => void;
  categories: Array<{ id: string; name: string; total: number }>;
  today: string;
  comparisonAvailable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(query.merchant);
  const active = query.categoryIds.length + (query.merchant ? 1 : 0);
  return (
    <section aria-label="Período e filtros" className="space-y-2 print:hidden">
      <div role="tablist" aria-label="Período" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={query.preset === p.id}
            onClick={() => onChange(p.id === "custom" ? { preset: "custom" } : { preset: p.id })}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${query.preset === p.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {query.preset === "custom" ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-muted-foreground">
            De
            <input type="date" value={query.start} max={query.end} onChange={(e) => e.target.value && onChange({ preset: "custom", start: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Até
            <input type="date" value={query.end} min={query.start} max={today} onChange={(e) => e.target.value && onChange({ preset: "custom", end: e.target.value })} className="mt-1 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" />
          </label>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          Comparar com
          <select
            value={query.compare}
            onChange={(e) => onChange({ compare: e.target.value as DashboardQuery["compare"] })}
            className="h-8 rounded-full border border-border bg-card px-2 text-xs text-foreground"
            style={{ fontSize: 16 }}
          >
            {COMPARE_OPTIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={`ml-auto inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${active ? "border-primary text-primary" : "border-border"}`}
        >
          <SlidersHorizontal size={12} aria-hidden /> Filtros{active ? ` (${active})` : ""} <ChevronDown size={12} aria-hidden className={open ? "rotate-180" : ""} />
        </button>
      </div>
      {query.compare !== "none" && !comparisonAvailable ? (
        <p className="text-[11px] text-muted-foreground">Ainda não há histórico para esse período de comparação; os números aparecem sem variação.</p>
      ) : null}
      {open ? (
        <div className="space-y-2 rounded-2xl border border-border bg-card p-3">
          <p className="text-[11px] font-semibold text-muted-foreground">Categorias</p>
          <div className="flex flex-wrap gap-1.5">
            {categories.slice(0, 20).map((c) => {
              const on = query.categoryIds.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ categoryIds: on ? query.categoryIds.filter((id) => id !== c.id) : [...query.categoryIds, c.id] })}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${on ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
                >
                  {on ? <Check size={11} aria-hidden /> : null}{c.name}
                </button>
              );
            })}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => { e.preventDefault(); onChange({ merchant: text.trim() }); }}
          >
            <label className="flex h-10 flex-1 items-center gap-2 rounded-xl border border-border bg-background px-3">
              <Search size={13} aria-hidden className="text-muted-foreground" />
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Estabelecimento (ex.: Uber)" className="w-full bg-transparent text-sm outline-none" style={{ fontSize: 16 }} aria-label="Filtrar por estabelecimento" />
            </label>
            <button type="submit" className="h-10 rounded-full bg-primary px-4 text-xs font-semibold text-primary-foreground">Aplicar</button>
          </form>
          {active ? (
            <button type="button" onClick={() => { setText(""); onChange({ categoryIds: [], merchant: "" }); }} className="text-[11px] font-medium text-primary underline">Limpar filtros</button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

const VERDICT_STYLE = {
  better: { box: "border-emerald-500/40 bg-emerald-500/5", Icon: TrendingUp, tone: "text-emerald-700" },
  worse: { box: "border-red-500/40 bg-red-500/5", Icon: TrendingDown, tone: "text-red-700" },
  same: { box: "border-border bg-card", Icon: Equal, tone: "text-foreground" },
  insufficient: { box: "border-border bg-card", Icon: Minus, tone: "text-muted-foreground" },
} as const;

/** O veredito: como estou, melhor ou pior, e os sinais que explicam. */
export function VerdictCard({ verdict, filtered, periodLabel, previousLabel }: { verdict: Verdict | null; filtered: boolean; periodLabel: string; previousLabel: string | null }) {
  if (!verdict) {
    return (
      <section className="rounded-2xl border border-border bg-card p-4" aria-label="Veredito">
        <p className="text-sm font-semibold">Visão filtrada</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {filtered ? "Com filtro, o painel mostra só despesas. Remova os filtros para ver o veredito geral." : "Sem veredito para este período."}
        </p>
      </section>
    );
  }
  const s = VERDICT_STYLE[verdict.kind];
  return (
    <section className={`rounded-2xl border p-4 ${s.box}`} aria-label="Veredito">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {periodLabel}{previousLabel ? ` · vs. ${previousLabel}` : ""}
      </p>
      <div className="mt-2 flex items-start gap-2.5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-background ${s.tone}`}><s.Icon size={18} aria-hidden /></span>
        <div className="min-w-0">
          <p className={`font-display text-[19px] font-bold leading-tight ${s.tone}`}>{verdict.headline}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{verdict.summary}</p>
        </div>
      </div>
      {verdict.signals.length ? (
        <ul className="mt-3 space-y-1.5">
          {verdict.signals.map((sig) => (
            <li key={sig.key} className="flex items-start gap-2 text-[12px]">
              <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${sig.tone === "good" ? "bg-emerald-500/20 text-emerald-700" : sig.tone === "bad" ? "bg-red-500/20 text-red-700" : "bg-secondary text-muted-foreground"}`}>
                {sig.tone === "good" ? <Check size={10} aria-label="a favor" /> : sig.tone === "bad" ? <X size={10} aria-label="contra" /> : <Minus size={10} aria-label="neutro" />}
              </span>
              <span><strong className="font-semibold">{sig.label}:</strong> <span className="text-muted-foreground">{sig.detail}</span></span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Entrou, saiu, sobrou, poupança e gasto por dia, cada um com a variação. */
export function KpiStrip({ d }: { d: ReportDashboard }) {
  const t = d.totals;
  const dl = d.deltas;
  const cards: Array<{ label: string; value: string; delta: Delta | null; upIsGood: boolean; extra?: string; note?: string }> = [];
  if (!d.filtered) {
    const other = (d.otherInflows ?? []).reduce((a, x) => a + x.amount, 0);
    cards.push({
      label: "Renda do período", value: formatBRL(t.income), delta: dl?.income ?? null, upIsGood: true,
      note: other > 0 ? `Entrou também ${formatBRL(other)} que não é renda (veja abaixo)` : undefined,
    });
  }
  const anticNote = d.anticipation && d.anticipation.amount > 0
    ? `Não inclui ${formatBRL(d.anticipation.amount)} de parcelas antecipadas (dívida paga antes do prazo)`
    : undefined;
  cards.push({
    label: "Saiu", value: formatBRL(t.expense), delta: dl?.expense ?? null, upIsGood: false,
    note: [t.refunds > 0 ? `+ ${formatBRL(t.refunds)} de estorno que voltou` : null, anticNote].filter(Boolean).join(" · ") || undefined,
  });
  if (!d.filtered) {
    cards.push({ label: "Sobrou", value: `${t.net < 0 ? "−" : ""}${formatBRL(Math.abs(t.net))}`, delta: dl?.net ?? null, upIsGood: true });
    cards.push({
      label: "Poupança", value: t.savingsRate == null ? "—" : `${t.savingsRate < 0 ? "−" : ""}${pct(t.savingsRate)}`, delta: null, upIsGood: true,
      extra: dl?.savingsRatePoints != null ? `${dl.savingsRatePoints >= 0 ? "+" : "−"}${Math.abs(Math.round(dl.savingsRatePoints))} p.p.` : undefined,
    });
  }
  cards.push({ label: "Gasto por dia", value: formatBRL(t.dailyAvg), delta: dl?.dailyAvg ?? null, upIsGood: false });
  return (
    <section aria-label="Resumo do período" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {cards.map((c) => (
        <div key={c.label} className="rounded-2xl border border-border bg-card p-3">
          <p className="text-[11px] text-muted-foreground">{c.label}</p>
          <p className="mt-0.5 font-display text-[17px] font-bold tabular-nums">{c.value}</p>
          {c.extra ? (
            <p className={`text-[11px] font-semibold tabular-nums ${c.extra.startsWith("+") ? "text-emerald-700" : "text-red-700"}`}>{c.extra}</p>
          ) : <DeltaBadge delta={c.delta} upIsGood={c.upIsGood} label={d.previous ? undefined : "sem comparação"} />}
          {c.note ? <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{c.note}</p> : null}
        </div>
      ))}
    </section>
  );
}
