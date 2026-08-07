import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from "recharts";
import { ArrowDownRight, ArrowUpRight, Info, Minus } from "@phosphor-icons/react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatBRL } from "@/lib/engine/facts";
import { type RhythmComparison } from "@/lib/engine/spendingRhythm";
import type { SpendingProjection } from "@/lib/engine/metrics";
import { RhythmMethodSheet } from "./RhythmMethodSheet";

type Trend = "up" | "down" | "stable";
type SeriesMode = "typical" | "all";
type Props = { rhythm: RhythmComparison | null; projection: SpendingProjection | null; loading?: boolean; partial?: boolean; error?: unknown; onRetry?: () => void };
type ChartRow = {
  day: number;
  currentDate: string;
  previousDate: string | null;
  currentAmount: number;
  previousAmount: number | null;
  refundAmount: number;
  grossAmount: number;
  typicalAmount: number;
  /** motivo pelo qual parte do dia ficou fora do ritmo típico */
  exclusionLabel: string | null;
  atypical: boolean;
};

function shortDay(iso: string) { const [, month, day] = iso.split("-"); return `${day}/${month}`; }

const REASON_LABEL: Record<string, string> = {
  outlier: "gasto atípico",
  fixed: "gasto fixo",
  installment: "parcelamento",
  recurring: "recorrência",
};

function Comparison({ trend, deltaPct, deltaAmount }: { trend: Trend; deltaPct: number | null; deltaAmount: number | null }) {
  if (deltaPct == null || deltaAmount == null) return <span className="text-xs font-medium text-muted-foreground">Ainda sem base comparável</span>;
  if (Math.abs(deltaPct) < 1) return <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"><Minus /> Ritmo estável</span>;
  const higher = trend === "up";
  const Icon = higher ? ArrowUpRight : ArrowDownRight;
  return <span className={`inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${higher ? "text-destructive" : "text-success"}`}><Icon weight="bold" /> {formatBRL(Math.abs(deltaAmount))} {higher ? "acima" : "abaixo"} do período anterior</span>;
}

function ChartDetail({ active, payload, mode }: { active?: boolean; payload?: Array<{ payload: ChartRow }>; mode?: SeriesMode }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const difference = row.previousAmount == null ? null : row.currentAmount - row.previousAmount;
  return (
    <div className="rounded-lg border border-border bg-popover p-3 text-xs shadow-md">
      <p className="font-semibold text-foreground">Dia {row.day} · {shortDay(row.currentDate)}</p>
      <p className="mt-1 text-muted-foreground">{mode === "all" ? "Todos os gastos do dia" : "Ritmo típico do dia"}: <strong className="text-foreground">{formatBRL(row.currentAmount)}</strong></p>
      {mode === "typical" ? <p className="text-muted-foreground">Gasto total registrado: <strong className="text-foreground">{formatBRL(row.grossAmount)}</strong></p> : null}
      {row.previousDate && row.previousAmount != null ? <p className="mt-1 text-muted-foreground">Período anterior · {shortDay(row.previousDate)}: <strong className="text-foreground">{formatBRL(row.previousAmount)}</strong></p> : null}
      {difference != null ? <p className="text-muted-foreground">Diferença em {mode === "all" ? "todos os gastos" : "ritmo típico"}: <strong className="text-foreground">{difference > 0 ? "+" : ""}{formatBRL(difference)}</strong></p> : null}
      {row.exclusionLabel ? <p className="mt-1 text-muted-foreground">Fora do ritmo típico: {row.exclusionLabel}</p> : null}
      {row.refundAmount > 0 ? <p className="mt-1 text-muted-foreground">Reembolsos: {formatBRL(row.refundAmount)}</p> : null}
      <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">Série exibida: {mode === "all" ? "todos os gastos" : "ritmo típico"}</p>
    </div>
  );
}

export function RitmoUnificadoCard({ rhythm, projection, loading, partial, error, onRetry }: Props) {
  const [methodOpen, setMethodOpen] = useState(false);
  const [mode, setMode] = useState<SeriesMode>("typical");
  const current = rhythm?.current;
  const previous = rhythm?.previous;
  const typicalPace = projection?.typicalDailyPace ?? 0;

  // Motivos de exclusão por dia — alimentam marcação de dias atípicos e tooltip.
  const exclusionByDate = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const item of current?.excluded ?? []) {
      const set = map.get(item.date) ?? new Set<string>();
      set.add(item.reason);
      map.set(item.date, set);
    }
    return map;
  }, [current]);

  const data: ChartRow[] = (current?.series ?? []).map((point, index) => {
    const reasons = exclusionByDate.get(point.date);
    const labels = reasons ? [...reasons].map((r) => REASON_LABEL[r] ?? r) : [];
    const previousPoint = previous?.series[index] ?? null;
    return {
      day: index + 1,
      currentDate: point.date,
      previousDate: previousPoint?.date ?? null,
      currentAmount: mode === "all" ? point.netAmount : point.typicalAmount,
      previousAmount: previousPoint == null ? null : mode === "all" ? previousPoint.netAmount : previousPoint.typicalAmount,
      refundAmount: point.refundAmount,
      grossAmount: point.grossAmount,
      typicalAmount: point.typicalAmount,
      exclusionLabel: labels.length ? labels.join(", ") : null,
      atypical: Boolean(reasons?.has("outlier")),
    };
  });
  const hasData = data.length > 0 && ((current?.totalGross ?? 0) > 0 || (previous?.totalGross ?? 0) > 0);
  const hasPrevious = Boolean(previous && previous.totalGross > 0);
  const headlineAverage = mode === "all" ? current?.average ?? null : current?.typicalAverage ?? null;
  const previousAverage = mode === "all" ? previous?.average ?? null : previous?.typicalAverage ?? null;
  const summary = current && hasPrevious
    ? `No período atual, a média foi ${formatBRL(headlineAverage ?? 0)} por dia. No período anterior, foi ${formatBRL(previousAverage ?? 0)} por dia.`
    : current ? `No período atual, a média foi ${formatBRL(headlineAverage ?? 0)} por dia. Ainda não há base comparável.` : "Ainda não há dados suficientes para calcular o ritmo.";
  const averageDelta = headlineAverage != null && hasPrevious && previousAverage != null ? headlineAverage - previousAverage : null;
  const deltaPct = mode === "all" ? (hasPrevious ? rhythm?.averageDeltaPct ?? null : null) : (hasPrevious ? rhythm?.typicalDeltaPct ?? null : null);
  const trend = mode === "all" ? rhythm?.averageTrend ?? "stable" : rhythm?.typicalTrend ?? "stable";
  const atypicalDays = data.filter((row) => row.atypical);

  if (error) return <section aria-label="Ritmo de gastos" className="rounded-2xl border border-border bg-card p-4"><p className="text-xs font-bold text-primary">Ritmo de gastos</p><p className="mt-2 text-sm font-semibold text-foreground">Não foi possível atualizar seu ritmo</p><p className="mt-1 text-xs text-muted-foreground">Seu saldo e a orientação do Nino continuam disponíveis.</p>{onRetry ? <Button type="button" variant="ghost" onClick={onRetry} className="mt-2 min-h-11 px-2 text-primary">Tentar novamente</Button> : null}</section>;

  return (
    <section aria-label="Ritmo de gastos" className="overflow-hidden rounded-[18px] border border-border bg-card shadow-sm animate-fade-in">
      <div className="flex items-start justify-between gap-3 px-3.5 pt-3.5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-primary">Seu comportamento</p>
          <h2 className="mt-0.5 font-display text-[15px] font-bold leading-5 text-foreground">Seu ritmo de gastos</h2>
          <div className="mt-2 grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-2">
            <div>
              <p className="text-[10px] font-medium text-muted-foreground">{mode === "all" ? "Média com todos os gastos" : "Ritmo típico no período"}</p>
              {loading ? <div className="mt-1 h-6 w-28 animate-pulse rounded bg-secondary" /> : <p className="mt-0.5 font-display text-xl font-bold leading-6 tabular-nums text-foreground">{headlineAverage != null ? formatBRL(headlineAverage) : "—"}<span className="font-interface text-[10px] font-semibold text-muted-foreground">/dia</span></p>}
            </div>
            <div className="border-l border-border pl-2.5">
              <p className="text-[10px] font-medium text-muted-foreground">Referência histórica</p>
              <p className="mt-0.5 text-[13px] font-bold tabular-nums text-foreground">{typicalPace > 0 ? `${formatBRL(typicalPace)}/dia` : "Aprendendo"}</p>
              <p className="text-[9px] leading-3 text-muted-foreground">janela de longo prazo</p>
            </div>
          </div>
          <div className="mt-1.5"><Comparison trend={trend} deltaPct={deltaPct} deltaAmount={averageDelta} /></div>
          {atypicalDays.length > 0 ? <p className="mt-1 text-[10px] text-muted-foreground">{atypicalDays.length} dia{atypicalDays.length > 1 ? "s" : ""} atípico{atypicalDays.length > 1 ? "s" : ""} separado{atypicalDays.length > 1 ? "s" : ""} do ritmo típico.</p> : null}
          {partial ? <p className="mt-1.5 text-[11px] text-muted-foreground">Comparação parcial enquanto atualizamos algumas fontes.</p> : null}
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={() => setMethodOpen(true)} aria-label="Como calculamos o ritmo" className="h-10 w-10 shrink-0 rounded-full text-muted-foreground"><Info size={17} /></Button>
      </div>

      <div className="mt-2 flex gap-1 px-3.5" role="group" aria-label="Série exibida">
        {([{ id: "typical", label: "Ritmo típico" }, { id: "all", label: "Todos os gastos" }] as const).map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={mode === option.id}
            onClick={() => setMode(option.id)}
            className={`min-h-7 rounded-full px-3 text-[10px] font-semibold transition-colors ${mode === option.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary"}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <p className="sr-only">{summary}</p>
      <div className={hasData || loading ? "mt-1.5 min-h-[112px] border-t border-border px-1 pt-1" : "mt-2"}>
        {loading ? <div className="mx-4 h-[104px] animate-pulse rounded-xl bg-secondary" /> : !hasData ? (
          <div className="grid min-h-[96px] place-items-center px-5 pb-3 text-center"><div><p className="text-[13px] text-muted-foreground">Ainda não há gastos neste período.</p><Button asChild variant="ghost" className="mt-1 min-h-10 text-primary"><Link to="/app/lancamentos">Anotar movimentação</Link></Button></div></div>
        ) : (
          <ResponsiveContainer width="100%" height={108}>
            <ComposedChart data={data} margin={{ top: 8, right: 10, left: -22, bottom: 0 }}>
              <defs><linearGradient id="rhythmFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.06} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="hsl(var(--border))" vertical={false} horizontalValues={[0]} />
              <XAxis dataKey="day" tickFormatter={(value) => `D${value}`} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis hide domain={[0, "auto"]} />
              <ChartTooltip content={<ChartDetail mode={mode} />} cursor={{ stroke: "hsl(var(--border))" }} />
              <Area type="monotone" dataKey="currentAmount" stroke="none" fill="url(#rhythmFill)" />
              <Line type="monotone" dataKey="currentAmount" stroke="hsl(var(--primary))" strokeWidth={2.25} dot={false} activeDot={{ r: 4, strokeWidth: 4 }} />
              <Line type="monotone" dataKey="previousAmount" stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="6 4" dot={false} activeDot={{ r: 4 }} connectNulls />
              {atypicalDays.map((row) => (
                <ReferenceDot key={row.currentDate} x={row.day} y={row.currentAmount} r={3.5} fill="hsl(var(--destructive))" stroke="hsl(var(--card))" strokeWidth={1.5} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      {hasData ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 bg-primary" />Este período</span><span className="inline-flex items-center gap-1.5"><i className="h-0 w-4 border-t border-dashed border-muted-foreground" />Anterior</span>{atypicalDays.length > 0 ? <span className="inline-flex items-center gap-1.5"><i className="h-1.5 w-1.5 rounded-full bg-destructive" />Atípico</span> : null}</div> : null}
      {hasData ? <div className="px-3.5 pb-1.5"><Button asChild variant="ghost" size="sm" className="min-h-8 w-full justify-start px-0 text-[12px] text-primary"><Link to="/app/lancamentos">Ver rotina e categorias</Link></Button></div> : null}
      <RhythmMethodSheet open={methodOpen} onOpenChange={setMethodOpen} />
    </section>
  );
}
