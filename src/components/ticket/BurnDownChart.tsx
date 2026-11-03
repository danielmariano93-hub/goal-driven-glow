import type { BenefitState } from "@/lib/engine/benefitWallet";

type Point = { date: string; balance: number | null };

/** Saldo do ciclo: curva real, projeção no ritmo atual e linha ideal até o próximo crédito. */
export function BurnDownChart({ series, state, opening }: { series: Point[]; state: BenefitState; opening: number }) {
  const total = Math.max(1, state.cycle.total_days);
  const elapsed = state.cycle.elapsed_days;
  const known = series.filter((p) => p.balance !== null) as Array<{ date: string; balance: number }>;
  const yMax = Math.max(opening, ...known.map((p) => p.balance), 1);
  const X = (d: number) => 10 + (d / total) * 310;
  const Y = (b: number) => 10 + (1 - b / yMax) * 130;
  const real = series
    .map((p, i) => (p.balance === null ? null : `${X(i).toFixed(1)},${Y(p.balance).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  const balance = state.balance ?? 0;
  const proj = state.projection;
  let projPath = "";
  let zoneStart: number | null = null;
  if (proj && state.rate.per_day > 0) {
    const covers = proj.covers_days ?? 0;
    const endDay = Math.min(total, elapsed + covers);
    const endBal = Math.max(0, balance - state.rate.per_day * (endDay - elapsed));
    projPath = `M${X(elapsed).toFixed(1)} ${Y(balance).toFixed(1)} L${X(endDay).toFixed(1)} ${Y(endBal).toFixed(1)}`;
    if (endDay < total) {
      projPath += ` L${X(total).toFixed(1)} ${Y(0).toFixed(1)}`;
      zoneStart = X(endDay);
    }
  }
  const projColor = proj?.status === "short" ? "hsl(var(--destructive))" : proj?.status === "tight" ? "hsl(var(--warning))" : "hsl(var(--success))";
  const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return (
    <svg viewBox="0 0 330 170" role="img" aria-label="Saldo do Ticket ao longo do ciclo: real, projeção e ideal" className="block h-auto w-full">
      {zoneStart !== null && <rect x={zoneStart} y={10} width={320 - zoneStart} height={130} fill="hsl(var(--destructive) / 0.12)" />}
      <line x1={10} y1={140} x2={320} y2={140} stroke="hsl(var(--border))" />
      <line x1={X(0)} y1={Y(opening)} x2={X(total)} y2={Y(0)} stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 4" />
      {real && <polyline points={real} fill="none" stroke="hsl(var(--primary))" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />}
      {projPath && <path d={projPath} fill="none" stroke={projColor} strokeWidth={3} strokeDasharray="6 5" strokeLinecap="round" />}
      <line x1={X(elapsed)} y1={10} x2={X(elapsed)} y2={140} stroke="hsl(var(--foreground))" strokeWidth={1} strokeDasharray="2 3" />
      <circle cx={X(elapsed)} cy={Y(balance)} r={5} fill="hsl(var(--primary))" stroke="hsl(var(--card))" strokeWidth={2} />
      <text x={Math.min(X(elapsed) + 4, 250)} y={24} fontSize={11} fontWeight={600} fill="hsl(var(--foreground))">hoje {dm(state.today)}</text>
      <text x={10} y={158} fontSize={11} fill="hsl(var(--muted-foreground))">{dm(state.cycle.start)}</text>
      <text x={320} y={158} fontSize={11} fill="hsl(var(--muted-foreground))" textAnchor="end">{dm(state.cycle.next)} · crédito</text>
    </svg>
  );
}
