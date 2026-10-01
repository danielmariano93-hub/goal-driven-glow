import { useState } from "react";
import { AlertTriangle, Check, CircleDashed, Minus, Pause, X } from "lucide-react";
import { formatBRL } from "@/lib/engine/facts";
import { historyMonthName, type GoalHighlight, type GoalHistory, type GoalImpact, type GoalSeries, type HistoryMonth, type HistoryMonthStatus } from "@/lib/engine/goalHistory";

// Visual das metas ao longo do tempo (`goal_history.v1`). Status nunca é só cor:
// cada estado tem ícone + rótulo, e todo gráfico tem a tabela equivalente.

const monthShort = (ym: string) => historyMonthName(ym).slice(0, 3);

const STATUS_META: Record<HistoryMonthStatus, { label: string; cell: string; text: string; bar: string; Icon: typeof Check }> = {
  met: { label: "Cumpriu", cell: "bg-emerald-500/15 text-emerald-700", text: "text-emerald-700", bar: "fill-emerald-500", Icon: Check },
  missed: { label: "Estourou", cell: "bg-red-500/15 text-red-700", text: "text-red-700", bar: "fill-red-500", Icon: X },
  in_progress: { label: "Em andamento", cell: "bg-primary/15 text-primary", text: "text-primary", bar: "fill-primary", Icon: CircleDashed },
  paused: { label: "Pausada", cell: "bg-slate-500/10 text-slate-600", text: "text-slate-600", bar: "fill-slate-400", Icon: Pause },
  before: { label: "Antes da meta", cell: "bg-secondary text-muted-foreground", text: "text-muted-foreground", bar: "fill-slate-300", Icon: Minus },
  no_goal: { label: "Sem meta", cell: "bg-transparent text-muted-foreground/60", text: "text-muted-foreground", bar: "fill-slate-300", Icon: Minus },
};

const TONE: Record<GoalHighlight["tone"], { box: string; Icon: typeof Check }> = {
  positive: { box: "border-emerald-500/30 bg-emerald-500/5", Icon: Check },
  negative: { box: "border-red-500/30 bg-red-500/5", Icon: AlertTriangle },
  neutral: { box: "border-border bg-card", Icon: CircleDashed },
};

/** Carrossel de highlights: o que mudou, o que se sustenta e o que preocupa. */
export function GoalHighlights({ highlights, onOpen }: { highlights: GoalHighlight[]; onOpen?: (categoryId: string) => void }) {
  if (!highlights.length) return null;
  return (
    <section aria-label="Destaques das metas" className="mb-4">
      <p className="mb-2 text-sm font-semibold">Destaques</p>
      <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
        {highlights.map((h) => {
          const tone = TONE[h.tone];
          const clickable = Boolean(h.category_id && onOpen);
          return (
            <li key={h.id} className="snap-start">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => h.category_id && onOpen?.(h.category_id)}
                className={`flex h-full w-[240px] flex-col rounded-2xl border p-3 text-left ${tone.box} ${clickable ? "" : "cursor-default"}`}
              >
                <span className="flex items-start gap-1.5 text-[13px] font-semibold leading-snug">
                  <tone.Icon size={14} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
                  {h.title}
                </span>
                <span className="mt-1 text-[12px] leading-snug text-muted-foreground">{h.body}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Placar categorias × meses: em um olhar, onde cumpriu e onde estourou. */
export function GoalScoreboard({ history, onOpen }: { history: GoalHistory; onOpen?: (series: GoalSeries) => void }) {
  if (!history.series.length) return null;
  const legend: HistoryMonthStatus[] = ["met", "missed", "in_progress", "before", "no_goal"];
  return (
    <section aria-label="Placar das metas" className="mb-4 rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-semibold">Placar mês a mês</p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[320px] border-separate border-spacing-y-1 text-[12px]">
          <thead>
            <tr>
              <th className="pb-1 text-left font-medium text-muted-foreground">Categoria</th>
              {history.scoreboard.months.map((m) => (
                <th key={m} scope="col" className={`pb-1 text-center font-medium ${m === history.current_month ? "text-foreground" : "text-muted-foreground"}`}>
                  {monthShort(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.scoreboard.rows.map((row) => {
              const series = history.series.find((s) => s.category_id === row.category_id)!;
              return (
                <tr key={row.category_id}>
                  <th scope="row" className="max-w-[110px] truncate pr-2 text-left font-semibold">
                    <button type="button" onClick={() => onOpen?.(series)} className="truncate text-left hover:underline">{row.category_name}</button>
                  </th>
                  {row.cells.map((cell) => {
                    const meta = STATUS_META[cell.status];
                    const month = series.months.find((m) => m.month === cell.month);
                    const title = month && cell.status !== "no_goal"
                      ? `${historyMonthName(cell.month)}: ${meta.label} · ${formatBRL(month.actual)}${month.limit != null ? ` de ${formatBRL(month.limit)}` : ""}`
                      : `${historyMonthName(cell.month)}: ${meta.label}`;
                    return (
                      <td key={cell.month} className="text-center">
                        <span title={title} aria-label={title} className={`mx-auto grid h-7 w-7 place-items-center rounded-lg ${meta.cell}`}>
                          {cell.status === "no_goal" ? <span className="text-[10px]">·</span> : <meta.Icon size={13} aria-hidden />}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {legend.map((s) => {
          const meta = STATUS_META[s];
          return (
            <li key={s} className="inline-flex items-center gap-1">
              <span className={`grid h-4 w-4 place-items-center rounded ${meta.cell}`}>{s === "no_goal" ? "·" : <meta.Icon size={10} aria-hidden />}</span>
              {meta.label}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Gráfico mês a mês: gasto (barras), limite de cada mês (traço) e referência de antes (tracejado). */
function HistoryChart({ series }: { series: GoalSeries }) {
  const [active, setActive] = useState<HistoryMonth | null>(null);
  const months = series.months;
  const W = 340;
  const H = 170;
  const pad = { top: 12, bottom: 22, left: 4, right: 4 };
  const max = Math.max(
    1,
    ...months.map((m) => Math.max(m.actual, m.projected ?? 0, m.limit ?? 0)),
    series.baseline ?? 0,
  ) * 1.1;
  const band = (W - pad.left - pad.right) / months.length;
  const barW = Math.min(28, band - 6);
  const y = (v: number) => pad.top + (H - pad.top - pad.bottom) * (1 - v / max);
  const base = y(0);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Gasto mês a mês em ${series.category_name}`}>
        <line x1={pad.left} x2={W - pad.right} y1={base} y2={base} className="stroke-border" strokeWidth={1} />
        {series.baseline ? (
          <g>
            <line x1={pad.left} x2={W - pad.right} y1={y(series.baseline)} y2={y(series.baseline)} className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="4 4" />
          </g>
        ) : null}
        {months.map((m, i) => {
          const cx = pad.left + band * i + band / 2;
          const meta = STATUS_META[m.status];
          const top = y(m.actual);
          const h = Math.max(0, base - top);
          const projectedTop = m.projected != null && m.projected > m.actual ? y(m.projected) : null;
          return (
            <g key={m.month} onClick={() => setActive(active?.month === m.month ? null : m)} onMouseEnter={() => setActive(m)} className="cursor-pointer">
              {/* alvo de toque maior que a barra */}
              <rect x={cx - band / 2} y={pad.top} width={band} height={H - pad.top - pad.bottom} fill="transparent" />
              {projectedTop != null ? (
                <rect x={cx - barW / 2} y={projectedTop} width={barW} height={Math.max(0, top - projectedTop)} rx={4} className="fill-primary/20" />
              ) : null}
              {h > 0 ? <path d={`M${cx - barW / 2},${base} V${top + 4} q0,-4 4,-4 H${cx + barW / 2 - 4} q4,0 4,4 V${base} Z`} className={meta.bar} /> : null}
              {m.limit != null ? (
                <line x1={cx - barW / 2 - 4} x2={cx + barW / 2 + 4} y1={y(m.limit)} y2={y(m.limit)} className="stroke-foreground" strokeWidth={2} strokeLinecap="round" />
              ) : null}
              <text x={cx} y={H - 6} textAnchor="middle" className={`text-[10px] ${m.month === active?.month ? "fill-foreground font-semibold" : "fill-muted-foreground"}`}>{monthShort(m.month)}</text>
            </g>
          );
        })}
      </svg>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <li className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Cumpriu</li>
        <li className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Estourou</li>
        <li className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-300" /> Antes da meta</li>
        <li className="inline-flex items-center gap-1"><span className="h-0.5 w-3 rounded bg-foreground" /> Limite do mês</li>
        {series.baseline ? <li className="inline-flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-muted-foreground" /> Referência ({formatBRL(series.baseline)})</li> : null}
      </ul>
      {active ? (
        <p className="mt-2 rounded-lg bg-secondary/60 px-2.5 py-1.5 text-[12px]" aria-live="polite">
          <strong>{historyMonthName(active.month)}:</strong> {formatBRL(active.actual)}
          {active.limit != null ? ` de ${formatBRL(active.limit)}` : ""}
          {active.projected != null && active.projected > active.actual ? ` · projeção ${formatBRL(active.projected)}` : ""}
          {` · ${STATUS_META[active.status].label}`}
          {active.main_driver ? ` · maior peso: ${active.main_driver.label}` : ""}
        </p>
      ) : null}
    </div>
  );
}

/** Painel do detalhe: KPIs, gráfico e tabela mês a mês desde o início da meta. */
export function GoalHistoryPanel({ series }: { series: GoalSeries }) {
  const k = series.kpis;
  const change = k.change_vs_baseline;
  const rows = [...series.months].reverse();
  return (
    <section aria-label="Evolução da meta" className="mt-5 rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-semibold">Evolução desde {historyMonthName(series.first_month)}</p>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[12px] sm:grid-cols-4">
        <div>
          <p className="text-muted-foreground">Meses cumpridos</p>
          <p className="text-[15px] font-bold tabular-nums">{k.closed_months ? `${k.met_months} de ${k.closed_months}` : "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Sequência</p>
          <p className="text-[15px] font-bold tabular-nums">{k.streak ? `${k.streak} ${k.streak === 1 ? "mês" : "meses"}` : "—"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Desde o início</p>
          <p className={`text-[15px] font-bold tabular-nums ${change == null ? "" : change < -0.05 ? "text-emerald-700" : change > 0.05 ? "text-red-700" : ""}`}>
            {change == null ? "—" : `${change < 0 ? "−" : "+"}${Math.round(Math.abs(change) * 100)}%`}
          </p>
          <p className="text-[11px] text-muted-foreground">{change == null ? "sem referência ainda" : change < -0.05 ? "gasto caiu" : change > 0.05 ? "gasto subiu" : "estável"}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Economia acumulada</p>
          <p className={`text-[15px] font-bold tabular-nums ${k.savings_total == null ? "" : k.savings_total >= 0 ? "text-emerald-700" : "text-red-700"}`}>
            {k.savings_total == null ? "—" : `${k.savings_total < 0 ? "−" : ""}${formatBRL(Math.abs(k.savings_total))}`}
          </p>
          <p className="text-[11px] text-muted-foreground">frente à referência</p>
        </div>
      </div>

      <div className="mt-4"><HistoryChart series={series} /></div>

      <ul className="mt-4 divide-y divide-border text-[12px]" aria-label="Mês a mês">
        {rows.map((m) => {
          const meta = STATUS_META[m.status];
          return (
            <li key={m.month} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold capitalize">{historyMonthName(m.month)}</span>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.cell}`}>
                  <meta.Icon size={11} aria-hidden /> {meta.label}
                </span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2 text-muted-foreground">
                <span className="tabular-nums">
                  {formatBRL(m.actual)}{m.limit != null ? ` de ${formatBRL(m.limit)}` : " gastos"}
                  {m.projected != null && m.projected > m.actual ? ` · projeção ${formatBRL(m.projected)}` : ""}
                </span>
                {m.status === "in_progress" && m.limit != null && m.projected != null && m.projected > m.limit ? (
                  <span className="shrink-0 font-medium tabular-nums text-red-700">projeção {formatBRL(m.projected - m.limit)} acima</span>
                ) : m.difference != null ? (
                  <span className={`shrink-0 font-medium tabular-nums ${m.difference >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {m.difference >= 0 ? `${m.status === "in_progress" ? "restam" : "sobraram"} ${formatBRL(m.difference)}` : `${formatBRL(-m.difference)} acima`}
                  </span>
                ) : null}
              </div>
              {m.main_driver && m.status !== "before" && m.status !== "no_goal" ? (
                <p className="text-[11px] text-muted-foreground">maior peso: {m.main_driver.label} ({formatBRL(m.main_driver.amount)})</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** O que as metas já fizeram: economia estimada (contrafactual) e clareza. */
export function GoalImpactCard({ impact }: { impact: GoalImpact }) {
  const positive = impact.estimated_savings > 0;
  const pctText = (v: number) => `${Math.round(Math.abs(v) * 100)}%`;
  return (
    <section aria-label="Impacto das metas" className="mb-4 rounded-2xl border border-border bg-card p-4">
      <p className="text-sm font-semibold">O que as metas já fizeram por você</p>
      {impact.closed_goal_months ? (
        <>
          <p className={`mt-2 font-display text-2xl font-bold tabular-nums ${positive ? "text-emerald-700" : "text-red-700"}`}>
            {positive ? "" : "+"}{formatBRL(Math.abs(impact.estimated_savings))}
          </p>
          <p className="text-[12px] text-muted-foreground">
            {positive ? "de gasto evitado (estimativa)" : "acima do que você gastaria sem meta (estimativa)"}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
            <div className="rounded-xl bg-secondary/60 p-2.5">
              <p className="text-muted-foreground">Sem meta, provavelmente</p>
              <p className="font-semibold tabular-nums">{formatBRL(impact.expected_without_goals)}</p>
            </div>
            <div className="rounded-xl bg-secondary/60 p-2.5">
              <p className="text-muted-foreground">Com meta, de fato</p>
              <p className="font-semibold tabular-nums">{formatBRL(impact.actual_with_goals)}</p>
            </div>
          </div>
          {impact.net_effect != null && impact.control_change != null ? (
            <p className="mt-2 text-[12px]">
              Categorias com meta: <strong>{impact.goal_change != null ? `${impact.goal_change < 0 ? "−" : "+"}${pctText(impact.goal_change)}` : "—"}</strong> ·
              sem meta: <strong>{impact.control_change < 0 ? "−" : "+"}{pctText(impact.control_change)}</strong> frente a antes.
            </p>
          ) : null}
          {impact.by_category.length > 1 ? (
            <ul className="mt-2 space-y-0.5 text-[12px]">
              {impact.by_category.map((c) => (
                <li key={c.category_id} className="flex justify-between gap-2">
                  <span className="truncate text-muted-foreground">{c.category_name}</span>
                  <span className={`shrink-0 font-medium tabular-nums ${c.savings >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                    {c.savings >= 0 ? `−${formatBRL(c.savings)}` : `+${formatBRL(-c.savings)}`}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="mt-1 text-[12px] text-muted-foreground">{impact.explanation}</p>
      )}

      <ul className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center text-[11px] text-muted-foreground">
        <li>
          <span className="block text-[15px] font-bold tabular-nums text-foreground">{impact.months_met}/{impact.closed_goal_months}</span>
          metas cumpridas
        </li>
        <li>
          <span className="block text-[15px] font-bold tabular-nums text-foreground">{impact.coverage_share != null ? `${Math.round(impact.coverage_share * 100)}%` : "—"}</span>
          do gasto sob meta
        </li>
        <li>
          <span className="block text-[15px] font-bold tabular-nums text-foreground">{impact.alerts_delivered}</span>
          avisos antecipados
        </li>
      </ul>
      {impact.closed_goal_months ? (
        <details className="mt-2 text-[11px] text-muted-foreground">
          <summary className="cursor-pointer">Como calculamos</summary>
          <p className="mt-1">{impact.explanation} A referência de cada categoria é a média dos 3 meses antes da primeira meta.</p>
        </details>
      ) : null}
    </section>
  );
}

/** Encerradas: todos os meses de meta já fechados, inclusive de metas editadas ou excluídas. */
export function ClosedGoalMonths({ history, onOpen }: { history: GoalHistory; onOpen?: (series: GoalSeries) => void }) {
  const items = history.series.flatMap((s) => s.months
    .filter((m) => m.status === "met" || m.status === "missed")
    .map((m) => ({ s, m })))
    .sort((a, b) => b.m.month.localeCompare(a.m.month) || a.s.category_name.localeCompare(b.s.category_name, "pt-BR"));
  if (!items.length) return null;
  const months = [...new Set(items.map((x) => x.m.month))];
  return (
    <details className="group mt-4 rounded-xl border border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-[13px] font-semibold">
        Encerradas ({items.length})
        <span className="text-[11px] font-normal text-muted-foreground group-open:hidden">ver resultados</span>
      </summary>
      <div className="border-t border-border">
        {months.map((month) => (
          <div key={month}>
            <p className="bg-secondary/50 px-3 py-1.5 text-[11px] font-semibold capitalize text-muted-foreground">{historyMonthName(month)} de {month.slice(0, 4)}</p>
            <ul className="divide-y divide-border">
              {items.filter((x) => x.m.month === month).map(({ s, m }) => {
                const ok = m.status === "met";
                return (
                  <li key={`${s.category_id}-${month}`}>
                    <button type="button" onClick={() => onOpen?.(s)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[12px]">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{s.category_name}</span>
                        <span className="text-muted-foreground tabular-nums">{formatBRL(m.actual)} de {formatBRL(m.limit ?? 0)}</span>
                      </span>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${ok ? "bg-emerald-500/15 text-emerald-700" : "bg-red-500/15 text-red-700"}`}>
                        {ok ? <Check size={11} aria-hidden /> : <X size={11} aria-hidden />}
                        {ok ? `Cumpriu · sobrou ${formatBRL(m.difference ?? 0)}` : `Acima ${formatBRL(-(m.difference ?? 0))}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
