import { useState } from "react";
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, ChevronDown, Info, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatBRL } from "@/lib/engine/facts";
import { EXCLUSION_REASON_LABEL, formatRangeShort, type RhythmComparison } from "@/lib/engine/spendingRhythm";
import type { SpendingProjection } from "@/lib/engine/metrics";

type Trend = "up" | "down" | "stable";
type Props = { rhythm: RhythmComparison | null; projection: SpendingProjection | null; loading?: boolean };
type ChartRow = { day: number; currentDate: string; previousDate: string; currentAmount: number; previousAmount: number; refundAmount: number; runningAverage: number };

function shortDay(iso: string) { const [, month, day] = iso.split("-"); return `${day}/${month}`; }

function Comparison({ trend, deltaPct }: { trend: Trend; deltaPct: number | null }) {
  if (deltaPct == null) return <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold text-muted-foreground">Sem base anterior</span>;
  if (Math.abs(deltaPct) < 1) return <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-1 text-[10px] font-semibold text-muted-foreground"><Minus /> Estável</span>;
  const higher = trend === "up";
  const Icon = higher ? ArrowUpRight : ArrowDownRight;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold tabular-nums ${higher ? "bg-warning/15 text-foreground" : "bg-success/10 text-success"}`}><Icon /> {Math.abs(deltaPct).toFixed(1).replace(".", ",")}% {higher ? "acima" : "abaixo"}</span>;
}

function InfoTerm({ label, children }: { label: string; children: React.ReactNode }) {
  return <Popover><PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" className="h-8 gap-1 rounded-full px-2 text-[10px] text-muted-foreground">{label}<Info className="h-3 w-3" /></Button></PopoverTrigger><PopoverContent align="start" className="w-72 text-[12px] leading-relaxed">{children}</PopoverContent></Popover>;
}

function ChartDetail({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartRow }> }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return <div className="rounded-md border border-border bg-popover p-3 text-[11px] shadow-md"><p className="font-semibold text-foreground">Dia {row.day} comparável</p><p className="mt-1 text-muted-foreground">Atual · {shortDay(row.currentDate)}: <strong className="text-foreground">{formatBRL(row.currentAmount)}</strong></p><p className="text-muted-foreground">Anterior · {shortDay(row.previousDate)}: <strong className="text-foreground">{formatBRL(row.previousAmount)}</strong></p>{row.refundAmount > 0 ? <p className="mt-1 text-muted-foreground">Reembolsos no dia: {formatBRL(row.refundAmount)}</p> : null}<p className="mt-1 text-muted-foreground">Média acumulada atual: {formatBRL(row.runningAverage)}/dia</p></div>;
}

export function RitmoUnificadoCard({ rhythm, projection, loading }: Props) {
  const [open, setOpen] = useState(false);
  const current = rhythm?.current;
  const previous = rhythm?.previous;
  const data: ChartRow[] = (current?.series ?? []).map((point, index) => ({ day: index + 1, currentDate: point.date, previousDate: previous?.series[index]?.date ?? point.date, currentAmount: point.netAmount, previousAmount: previous?.series[index]?.netAmount ?? 0, refundAmount: point.refundAmount, runningAverage: point.runningAverage }));
  const hasData = data.length > 0 && ((current?.totalGross ?? 0) > 0 || (previous?.totalGross ?? 0) > 0);
  const summary = current && previous ? `No período atual, o gasto líquido foi ${formatBRL(current.total)}, média de ${formatBRL(current.average)} por dia. No período anterior, foi ${formatBRL(previous.total)}, média de ${formatBRL(previous.average)} por dia.` : "Ainda não há dados suficientes para comparar o ritmo.";
  return (
    <section aria-label="Ritmo de gastos" className="overflow-hidden rounded-[20px] border border-border/70 bg-card">
      <div className="flex items-end justify-between gap-3 px-4 pt-4"><div className="min-w-0"><p className="text-[10px] font-bold uppercase text-muted-foreground">Ritmo de gastos</p>{loading ? <div className="mt-2 h-8 w-36 animate-pulse rounded bg-secondary" /> : <p className="mt-1 font-display text-[27px] font-extrabold leading-none tabular-nums text-foreground">{current ? formatBRL(current.average) : "—"}<span className="text-[12px] font-semibold text-muted-foreground">/dia</span></p>}<p className="mt-2 text-[11px] text-muted-foreground">Típico: {projection ? `${formatBRL(projection.typicalDailyPace)}/dia` : "—"}</p></div><Comparison trend={rhythm?.averageTrend ?? "stable"} deltaPct={rhythm?.averageDeltaPct ?? null} /></div>
      <div className="mt-2 flex flex-wrap gap-1 px-2"><InfoTerm label="Ritmo atual">Gasto líquido realizado dividido por todos os dias corridos do período, inclusive os dias sem gasto.</InfoTerm><InfoTerm label="Ritmo típico">Referência dos últimos 90 dias até hoje. Retira contas estruturais e recorrentes; valores atípicos acima de Q3 + 1,5×IIQ saem quando há ao menos oito lançamentos.</InfoTerm><InfoTerm label="Período anterior">Mesmos dias do mês anterior para mês/mês-até-hoje. Em janelas móveis ou personalizadas, usa a janela imediatamente anterior com igual quantidade de dias.</InfoTerm></div>
      <p className="sr-only">{summary}</p>
      <div className="px-1 pt-1">{loading ? <div className="mx-3 h-[148px] animate-pulse rounded-xl bg-secondary" /> : !hasData ? <div className="grid h-[120px] place-items-center px-6 text-center text-[12px] text-muted-foreground">Assim que houver gastos comparáveis, o ritmo aparece aqui.</div> : <ResponsiveContainer width="100%" height={154}><LineChart data={data} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} /><XAxis dataKey="day" tickFormatter={(value) => `D${value}`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} minTickGap={24} /><YAxis hide /><ChartTooltip content={<ChartDetail />} /><Line type="linear" dataKey="currentAmount" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={{ r: 2, fill: "hsl(var(--primary))" }} activeDot={{ r: 4 }} /><Line type="linear" dataKey="previousAmount" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="5 4" dot={false} /></LineChart></ResponsiveContainer>}</div>
      <div className="flex items-center gap-4 px-4 pb-2 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 bg-primary" />Atual</span><span className="inline-flex items-center gap-1.5"><i className="h-0 w-4 border-t border-dashed border-muted-foreground" />Anterior</span></div>
      <div className="border-t border-border/70 px-4 py-2"><Button type="button" variant="ghost" size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="w-full rounded-full text-[11px] text-muted-foreground">{open ? "Ocultar detalhes" : "Entender o ritmo"}<ChevronDown className={open ? "rotate-180 transition-transform" : "transition-transform"} /></Button>{open && current ? <div className="space-y-2 pb-2 text-[11px] leading-relaxed text-muted-foreground"><p>Atual: {formatRangeShort(current.range)} · anterior: {previous ? formatRangeShort(previous.range) : "sem período comparável"}.</p>{current.excludedByReason.length ? <div className="flex flex-wrap gap-1.5">{current.excludedByReason.map((group) => <span key={group.reason} className="rounded-full bg-secondary px-2 py-1 text-[10px]">{EXCLUSION_REASON_LABEL[group.reason] ?? group.label}: {formatBRL(group.total)}</span>)}</div> : <p>Nenhuma despesa foi retirada da referência típica neste período.</p>}</div> : null}</div>
    </section>
  );
}