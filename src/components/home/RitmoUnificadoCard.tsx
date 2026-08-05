import { useState } from "react";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, ChevronDown, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/engine/facts";
import { EXCLUSION_REASON_LABEL, formatRangeShort, type RhythmComparison } from "@/lib/engine/spendingRhythm";
import type { SpendingProjection } from "@/lib/engine/metrics";

type Trend = "up" | "down" | "stable";
type Props = { rhythm: RhythmComparison | null; projection: SpendingProjection | null; loading?: boolean };

function shortDay(iso: string) { const [, month, day] = iso.split("-"); return `${day}/${month}`; }

function Comparison({ trend, deltaPct }: { trend: Trend; deltaPct: number | null }) {
  if (deltaPct == null) return <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold text-muted-foreground">Sem base anterior</span>;
  if (Math.abs(deltaPct) < 1) return <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold text-muted-foreground"><Minus /> Estável</span>;
  const higher = trend === "up";
  const Icon = higher ? ArrowUpRight : ArrowDownRight;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold tabular-nums ${higher ? "bg-warning/15 text-foreground" : "bg-success/10 text-success"}`}><Icon /> {Math.abs(deltaPct).toFixed(1).replace(".", ",")}% {higher ? "acima" : "abaixo"}</span>;
}

export function RitmoUnificadoCard({ rhythm, projection, loading }: Props) {
  const [open, setOpen] = useState(false);
  const current = rhythm?.current;
  const previous = rhythm?.previous;
  const data = (current?.series ?? []).map((point) => ({ label: shortDay(point.date), atual: point.runningAverage, tipico: point.typicalRunningAverage }));
  const hasData = data.length > 0 && (current?.totalGross ?? 0) > 0;
  return (
    <section aria-label="Ritmo de gastos" className="overflow-hidden rounded-[20px] border border-border/70 bg-card">
      <div className="flex items-end justify-between gap-3 px-4 pt-4"><div className="min-w-0"><p className="text-[10px] font-bold uppercase text-muted-foreground">Ritmo de gastos</p><p className="mt-1 font-display text-[27px] font-extrabold leading-none tabular-nums text-foreground">{loading || !projection ? "—" : formatBRL(projection.currentDailyPace)}<span className="text-[12px] font-semibold text-muted-foreground">/dia</span></p><p className="mt-2 text-[11px] text-muted-foreground">Típico: {projection ? `${formatBRL(projection.typicalDailyPace)}/dia` : "—"}</p></div><Comparison trend={rhythm?.typicalTrend ?? "stable"} deltaPct={rhythm?.typicalDeltaPct ?? null} /></div>
      <div className="px-1 pt-2">{loading ? <div className="mx-3 h-[130px] animate-pulse rounded-xl bg-secondary" /> : !hasData ? <div className="grid h-[110px] place-items-center px-6 text-center text-[12px] text-muted-foreground">Assim que você lançar o primeiro gasto, o ritmo aparece aqui.</div> : <ResponsiveContainer width="100%" height={132}><AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}><defs><linearGradient id="paceFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.16} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} minTickGap={28} /><YAxis hide /><Tooltip formatter={(value: number, name: string) => [formatBRL(Number(value)), name === "atual" ? "Média até o dia" : "Ritmo sem fixas/atípicos"]} contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }} /><Area type="monotone" dataKey="atual" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#paceFill)" dot={false} /><Line type="monotone" dataKey="tipico" stroke="hsl(var(--success))" strokeWidth={1.5} strokeDasharray="5 4" dot={false} /></AreaChart></ResponsiveContainer>}</div>
      <div className="border-t border-border/70 px-4 py-2"><Button type="button" variant="ghost" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="w-full rounded-full text-[11px] text-muted-foreground">{open ? "Ocultar detalhes" : "Entender o ritmo"}<ChevronDown className={open ? "rotate-180 transition-transform" : "transition-transform"} /></Button>{open && current ? <div className="space-y-2 pb-2 text-[11px] leading-relaxed text-muted-foreground"><p>O ritmo atual divide o gasto realizado pelos {projection?.daysElapsed ?? current.days} dias corridos, inclusive dias sem gasto. A referência típica usa 90 dias e retira despesas fixas e valores atípicos.</p><p>Comparação: {previous ? formatRangeShort(previous.range) : "sem período anterior comparável"}.</p>{current.excludedByReason.length ? <div className="flex flex-wrap gap-1.5">{current.excludedByReason.map((group) => <span key={group.reason} className="rounded-full bg-secondary px-2 py-1 text-[10px]">{EXCLUSION_REASON_LABEL[group.reason] ?? group.label}: {formatBRL(group.total)}</span>)}</div> : null}</div> : null}</div>
    </section>
  );
}