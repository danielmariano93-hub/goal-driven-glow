import { useMemo, useState } from "react";
import { useLedgerWindow } from "@/lib/db/finance";
import { isRealMonthlyMovement } from "@/lib/engine/facts";
import { buildEvolution, emojiForMood, highSpendDays, MIN_POINTS_FOR_EVOLUTION, saoPauloDay, smoothPath } from "@/lib/emotions/history";
import { useEmotionHistory } from "@/lib/emotions/useEmotionHistory";

const W = 320;
const H = 150;
const PAD = { l: 26, r: 8, t: 14, b: 22 };

/** Evolução do humor que a pessoa marcou. Degradê neutro (lilás): humor baixo não é "errado". */
export function EmotionEvolution() {
  const [windowDays, setWindowDays] = useState<30 | 90>(30);
  const { data } = useEmotionHistory(90);
  const { data: txs } = useLedgerWindow({ monthsBack: 3, monthsAhead: 0 });
  const today = saoPauloDay(new Date());
  const points = useMemo(() => buildEvolution(data ?? [], today, windowDays), [data, today, windowDays]);

  const spendMarks = useMemo(() => {
    const perDay = new Map<string, number>();
    for (const t of (txs ?? []) as Array<Record<string, any>>) {
      if (t.type !== "expense" || !isRealMonthlyMovement(t as never)) continue;
      const day = String(t.occurred_at).slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + Number(t.amount));
    }
    return highSpendDays(perDay);
  }, [txs]);

  const enough = points.length >= MIN_POINTS_FOR_EVOLUTION;
  const x = (i: number) => PAD.l + (points.length <= 1 ? 0 : (i / (points.length - 1)) * (W - PAD.l - PAD.r));
  const y = (mood: number) => PAD.t + (1 - (mood - 1) / 4) * (H - PAD.t - PAD.b);
  const path = smoothPath(points.map((p, i) => [x(i), y(p.mood)] as [number, number]));
  const markIdx = points.map((p, i) => (windowDays <= 45 && spendMarks.has(p.date) ? i : -1)).filter((i) => i >= 0);

  return (
    <section className="rounded-[26px] border border-border bg-card p-4 shadow-card sm:p-5" aria-label="Evolução do humor" data-testid="emotion-evolution">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">Humor com o dinheiro</p>
          <h2 className="mt-1 font-display text-xl font-bold tracking-tight">Como você tem se sentido</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">O que você marcou nos check-ins, ao longo do tempo. É a sua percepção, não uma nota.</p>
        </div>
        <div className="flex w-fit shrink-0 gap-1 rounded-full bg-secondary/70 p-1" role="group" aria-label="Período">
          {([30, 90] as const).map((d) => (
            <button key={d} type="button" onClick={() => setWindowDays(d)} aria-pressed={windowDays === d}
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${windowDays === d ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}>{d} dias</button>
          ))}
        </div>
      </div>

      {!enough ? (
        <p className="mt-4 rounded-2xl bg-secondary/40 px-3 py-6 text-center text-xs text-muted-foreground">
          {points.length === 0 ? "Registre como você está para ver sua evolução aqui." : `Com mais ${MIN_POINTS_FOR_EVOLUTION - points.length} ${MIN_POINTS_FOR_EVOLUTION - points.length === 1 ? "registro" : "registros"} a linha do tempo aparece.`}
        </p>
      ) : (
        <div className="mt-3">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Linha do humor registrado">
            <defs>
              <linearGradient id="mood-bg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.16" />
                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.02" />
              </linearGradient>
              <linearGradient id="mood-line" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.55" />
                <stop offset="100%" stopColor="hsl(var(--primary))" />
              </linearGradient>
            </defs>
            <rect x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} rx="14" fill="url(#mood-bg)" />
            {[1, 3, 5].map((m) => <line key={m} x1={PAD.l} x2={W - PAD.r} y1={y(m)} y2={y(m)} stroke="hsl(var(--border))" strokeDasharray="3 4" />)}
            <path d={`${path} L${x(points.length - 1).toFixed(1)},${H - PAD.b} L${x(0).toFixed(1)},${H - PAD.b} Z`} fill="hsl(var(--primary))" opacity="0.10" />
            <path d={path} fill="none" stroke="url(#mood-line)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            {points.map((p, i) => <circle key={p.date} cx={x(i)} cy={y(p.mood)} r={i === points.length - 1 ? 4.5 : 3} fill="hsl(var(--card))" stroke="hsl(var(--primary))" strokeWidth="2" />)}
            {markIdx.map((i) => <circle key={`s${i}`} cx={x(i)} cy={H - PAD.b + 10} r="2.6" fill="hsl(var(--muted-foreground))" opacity="0.7" />)}
            <text x={PAD.l - 4} y={y(5) + 5} fontSize="14" textAnchor="end">{emojiForMood(5)}</text>
            <text x={PAD.l - 4} y={y(1) + 5} fontSize="14" textAnchor="end">{emojiForMood(1)}</text>
            <text x={x(0)} y={H - 4} fontSize="9" fill="hsl(var(--muted-foreground))" textAnchor="start">{points[0].label}</text>
            <text x={x(points.length - 1)} y={H - 4} fontSize="9" fill="hsl(var(--muted-foreground))" textAnchor="end">{points[points.length - 1].label}</text>
          </svg>
          <p className="mt-1 text-center text-[10px] text-muted-foreground">mais leve ↑ · mais pesado ↓</p>
          {markIdx.length > 0 ? (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"><i className="h-2 w-2 rounded-full bg-muted-foreground/70" aria-hidden /> Pontos cinza marcam dias com gasto bem acima do usual. É só um lado a lado, não uma conclusão.</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
