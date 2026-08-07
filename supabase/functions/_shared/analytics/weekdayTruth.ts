// weekday.behavioral-truth.v5
// Contrato estatístico único para padrão por dia da semana.
// Usado pelo assessor e pelo motor de antecipação. Nenhum canal pode manter
// uma fórmula concorrente para responder "em qual dia eu costumo gastar mais?".

export const WEEKDAY_TRUTH_FORMULA_VERSION = "weekday.behavioral-truth.v5";

export const WEEKDAY_LABELS = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

export type WeekdayTruthDecision = "established" | "candidate" | "ambiguous" | "insufficient";

export type WeekdayTruthDay = {
  date: string;
  weekday?: number;
  amount: number;
  transactions?: number;
  exceptional?: boolean;
  confidence?: number;
};

export type WeekdayTruthPolicy = {
  min_weeks: number;
  min_active_days_candidate: number;
  min_active_days_established: number;
  min_total_active_days: number;
  min_data_coverage: number;
  min_separation_pct: number;
  min_separation_amount: number;
  min_consistency: number;
};

export type WeekdayTruthMetric = {
  weekday: number;
  label: string;
  occurrences: number;
  active_days: number;
  clean_active_days: number;
  active_rate: number;
  transactions: number;
  total: number;
  mean_all_days: number;
  median_all_days: number;
  median_active_amount: number;
  typical_amount: number;
  outlier_count: number;
  consistency: number;
  transactions_per_occurrence: number;
  average_ticket: number;
};

export type WeekdayTruthResult = {
  formula_version: typeof WEEKDAY_TRUTH_FORMULA_VERSION;
  period: { from: string; to: string; weeks_observed: number };
  decision: WeekdayTruthDecision;
  confidence: "high" | "medium" | "low" | "insufficient";
  winner: (WeekdayTruthMetric & { margin_pct: number; margin_amount: number }) | null;
  candidate: (WeekdayTruthMetric & { margin_pct: number; margin_amount: number }) | null;
  runner_up: WeekdayTruthMetric | null;
  weekdays: WeekdayTruthMetric[];
  outliers: Array<{ date: string; weekday: number; label: string; amount: number }>;
  data_coverage: number;
  sample_size: number;
  gates: Record<string, boolean>;
  limitations: string[];
};

export const DEFAULT_WEEKDAY_TRUTH_POLICY: WeekdayTruthPolicy = {
  // O histórico pode ter 12 semanas por padrão, mas nunca afirmamos padrão
  // estabelecido antes de 8 semanas observadas.
  min_weeks: 8,
  // Com menos de 4 ocorrências ativas não existe sequer estimativa pública.
  min_active_days_candidate: 4,
  // Para chamar de padrão estabelecido exigimos seis ocorrências ativas no líder.
  min_active_days_established: 6,
  // Evita escolher um líder quando o histórico inteiro é muito esparso.
  min_total_active_days: 14,
  // A cobertura é calculada sobre dias presentes/confiáveis na série fonte.
  min_data_coverage: 0.65,
  // O líder precisa se separar do segundo colocado por valor relativo e absoluto.
  min_separation_pct: 0.15,
  min_separation_amount: 20,
  // 1 - MAD/mediana dos dias ativos limpos. Sinais muito bimodais são bloqueados.
  min_consistency: 0.5,
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function median(values: number[]): number {
  if (!values.length) return 0;
  const a = [...values].sort((x, y) => x - y);
  const i = Math.floor(a.length / 2);
  return a.length % 2 ? a[i] : (a[i - 1] + a[i]) / 2;
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const a = [...values].sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

function highOutlierThreshold(values: number[]): number {
  // Com amostra curta a decisão correta é ABSTER, não fingir que não há outlier.
  // Por isso o threshold continua infinito, mas os gates abaixo impedem afirmação.
  if (values.length < 4) return Number.POSITIVE_INFINITY;
  const med = median(values);
  const mad = median(values.map((v) => Math.abs(v - med)));
  if (mad > 0) return med + 3 * 1.4826 * mad;
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q3 - q1;
  if (iqr > 0) return q3 + 1.5 * iqr;
  const max = Math.max(...values);
  if (max - med >= 100 && max > Math.max(100, med * 3)) {
    return med + Math.max(100, med * 2);
  }
  return Number.POSITIVE_INFINITY;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function dayOfWeek(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

function validIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Computa a verdade comportamental a partir de fatos DIÁRIOS.
 *
 * A entrada pode ser esparsa; todos os dias do período são materializados com
 * zero para que ausência de gasto participe da frequência. Dias marcados como
 * excepcionais ficam fora do comportamento típico, mas continuam auditáveis na
 * origem. `confidence < 0.65` é excluído da série comportamental.
 */
export function computeWeekdayTruth(args: {
  days: WeekdayTruthDay[];
  from: string;
  to: string;
  policy?: Partial<WeekdayTruthPolicy>;
  /** Cobertura da origem (0..1). Ausência de linha em um dia significa zero gasto, não dado ausente. */
  coverage?: number;
}): WeekdayTruthResult {
  const policy: WeekdayTruthPolicy = { ...DEFAULT_WEEKDAY_TRUTH_POLICY, ...(args.policy ?? {}) };
  if (!validIsoDate(args.from) || !validIsoDate(args.to) || args.from > args.to) {
    throw new Error("weekday_truth_invalid_period");
  }

  const byDate = new Map<string, WeekdayTruthDay>();
  for (const raw of args.days) {
    const date = String(raw.date ?? "").slice(0, 10);
    if (!validIsoDate(date) || date < args.from || date > args.to) continue;
    const confidence = Number(raw.confidence ?? 1);
    if (!Number.isFinite(confidence) || confidence < 0.65) continue;
    if (raw.exceptional) continue;
    const amount = Math.max(0, Number(raw.amount ?? 0));
    const transactions = Math.max(0, Number(raw.transactions ?? 0));
    const prev = byDate.get(date);
    byDate.set(date, {
      date,
      weekday: Number.isInteger(raw.weekday) ? raw.weekday : dayOfWeek(date),
      amount: round2((prev?.amount ?? 0) + (Number.isFinite(amount) ? amount : 0)),
      transactions: (prev?.transactions ?? 0) + (Number.isFinite(transactions) ? transactions : 0),
      confidence,
    });
  }

  const allDates: string[] = [];
  for (let d = args.from; d <= args.to; d = addDays(d, 1)) allDates.push(d);
  const buckets = Array.from({ length: 7 }, () => [] as Array<{ date: string; amount: number; transactions: number }>);
  for (const date of allDates) {
    const row = byDate.get(date);
    const weekday = row?.weekday ?? dayOfWeek(date);
    buckets[weekday].push({
      date,
      amount: round2(row?.amount ?? 0),
      transactions: Math.max(0, Number(row?.transactions ?? 0)),
    });
  }

  const outliers: WeekdayTruthResult["outliers"] = [];
  const weekdays: WeekdayTruthMetric[] = buckets.map((days, weekday) => {
    const values = days.map((d) => d.amount);
    const active = days.filter((d) => d.amount > 0);
    const threshold = highOutlierThreshold(active.map((d) => d.amount));
    const cleanActive = active.filter((d) => d.amount <= threshold);
    const flagged = active.filter((d) => d.amount > threshold);
    for (const f of flagged) {
      outliers.push({ date: f.date, weekday, label: WEEKDAY_LABELS[weekday], amount: f.amount });
    }
    const total = values.reduce((sum, value) => sum + value, 0);
    const transactions = days.reduce((sum, d) => sum + d.transactions, 0);
    const activeRate = days.length ? active.length / days.length : 0;
    const medianActive = median(cleanActive.map((d) => d.amount));
    const typicalAmount = medianActive * activeRate;
    const mad = median(cleanActive.map((d) => Math.abs(d.amount - medianActive)));
    const consistency = medianActive > 0 ? Math.max(0, 1 - mad / medianActive) : 0;
    return {
      weekday,
      label: WEEKDAY_LABELS[weekday],
      occurrences: days.length,
      active_days: active.length,
      clean_active_days: cleanActive.length,
      active_rate: round2(activeRate),
      transactions,
      total: round2(total),
      mean_all_days: round2(days.length ? total / days.length : 0),
      median_all_days: round2(median(values)),
      median_active_amount: round2(medianActive),
      typical_amount: round2(typicalAmount),
      outlier_count: flagged.length,
      consistency: round2(consistency),
      transactions_per_occurrence: round2(days.length ? transactions / days.length : 0),
      average_ticket: round2(transactions ? total / transactions : 0),
    };
  });

  const weeksObserved = allDates.length / 7;
  const totalActiveDays = weekdays.reduce((sum, row) => sum + row.active_days, 0);
  const rawCoverage = Number(args.coverage ?? 1);
  const dataCoverage = Number.isFinite(rawCoverage) ? Math.max(0, Math.min(1, rawCoverage)) : 1;
  const ranked = weekdays
    .filter((row) => row.typical_amount > 0 && row.clean_active_days >= policy.min_active_days_candidate)
    .sort((a, b) => b.typical_amount - a.typical_amount);
  const top = ranked[0] ?? null;
  const second = ranked[1] ?? null;
  const marginAmount = top && second ? top.typical_amount - second.typical_amount : top?.typical_amount ?? 0;
  const marginPct = top && second && second.typical_amount > 0
    ? marginAmount / second.typical_amount
    : top ? 1 : 0;

  const gates = {
    enough_weeks: weeksObserved >= policy.min_weeks,
    enough_total_activity: totalActiveDays >= policy.min_total_active_days,
    enough_leader_activity: Boolean(top && top.clean_active_days >= policy.min_active_days_established),
    data_coverage: dataCoverage >= policy.min_data_coverage,
    separated_relative: Boolean(top && (!second || marginPct >= policy.min_separation_pct)),
    separated_absolute: Boolean(top && (!second || marginAmount >= policy.min_separation_amount)),
    consistent_leader: Boolean(top && top.consistency >= policy.min_consistency),
  };

  const limitations: string[] = [];
  if (!top) limitations.push("Ainda não há pelo menos quatro ocorrências ativas comparáveis em um mesmo dia da semana.");
  if (!gates.enough_weeks) limitations.push(`O histórico cobre menos de ${policy.min_weeks} semanas.`);
  if (!gates.enough_total_activity) limitations.push("Há poucos dias com gasto ajustável para comparar um padrão semanal com segurança.");
  if (top && !gates.enough_leader_activity) limitations.push(`O dia líder ainda não tem ${policy.min_active_days_established} ocorrências ativas limpas.`);
  if (!gates.data_coverage) limitations.push("A cobertura de dados comportamentais confiáveis ainda é baixa.");
  if (top && second && (!gates.separated_relative || !gates.separated_absolute)) {
    limitations.push(`${top.label} e ${second.label} estão próximos demais para apontar um vencedor confiável.`);
  }
  if (top && !gates.consistent_leader) limitations.push(`Os valores de ${top.label.toLowerCase()} variam demais para representar um gasto típico estável.`);

  let decision: WeekdayTruthDecision = "insufficient";
  if (top) {
    const baseEnough = gates.enough_weeks && gates.enough_total_activity && gates.data_coverage;
    const separationOk = gates.separated_relative && gates.separated_absolute;
    if (baseEnough && gates.enough_leader_activity && separationOk && gates.consistent_leader) {
      decision = "established";
    } else if (baseEnough && gates.enough_leader_activity && !separationOk) {
      decision = "ambiguous";
    } else if (top.clean_active_days >= policy.min_active_days_candidate) {
      decision = "candidate";
    }
  }

  const confidence: WeekdayTruthResult["confidence"] = decision === "established"
    ? (weeksObserved >= 12 && top && top.clean_active_days >= 8 && marginPct >= 0.2 ? "high" : "medium")
    : decision === "candidate" || decision === "ambiguous"
      ? "low"
      : "insufficient";

  const candidate = top ? {
    ...top,
    margin_pct: round2(marginPct * 100),
    margin_amount: round2(marginAmount),
  } : null;
  const winner = decision === "established" ? candidate : null;

  return {
    formula_version: WEEKDAY_TRUTH_FORMULA_VERSION,
    period: { from: args.from, to: args.to, weeks_observed: round2(weeksObserved) },
    decision,
    confidence,
    winner,
    candidate,
    runner_up: second,
    weekdays,
    outliers,
    data_coverage: round2(dataCoverage),
    sample_size: totalActiveDays,
    gates,
    limitations,
  };
}
