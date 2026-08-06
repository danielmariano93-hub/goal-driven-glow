import { useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Info, Minus } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/engine/facts";
import { type RhythmComparison } from "@/lib/engine/spendingRhythm";
import type { SpendingProjection } from "@/lib/engine/metrics";
import { RhythmMethodSheet } from "./RhythmMethodSheet";

type Trend = "up" | "down" | "stable";
type Props = { rhythm: RhythmComparison | null; projection: SpendingProjection | null; loading?: boolean; partial?: boolean; error?: unknown; onRetry?: () => void };
type ChartRow = { day: number; currentDate: string; previousDate: string | null; currentAmount: number; previousAmount: number | null; refundAmount: number };

function shortDay(iso: string) { const [, month, day] = iso.split("-"); return `${day}/${month}`; }

function Comparison({ trend, deltaPct, deltaAmount }: { trend: Trend; deltaPct: number | null; deltaAmount: number | null }) {
  if (deltaPct == null || deltaAmount == null) return <span className="text-xs font-medium text-muted-foreground">Ainda sem base comparável</span>;
  if (Math.abs(deltaPct) < 1) return <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"><Minus /> Ritmo estável</span>;
  const higher = trend === "up";
  const Icon = higher ? ArrowUpRight : ArrowDownRight;
  return <span className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${higher ? "text-destructive" : "text-success"}`}><Icon weight="bold" /> {formatBRL(Math.abs(deltaAmount))} {higher ? "acima" : "abaixo"}</span>;
}

function ChartDetail({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartRow }> }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const difference = row.previousAmount == null ? null : row.currentAmount - row.previousAmount;
  return <div className="rounded-lg border border-border bg-popover p-3 text-xs shadow-md"><p className="font-semibold text-foreground">Dia {row.day} comparável</p><p className="mt-1 text-muted-foreground">Atual · {shortDay(row.currentDate)}: <strong className="text-foreground">{formatBRL(row.currentAmount)}</strong></p>{row.previousDate && row.previousAmount != null ? <p className="text-muted-foreground">Anterior · {shortDay(row.previousDate)}: <strong className="text-foreground">{formatBRL(row.previousAmount)}</strong></p> : null}{difference != null ? <p className="mt-1 text-muted-foreground">Diferença: <strong className="text-foreground">{difference > 0 ? "+" : ""}{formatBRL(difference)}</strong></p> : null}{row.refundAmount > 0 ? <p className="mt-1 text-muted-foreground">Reembolsos: {formatBRL(row.refundAmount)}</p> : null}</div>;
}

export function RitmoUnificadoCard({ rhythm, projection, loading, partial, error, onRetry }: Props) {
  const [methodOpen, setMethodOpen] = useState(false);
  const current = rhythm?.current;
  const previous = rhythm?.previous;
  const typicalPace = projection?.typicalDailyPace ?? 0;
  const data: ChartRow[] = (current?.series ?? []).map((point, index) => ({ day: index + 1, currentDate: point.date, previousDate: previous?.series[index]?.date ?? null, currentAmount: point.netAmount, previousAmount: previous?.series[index]?.netAmount ?? null, refundAmount: point.refundAmount }));
  const hasData = data.length > 0 && ((current?.totalGross ?? 0) > 0 || (previous?.totalGross ?? 0) > 0);
  const hasPrevious = Boolean(previous && previous.totalGross > 0);
  const summary = current && hasPrevious ? `No período atual, a média foi ${formatBRL(current.average)} por dia. No período anterior, foi ${formatBRL(previous?.average ?? 0)} por dia.` : current ? `No período atual, a média foi ${formatBRL(current.average)} por dia. Ainda não há base comparável.` : "Ainda não há dados suficientes para calcular o ritmo.";
  const averageDelta = current && hasPrevious && previous ? current.average - previous.average : null;
  if (error) return <section aria-label="Ritmo de gastos" className="rounded-2xl border border-border bg-card p-4"><p className="text-xs font-bold text-primary">Ritmo de gastos</p><p className="mt-2 text-sm font-semibold text-foreground">Não foi possível atualizar seu ritmo</p><p className="mt-1 text-xs text-muted-foreground">Seu saldo e a orientação do Nino continuam disponíveis.</p>{onRetry ? <Button type="button" variant="ghost" onClick={onRetry} className="mt-2 min-h-11 px-2 text-primary">Tentar novamente</Button> : null}</section>;
  return (
    <section aria-label="Ritmo de gastos" className="overflow-hidden rounded-[18px] border border-border bg-card shadow-sm animate-fade-in">
      <div className="flex items-start justify-between gap-3 px-4 pt-4"><div className="min-w-0"><p className="text-[11px] font-semibold text-primary">Seu comportamento</p><h2 className="mt-0.5 font-display text-base font-bold leading-5 text-foreground">Seu ritmo de gastos</h2>{loading ? <div className="mt-2 h-7 w-32 animate-pulse rounded bg-secondary" /> : <p className="mt-2 font-display text-2xl font-bold leading-7 tabular-nums text-foreground">{current ? formatBRL(current.average) : "—"}<span className="font-interface text-[11px] font-semibold text-muted-foreground">/dia</span></p>}<div className="mt-1"><Comparison trend={rhythm?.averageTrend ?? "stable"} deltaPct={hasPrevious ? rhythm?.averageDeltaPct ?? null : null} deltaAmount={averageDelta} /></div>{typicalPace > 0 ? <p className="mt-1.5 text-[11px] text-muted-foreground">Padrão habitual: <strong className="text-foreground">{formatBRL(typicalPace)}/dia</strong></p> : <p className="mt-1.5 text-[11px] text-muted-foreground">Ainda estamos aprendendo seu padrão habitual.</p>}{partial ? <p className="mt-1.5 text-[11px] text-muted-foreground">Comparação parcial enquanto atualizamos algumas fontes.</p> : null}</div><Button type="button" variant="ghost" size="icon" onClick={() => setMethodOpen(true)} aria-label="Como calculamos o ritmo" className="h-10 w-10 shrink-0 rounded-full text-muted-foreground"><Info size={17} /></Button></div>
      <p className="sr-only">{summary}</p>
       <div className={hasData || loading ? "mt-2 min-h-[132px] border-t border-border px-1 pt-1" : "mt-2"}>{loading ? <div className="mx-4 h-[124px] animate-pulse rounded-xl bg-secondary" /> : !hasData ? <div className="grid min-h-[96px] place-items-center px-5 pb-3 text-center"><div><p className="text-[13px] text-muted-foreground">Ainda não há gastos neste período.</p><Button asChild variant="ghost" className="mt-1 min-h-10 text-primary"><Link to="/app/lancamentos">Anotar movimentação</Link></Button></div></div> : <ResponsiveContainer width="100%" height={128}><ComposedChart data={data} margin={{ top: 8, right: 10, left: -22, bottom: 0 }}><defs><linearGradient id="rhythmFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.06} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="hsl(var(--border))" vertical={false} horizontalValues={[0]} /><XAxis dataKey="day" tickFormatter={(value) => `D${value}`} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} minTickGap={24} /><YAxis hide domain={[0, "auto"]} /><ChartTooltip content={<ChartDetail />} cursor={{ stroke: "hsl(var(--border))" }} /><Area type="monotone" dataKey="currentAmount" stroke="none" fill="url(#rhythmFill)" /><Line type="monotone" dataKey="currentAmount" stroke="hsl(var(--primary))" strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 4 }} /><Line type="monotone" dataKey="previousAmount" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="6 4" dot={false} activeDot={{ r: 4 }} connectNulls /></ComposedChart></ResponsiveContainer>}</div>
       {hasData ? <div className="flex items-center gap-4 px-4 pb-1 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 bg-primary" />Este período</span><span className="inline-flex items-center gap-1.5"><i className="h-0 w-4 border-t border-dashed border-muted-foreground" />Período anterior</span></div> : null}
       {hasData ? <div className="px-4 pb-2"><Button asChild variant="ghost" size="sm" className="min-h-10 w-full justify-start px-0 text-[13px] text-primary"><Link to="/app/lancamentos">Ver rotina e categorias</Link></Button></div> : null}
       <RhythmMethodSheet open={methodOpen} onOpenChange={setMethodOpen} />
    </section>
  );
}