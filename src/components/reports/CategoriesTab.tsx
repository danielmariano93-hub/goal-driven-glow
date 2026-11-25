import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import type { CompareMode, DashCategoryRow, ReportDashboard } from "@/lib/engine/reportDashboard";
import { COMPARE_OPTIONS } from "@/lib/reports/dashboard/client";
import { brl0, categoryIcon } from "@/components/reports/StoryParts";
import { cn } from "@/lib/utils";

// Aba "Categorias e mais": para onde foi o dinheiro, por categoria e por estabelecimento, sempre com a
// comparação contra o período anterior (subiu, caiu ou ficou igual). Só desenha o que o servidor calculou.

type Change =
  | { kind: "up" | "down"; ratio: number }
  | { kind: "flat" }
  | { kind: "new" }
  | { kind: "none-yet" };

/** Sem comparação possível não vira número: "novo" (não havia gasto antes) ou "sem gasto até aqui" (havia no mês inteiro). */
function changeOf(total: number, previous: number, deltaPct: number | null, previousMonth?: number | null): Change {
  if (deltaPct == null) {
    if (previous <= 0 && (previousMonth ?? 0) > 0) return { kind: "none-yet" };
    return total > 0 && previous <= 0 ? { kind: "new" } : { kind: "flat" };
  }
  if (Math.abs(deltaPct) < 0.02) return { kind: "flat" };
  return { kind: deltaPct > 0 ? "up" : "down", ratio: deltaPct };
}

function ChangeChip({ change }: { change: Change }) {
  if (change.kind === "up" || change.kind === "down") {
    const up = change.kind === "up";
    return (
      <span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", up ? "bg-red-500/10 text-red-700" : "bg-emerald-500/10 text-emerald-700")}>
        {up ? "+" : "−"}{Math.round(Math.abs(change.ratio) * 100)}%
        <span className="sr-only">{up ? " a mais" : " a menos"} que no período anterior</span>
      </span>
    );
  }
  const text = change.kind === "flat" ? "estável" : change.kind === "new" ? "novo" : "sem gasto até aqui";
  return <span className="inline-flex shrink-0 items-center rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{text}</span>;
}

const fmtDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Quanto foi comparado com o quê, em uma linha. */
function comparisonLine(d: ReportDashboard, compare: CompareMode): string | null {
  if (compare === "none" || !d.previous) return null;
  const range = `${fmtDay(d.previous.start)} a ${fmtDay(d.previous.end)}`;
  return compare === "year" ? `Comparado com o mesmo período do ano passado (${range}).` : `Comparado com os mesmos dias do mês anterior (${range}).`;
}

/** Escolha do período de comparação: o único filtro que o relatório mantém, onde a comparação vive. */
export function CompareControl({ compare, onChange, comparisonAvailable }: { compare: CompareMode; onChange: (mode: CompareMode) => void; comparisonAvailable: boolean }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 text-[13px] print:hidden">
      <span className="font-semibold">Comparar com</span>
      <select value={compare} onChange={(e) => onChange(e.target.value as CompareMode)} className="min-w-0 max-w-[60%] rounded-lg bg-transparent py-1 text-right text-[13px] text-muted-foreground">
        {COMPARE_OPTIONS.filter((o) => o.id !== "year" || comparisonAvailable).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </label>
  );
}

function CategoryRow({ c, compared, open, onToggle }: { c: DashCategoryRow; compared: boolean; open: boolean; onToggle: () => void }) {
  const Icon = categoryIcon(c.name);
  const change = changeOf(c.total, c.previous, c.deltaPct, c.previousMonth);
  const wholeMonth = compared && c.previousMonth != null && c.previousMonth > c.previous + 0.5 ? c.previousMonth : null;
  const merchants = c.merchants.filter((m) => m.key !== "__others__" || c.merchants.length > 1);
  return (
    <li>
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full py-3 text-left">
        <span className="flex items-center gap-3">
          <Icon size={18} className="shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{c.name}</span>
          <span className="shrink-0 text-[14px] font-bold tabular-nums">{brl0(c.total)}</span>
          {compared ? <ChangeChip change={change} /> : null}
          <ChevronDown size={14} aria-hidden className={cn("shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </span>
        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden>
          <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, c.share * 100)}%` }} />
        </span>
        <span className="mt-1 block text-[11.5px] text-muted-foreground tabular-nums">
          {Math.round(c.share * 100)}% do total{compared ? ` · antes ${brl0(c.previous)}` : ""}{wholeMonth != null ? ` (mês passado inteiro ${brl0(wholeMonth)})` : ""}
        </span>
      </button>
      {open ? (
        <ul className="mb-3 ml-7 space-y-2 border-l border-border pl-3">
          {merchants.map((m) => (
            <li key={m.key} className="flex items-center gap-2 text-[13px]">
              <span className="min-w-0 flex-1">
                <span className="block truncate capitalize">{m.label}</span>
                {compared && m.key !== "__others__" ? <span className="block text-[11px] text-muted-foreground tabular-nums">antes {brl0(m.previous)}</span> : null}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{brl0(m.total)}</span>
              {compared && m.key !== "__others__" ? <ChangeChip change={changeOf(m.total, m.previous, m.deltaPct)} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function CategoriesList({ d, compared }: { d: ReportDashboard; compared: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (d.categories.length === 0) {
    return <p className="rounded-2xl border border-dashed border-border p-4 text-[12px] text-muted-foreground">Nenhuma despesa neste período.</p>;
  }
  return (
    <section aria-label="Categorias" className="rounded-2xl border border-border bg-card px-4 pt-4 print:break-inside-avoid">
      <p className="text-[15px] font-bold">Categorias</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">Toque numa categoria para ver os estabelecimentos.</p>
      <ul className="mt-1 divide-y divide-border">
        {d.categories.map((c) => (
          <CategoryRow key={c.id} c={c} compared={compared} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
        ))}
      </ul>
    </section>
  );
}

type MerchantAgg = { key: string; label: string; total: number; previous: number; category: string; topCategoryTotal: number };

/** Estabelecimentos do período (somando as categorias em que aparecem), maiores primeiro. */
export function aggregateMerchants(d: ReportDashboard): MerchantAgg[] {
  const acc = new Map<string, MerchantAgg>();
  for (const c of d.categories) {
    for (const m of c.merchants) {
      if (m.key === "__others__" || m.key === "__none__") continue;
      const cur = acc.get(m.key) ?? { key: m.key, label: m.label, total: 0, previous: 0, category: c.name, topCategoryTotal: 0 };
      cur.total += m.total;
      cur.previous += m.previous;
      if (m.total > cur.topCategoryTotal) { cur.topCategoryTotal = m.total; cur.category = c.name; }
      acc.set(m.key, cur);
    }
  }
  return [...acc.values()].sort((a, b) => b.total - a.total);
}

const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function MerchantsList({ d, compared }: { d: ReportDashboard; compared: boolean }) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(10);
  const all = useMemo(() => aggregateMerchants(d), [d]);
  const rows = useMemo(() => {
    const q = normalize(query.trim());
    return q ? all.filter((m) => normalize(m.label).includes(q) || normalize(m.category).includes(q)) : all;
  }, [all, query]);
  if (all.length === 0) {
    return <p className="rounded-2xl border border-dashed border-border p-4 text-[12px] text-muted-foreground">Ainda não há estabelecimentos identificados neste período.</p>;
  }
  const shown = rows.slice(0, limit);
  return (
    <section aria-label="Estabelecimentos" className="rounded-2xl border border-border bg-card p-4 print:break-inside-avoid">
      <p className="text-[15px] font-bold">Estabelecimentos</p>
      <p className="mt-0.5 text-[12px] text-muted-foreground">Onde você mais gastou e como isso mudou.</p>
      <label className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 print:hidden">
        <Search size={15} className="text-muted-foreground" aria-hidden />
        <input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(10); }} placeholder="Buscar estabelecimento ou categoria" aria-label="Buscar estabelecimento ou categoria"
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
      </label>
      {rows.length === 0 ? <p className="mt-3 text-[12px] text-muted-foreground">Nenhum estabelecimento encontrado.</p> : (
        <ul className="mt-2 divide-y divide-border">
          {shown.map((m) => (
            <li key={m.key} className="flex items-center gap-3 py-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-bold text-muted-foreground" aria-hidden>{m.label.trim().slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold capitalize">{m.label}</span>
                <span className="block truncate text-[11.5px] text-muted-foreground tabular-nums">{m.category}{compared ? ` · antes ${brl0(m.previous)}` : ""}</span>
              </span>
              <span className="shrink-0 text-[13.5px] font-bold tabular-nums">{brl0(m.total)}</span>
              {compared ? <ChangeChip change={changeOf(m.total, m.previous, m.previous > 0 ? (m.total - m.previous) / m.previous : null)} /> : null}
            </li>
          ))}
        </ul>
      )}
      {rows.length > limit ? (
        <button type="button" onClick={() => setLimit((n) => n + 15)} className="mt-2 w-full rounded-full border border-border py-2 text-[12.5px] font-semibold text-primary print:hidden">
          Ver mais ({rows.length - limit})
        </button>
      ) : null}
    </section>
  );
}

/** Conteúdo inteiro da aba. */
export function CategoriesTabContent({ d, compare, onCompare }: { d: ReportDashboard; compare: CompareMode; onCompare: (mode: CompareMode) => void }) {
  const compared = compare !== "none" && d.previous != null;
  const line = comparisonLine(d, compare);
  return (
    <div className="space-y-3">
      <CompareControl compare={compare} onChange={onCompare} comparisonAvailable={d.coverage.comparisonAvailable} />
      {line ? <p className="px-1 text-[11.5px] text-muted-foreground">{line}</p> : null}
      <CategoriesList d={d} compared={compared} />
      <MerchantsList d={d} compared={compared} />
    </div>
  );
}
