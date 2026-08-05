import { useState } from "react";
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Info, Minus } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/engine/facts";
import { type RhythmComparison } from "@/lib/engine/spendingRhythm";
import type { SpendingProjection } from "@/lib/engine/metrics";
import { RhythmMethodSheet } from "./RhythmMethodSheet";

type Trend = "up" | "down" | "stable";
type Props = { rhythm: RhythmComparison | null; projection: SpendingProjection | null; loading?: boolean; partial?: boolean; error?: unknown; onRetry?: () => void };
type ChartRow = { day: number; currentDate: string; previousDate: string | null; currentAmount: number; previousAmount: number | null; typicalAmount: number | null; refundAmount: number };

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
  const data: ChartRow[] = (current?.series ?? []).map((point, index) => ({ day: index + 1, currentDate: point.date, previousDate: previous?.series[index]?.date ?? null, currentAmount: point.netAmount, previousAmount: previous?.series[index]?.netAmount ?? null, typicalAmount: typicalPace > 0 ? typicalPace : null, refundAmount: point.refundAmount }));
  const hasData = data.length > 0 && ((current?.totalGross ?? 0) > 0 || (previous?.totalGross ?? 0) > 0);
  const hasPrevious = Boolean(previous && previous.totalGross > 0);
  const summary = current && hasPrevious ? `No período atual, a média foi ${formatBRL(current.average)} por dia. No período anterior, foi ${formatBRL(previous?.average ?? 0)} por dia.` : current ? `No período atual, a média foi ${formatBRL(current.average)} por dia. Ainda não há base comparável.` : "Ainda não há dados suficientes para calcular o ritmo.";
  const averageDelta = current && hasPrevious && previous ? current.average - previous.average : null;
  if (error) return <section aria-label="Ritmo de gastos" className="rounded-2xl border border-border bg-card p-4"><p className="text-xs font-bold text-primary">Ritmo de gastos</p><p className="mt-2 text-sm font-semibold text-foreground">Não foi possível atualizar seu ritmo</p><p className="mt-1 text-xs text-muted-foreground">Seu saldo e a orientação do Nino continuam disponíveis.</p>{onRetry ? <Button type="button" variant="ghost" onClick={onRetry} className="mt-2 min-h-11 px-2 text-primary">Tentar novamente</Button> : null}</section>;
  return (
    <section aria-label="Ritmo de gastos" className="overflow-hidden rounded-2xl border border-border bg-card animate-fade-in">
      <div className="flex items-start justify-between gap-3 px-4 pt-4"><div className="min-w-0"><p className="text-xs font-bold text-primary">Seu comportamento</p><h2 className="mt-1 text-lg font-bold text-foreground">Ritmo de gastos</h2>{loading ? <div className="mt-2 h-8 w-36 animate-pulse rounded bg-secondary" /> : <p className="mt-3 font-display text-[28px] font-extrabold leading-none tabular-nums text-foreground">{current ? formatBRL(current.average) : "—"}<span className="text-xs font-semibold text-muted-foreground">/dia</span></p>}<div className="mt-2"><Comparison trend={rhythm?.averageTrend ?? "stable"} deltaPct={hasPrevious ? rhythm?.averageDeltaPct ?? null : null} deltaAmount={averageDelta} /></div>{projection?.typicalDailyPace ? <p className="mt-2 text-xs text-muted-foreground">Seu típico: <strong className="text-foreground">{formatBRL(projection.typicalDailyPace)}/dia</strong></p> : null}{partial ? <p className="mt-2 text-xs text-muted-foreground">Comparação parcial enquanto atualizamos algumas fontes.</p> : null}</div><Button type="button" variant="ghost" size="icon" onClick={() => setMethodOpen(true)} aria-label="Como calculamos o ritmo" className="h-11 w-11 shrink-0 rounded-full text-muted-foreground"><Info /></Button></div>
      <p className="sr-only">{summary}</p>
       <div className={hasData || loading ? "mt-3 min-h-[154px] border-t border-border px-1 pt-2" : "mt-2"}>{loading ? <div className="mx-3 h-[148px] animate-pulse rounded-lg bg-secondary" /> : !hasData ? <div className="grid min-h-[72px] place-items-center px-6 pb-4 text-center text-xs text-muted-foreground">Assim que houver gastos, seu ritmo aparece aqui.</div> : <ResponsiveContainer width="100%" height={154}><LineChart data={data} margin={{ top: 10, right: 12, left: 4, bottom: 0 }}><CartesianGrid stroke="hsl(var(--border))" vertical={false} /><XAxis dataKey="day" tickFormatter={(value) => `D${value}`} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} minTickGap={24} /><YAxis hide /><ChartTooltip content={<ChartDetail />} /><Line type="linear" dataKey="currentAmount" stroke="hsl(var(--primary))" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />{typicalPace > 0 ? <Line type="linear" dataKey="typicalAmount" stroke="hsl(var(--risk))" strokeWidth={1.5} strokeDasharray="5 4" dot={false} /> : null}</LineChart></ResponsiveContainer>}</div>
       {hasData ? <div className="flex items-center gap-4 px-4 pb-4 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 bg-primary" />Atual</span>{typicalPace > 0 ? <span className="inline-flex items-center gap-1.5"><i className="h-0 w-4 border-t border-dashed border-risk" />Típico</span> : null}</div> : null}
       <RhythmMethodSheet open={methodOpen} onOpenChange={setMethodOpen} />
    </section>
  );
}