import { useMemo, useState } from "react";
import type { CategoryGoalEvaluation } from "@/lib/engine/metrics";
import { formatBRL, type TransactionRow } from "@/lib/engine/facts";
import { goalPaceIsStepped, goalPaceModel, type GoalPaceModel, type PaceScenario } from "@/lib/engine/goalPaceChart";

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const W = 330;
const H = 176;
const PAD = { l: 8, r: 8, t: 14, b: 24 };

function Chart({ m }: { m: GoalPaceModel }) {
  const yMax = Math.max(m.target, m.actual, m.projected, m.range?.high ?? 0) * 1.1 || 1;
  const X = (d: number) => PAD.l + (d / m.totalDays) * (W - PAD.l - PAD.r);
  const Y = (v: number) => PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b);
  const p = (d: number, v: number) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`;
  const actual = m.cumulative.map((c) => p(c.day, c.value)).join(" ");
  const e = m.elapsedDays;
  const canProject = m.remainingDays > 0;
  const over = m.projected > m.target;
  const projColor = over ? "hsl(var(--destructive))" : "hsl(var(--warning))";
  const ideal0 = { x: X(0), y: Y(0) };
  const ideal1 = { x: X(m.totalDays), y: Y(m.target) };
  const angle = (Math.atan2(ideal1.y - ideal0.y, ideal1.x - ideal0.x) * 180) / Math.PI;
  const lx = X(m.totalDays * 0.16);
  const ly = Y(m.idealAt(m.totalDays * 0.16)) - 6;
  // "fecha em …" fica logo abaixo da área da projeção, sem cair em cima dela: usa o ponto mais baixo da borda inferior sob o texto.
  const endLowY = Y(m.range?.low ?? m.projected);
  const labelW = 112;
  const xLeft = X(m.totalDays) - labelW;
  const t = X(m.totalDays) === X(e) ? 1 : Math.min(1, Math.max(0, (xLeft - X(e)) / (X(m.totalDays) - X(e))));
  const edgeLeftY = Y(m.actual) + (endLowY - Y(m.actual)) * t;
  const endLabelY = Math.min(Y(0) - 4, Math.max(endLowY, edgeLeftY) + 15);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Gasto acumulado da meta ao longo do período: como você está, como deveria estar e projeção até ${dm(m.periodEnd)}`} className="mt-2 block h-auto w-full">
      <line x1={PAD.l} y1={Y(0)} x2={W - PAD.r} y2={Y(0)} stroke="hsl(var(--border))" />
      <line x1={PAD.l} y1={Y(m.target)} x2={W - PAD.r} y2={Y(m.target)} stroke="hsl(var(--destructive))" strokeWidth={1} strokeDasharray="2 3" opacity={0.7} />
      <text x={PAD.l + 2} y={Y(m.target) - 4} fontSize={10.5} fill="hsl(var(--destructive))">teto {formatBRL(m.target)}</text>
      {canProject && m.range ? (
        <polygon points={`${p(e, m.actual)} ${p(m.totalDays, m.range.high)} ${p(m.totalDays, m.range.low)}`} fill="hsl(var(--warning))" opacity={0.14} />
      ) : null}
      <line x1={ideal0.x} y1={ideal0.y} x2={ideal1.x} y2={ideal1.y} stroke="hsl(var(--muted-foreground))" strokeWidth={1.5} strokeDasharray="4 4" />
      <text x={lx} y={ly} fontSize={10} fill="hsl(var(--muted-foreground))" transform={`rotate(${angle.toFixed(1)} ${lx.toFixed(1)} ${ly.toFixed(1)})`}>como deveria estar</text>
      {canProject ? <polyline points={`${p(e, m.actual)} ${p(m.totalDays, m.projected)}`} fill="none" stroke={projColor} strokeWidth={2.2} strokeDasharray="5 4" strokeLinecap="round" /> : null}
      <polyline points={actual} fill="none" stroke="hsl(var(--primary))" strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
      <line x1={X(e)} y1={PAD.t} x2={X(e)} y2={Y(0)} stroke="hsl(var(--foreground))" strokeWidth={1} strokeDasharray="2 3" />
      <text x={Math.min(X(e) + 5, W - 70)} y={PAD.t + 8} fontSize={10.5} fontWeight={600} fill="hsl(var(--foreground))">hoje {dm(m.todayIso)}</text>
      <circle cx={X(e)} cy={Y(m.actual)} r={4.5} fill="hsl(var(--primary))" stroke="hsl(var(--card))" strokeWidth={2} />
      {canProject ? (
        <>
          <circle cx={X(m.totalDays)} cy={Y(m.projected)} r={3.5} fill={projColor} />
          <text x={X(m.totalDays) - 2} y={endLabelY} fontSize={10.5} fontWeight={600} textAnchor="end" fill={projColor}>fecha em {formatBRL(m.projected)}</text>
        </>
      ) : null}
      <text x={PAD.l} y={H - 6} fontSize={10.5} fill="hsl(var(--muted-foreground))">{dm(m.periodStart)}</text>
      <text x={W - PAD.r} y={H - 6} fontSize={10.5} fill="hsl(var(--muted-foreground))" textAnchor="end">{dm(m.periodEnd)}</text>
    </svg>
  );
}

function resultText(s: PaceScenario, remainingDays: number): string {
  const by = `Gastando ${formatBRL(s.rate)} por dia`;
  if (s.diff > 0.005) return `${by}, a meta fecha em ${formatBRL(s.final)}, com ${formatBRL(s.diff)} de folga.`;
  if (s.diff < -0.005) return `${by}, a meta fecha em ${formatBRL(s.final)}, ${formatBRL(-s.diff)} acima do teto.`;
  return `${by} nos ${remainingDays} ${remainingDays === 1 ? "dia" : "dias"} que restam, a meta fecha exatamente no teto.`;
}

/** "Como a meta fecha": como você está x como deveria estar, três números e o "e se eu gastar por dia…". */
export function GoalPaceChart({ evaluation, txs, today }: { evaluation: CategoryGoalEvaluation; txs: TransactionRow[]; today?: Date }) {
  const model = useMemo(() => goalPaceModel(evaluation, txs, today ?? new Date()), [evaluation, txs, today]);
  const [picked, setPicked] = useState<number | null>(null);
  if (!model) {
    return goalPaceIsStepped(evaluation) ? (
      <section aria-label="Como a meta fecha" className="border-t border-border pt-3">
        <h3 className="text-[14px] font-bold leading-5">Como a meta fecha</h3>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">Nesta categoria o gasto cai em datas fixas, então não mostro a linha reta de “como deveria estar”. Valem os pagamentos já feitos e os que ainda vencem.</p>
      </section>
    ) : null;
  }
  const idx = picked != null && picked < model.scenarios.length ? picked : model.defaultScenario;
  const chosen = model.scenarios[idx];
  const slack = model.tiles.slack;
  const tiles = [
    { label: "Ritmo", value: formatBRL(model.tiles.pace), unit: "por dia" },
    ...(model.tiles.allowance != null ? [{ label: "Limite", value: formatBRL(model.tiles.allowance), unit: "por dia" }] : []),
    slack >= 0 ? { label: "Folga", value: formatBRL(slack), unit: "no fim" } : { label: "Acima do teto", value: formatBRL(-slack), unit: "no fim" },
  ];
  return (
    <section aria-label="Como a meta fecha" className="border-t border-border pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[14px] font-bold leading-5">Como a meta fecha</h3>
        <span className="text-[12px] text-muted-foreground">{dm(model.periodStart)} a {dm(model.periodEnd)}</span>
      </div>
      <Chart m={model} />
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" aria-hidden="true">
        <span className="inline-flex items-center gap-1.5"><i className="block h-0.5 w-3.5 rounded bg-primary" />como você está</span>
        <span className="inline-flex items-center gap-1.5"><i className="block w-3.5 border-t-2 border-dashed border-muted-foreground" />como deveria estar</span>
        {model.remainingDays > 0 ? <span className="inline-flex items-center gap-1.5"><i className="block w-3.5 border-t-2 border-dashed border-warning" />projeção</span> : null}
      </div>
      <div className={`mt-3 grid gap-2 ${tiles.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
        {tiles.map((t) => (
          <div key={t.label} className="rounded-[14px] border border-border px-2.5 py-2">
            <p className="text-[11px] text-muted-foreground">{t.label}</p>
            <p className="mt-0.5 text-[15px] font-bold leading-5 tabular-nums">{t.value}</p>
            <p className="text-[11px] text-muted-foreground">{t.unit}</p>
          </div>
        ))}
      </div>
      {model.scenarios.length > 0 && chosen ? (
        <div className="mt-3">
          <p className="text-[14px] font-bold leading-5">E se eu gastar por dia…</p>
          <div className="mt-2 flex gap-2">
            {model.scenarios.map((s, i) => (
              <button key={s.kind} type="button" aria-pressed={i === idx} onClick={() => setPicked(i)}
                className={`min-h-11 flex-1 rounded-[14px] border-2 text-[14px] font-semibold tabular-nums transition-colors ${i === idx ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>
                {formatBRL(s.rate)}
              </button>
            ))}
          </div>
          <p data-testid="goal-pace-result" className="mt-2 text-[13px] leading-[19px] text-muted-foreground" aria-live="polite">{resultText(chosen, model.remainingDays)}</p>
        </div>
      ) : null}
    </section>
  );
}
