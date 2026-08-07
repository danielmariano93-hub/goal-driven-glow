// anticipation_contract.v1 — motor de descoberta de padrões pessoais.
// Estatística simples e auditável: mediana, IQR, dias extraordinários fora,
// amostra mínima por detector. Nenhum padrão nasce "ativo".

import { round2 } from "../finance-core/facts.ts";
import {
  ANTICIPATION_FORMULA_VERSION,
  type BehavioralPattern,
  type DailyFact,
  type DetectorConfig,
  type DetectorKey,
  type MonthPhase,
} from "./contracts.ts";
import { computeWeekdayPatternFromDailyFacts } from "../analytics/weekdayPattern.ts";

export function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function iqrBounds(values: number[]): { low: number; high: number } {
  const sorted = values.slice().sort((a, b) => a - b);
  if (sorted.length < 4) return { low: -Infinity, high: Infinity };
  const q = (p: number) => {
    const pos = (sorted.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  return { low: q1 - 1.5 * iqr, high: q3 + 1.5 * iqr };
}

/** Remove outliers para o cálculo do comportamento típico (não os apaga do histórico). */
export function withoutOutliers(values: number[]): { kept: number[]; removed: number[] } {
  const { low, high } = iqrBounds(values);
  const kept: number[] = [];
  const removed: number[] = [];
  for (const v of values) (v < low || v > high ? removed : kept).push(v);
  return { kept, removed };
}

const WEEKDAY_LABELS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const PHASE_LABELS: Record<MonthPhase, string> = {
  inicio: "início do mês",
  meio: "meio do mês",
  fim: "fim do mês",
};

function baseCandidate(
  userId: string,
  detector: DetectorKey,
  patternKey: string,
  label: string,
  days: DailyFact[],
): BehavioralPattern {
  return {
    user_id: userId,
    detector,
    pattern_key: patternKey,
    label,
    status: "candidate",
    sample_size: 0,
    window_start: days[0]?.local_date ?? null,
    window_end: days[days.length - 1]?.local_date ?? null,
    baseline_value: 0,
    pattern_value: 0,
    uplift_pct: 0,
    absolute_delta: 0,
    hit_rate: 0,
    consistency: 0,
    confidence: 0,
    data_coverage: 0,
    evidence: {},
    exclusions: [],
    formula_version: ANTICIPATION_FORMULA_VERSION,
    detector_version: "v1",
  };
}

function finalize(
  pattern: BehavioralPattern,
  groupValues: number[],
  otherValues: number[],
  config: DetectorConfig,
  coverage: number,
): BehavioralPattern | null {
  const group = withoutOutliers(groupValues);
  const other = withoutOutliers(otherValues);
  if (group.kept.length < config.min_sample || other.kept.length < 3) return null;

  const patternValue = round2(median(group.kept));
  const baseline = round2(median(other.kept));
  if (patternValue <= 0) return null;

  const delta = round2(patternValue - baseline);
  const uplift = baseline > 0 ? round2((delta / baseline) * 100) : 100;
  const hitRate = round2(group.kept.filter((v) => v > baseline).length / group.kept.length);
  const spread = median(group.kept.map((v) => Math.abs(v - patternValue)));
  const consistency = patternValue > 0 ? round2(Math.max(0, 1 - spread / patternValue)) : 0;

  const sampleFactor = Math.min(1, group.kept.length / (config.min_sample * 2));
  const confidence = round2(
    Math.max(0, Math.min(0.95, 0.35 * sampleFactor + 0.35 * hitRate + 0.3 * consistency)),
  );

  // Motivo EXATO de cada critério não atendido — a UI mostra isso ao usuário.
  const blockReasons: Array<{ criterion: string; observed: number; required: number }> = [];
  if (uplift < config.min_uplift_pct) blockReasons.push({ criterion: "uplift_pct", observed: uplift, required: config.min_uplift_pct });
  if (delta < config.min_absolute_delta) blockReasons.push({ criterion: "absolute_delta", observed: delta, required: config.min_absolute_delta });
  if (hitRate < config.min_hit_rate) blockReasons.push({ criterion: "hit_rate", observed: hitRate, required: config.min_hit_rate });
  if (confidence < config.min_confidence) blockReasons.push({ criterion: "confidence", observed: confidence, required: config.min_confidence });
  if (coverage < config.min_coverage) blockReasons.push({ criterion: "coverage", observed: round2(coverage), required: config.min_coverage });
  if (group.kept.length < config.min_sample) blockReasons.push({ criterion: "sample_size", observed: group.kept.length, required: config.min_sample });

  const passes = blockReasons.length === 0;

  return {
    ...pattern,
    status: passes ? "validated" : "candidate",
    sample_size: group.kept.length,
    baseline_value: baseline,
    pattern_value: patternValue,
    uplift_pct: uplift,
    absolute_delta: delta,
    hit_rate: hitRate,
    consistency,
    confidence,
    data_coverage: round2(coverage),
    evidence: {
      sample_values: group.kept.slice(-12),
      baseline_sample: other.kept.length,
      excluded_outliers: group.removed.length + other.removed.length,
      window: { from: pattern.window_start, to: pattern.window_end },
      block_reasons: blockReasons,
      thresholds: {
        min_sample: config.min_sample,
        min_uplift_pct: config.min_uplift_pct,
        min_absolute_delta: config.min_absolute_delta,
        min_hit_rate: config.min_hit_rate,
        min_confidence: config.min_confidence,
        min_coverage: config.min_coverage,
      },
    },
    exclusions: [
      "transferências internas",
      "pagamento de fatura",
      "aplicações e resgates",
      "principal de dívida",
      "lançamentos planejados",
      "dias extraordinários (IQR)",
    ],
  };
}

export type DiscoveryInput = {
  userId: string;
  days: DailyFact[];
  coverage: number;
  configs: Map<DetectorKey, DetectorConfig>;
  cardCycles?: Array<{ card_id: string; cycle_key: string; total: number; days_elapsed: number; closed: boolean }>;
  recurringHistory?: Array<{ merchant: string; day_of_month: number; amount: number; month: string }>;
};

/** Descobre todos os padrões possíveis a partir dos fatos diários. */
export function discoverPatterns(input: DiscoveryInput): BehavioralPattern[] {
  const out: BehavioralPattern[] = [];
  const usable = input.days.filter((d) => !d.is_exceptional_day);
  if (usable.length === 0) return out;

  // 1. Dia da semana — usa exatamente a mesma verdade comportamental do Assessor.
  const weekdayConfig = input.configs.get("weekday_spending_risk");
  if (weekdayConfig && usable.length > 0) {
    const from = usable[0].local_date;
    const to = usable[usable.length - 1].local_date;
    const cfgMinSample = Number.isFinite(Number(weekdayConfig.min_sample)) ? Number(weekdayConfig.min_sample) : 4;
    const cfgWindowDays = Number.isFinite(Number(weekdayConfig.min_window_days)) ? Number(weekdayConfig.min_window_days) : 56;
    const cfgCoverage = Number.isFinite(Number(weekdayConfig.min_coverage)) ? Number(weekdayConfig.min_coverage) : 0.65;
    const cfgUplift = Number.isFinite(Number(weekdayConfig.min_uplift_pct)) ? Number(weekdayConfig.min_uplift_pct) : 20;
    const cfgAbsDelta = Number.isFinite(Number(weekdayConfig.min_absolute_delta)) ? Number(weekdayConfig.min_absolute_delta) : 20;
    const truth = computeWeekdayPatternFromDailyFacts({
      days: usable,
      from,
      to,
      coverage: input.coverage,
      policy: {
        min_weeks: Math.max(8, Math.ceil(cfgWindowDays / 7)),
        min_active_days_candidate: Math.max(4, Math.min(6, cfgMinSample)),
        min_active_days_established: Math.max(6, cfgMinSample),
        min_total_active_days: Math.max(14, cfgMinSample * 2),
        min_data_coverage: cfgCoverage,
        min_separation_pct: Math.max(0.15, cfgUplift / 200),
        min_separation_amount: Math.max(20, cfgAbsDelta / 2),
        min_consistency: 0.5,
      },
    });

    const comparable = truth.weekdays.filter((row) => row.typical_amount > 0);
    const typicalValues = comparable.map((row) => row.typical_amount);
    for (const row of comparable) {
      if (row.clean_active_days < Math.max(4, Math.min(6, cfgMinSample))) continue;
      const otherValues = comparable
        .filter((other) => other.weekday !== row.weekday)
        .map((other) => other.typical_amount)
        .filter((value) => value > 0);
      const baseline = median(otherValues);
      const delta = round2(row.typical_amount - baseline);
      const uplift = baseline > 0 ? round2((delta / baseline) * 100) : 100;
      const isEstablishedWinner = truth.decision === "established" && truth.winner?.weekday === row.weekday;
      const separationBlocked = truth.decision === "ambiguous" && truth.candidate?.weekday === row.weekday;
      const blockReasons = Object.entries(truth.gates)
        .filter(([, ok]) => !ok)
        .map(([criterion]) => ({ criterion, observed: false, required: true }));
      if (separationBlocked) {
        blockReasons.push({ criterion: "weekday_separation", observed: false, required: true });
      }

      out.push({
        user_id: input.userId,
        detector: "weekday_spending_risk",
        pattern_key: `weekday:${row.weekday}`,
        label: `Gasto ajustável maior na ${WEEKDAY_LABELS[row.weekday]}`,
        status: isEstablishedWinner ? "validated" : "candidate",
        sample_size: row.clean_active_days,
        window_start: from,
        window_end: to,
        baseline_value: round2(baseline),
        pattern_value: row.typical_amount,
        uplift_pct: uplift,
        absolute_delta: delta,
        hit_rate: row.active_rate,
        consistency: row.consistency,
        confidence: isEstablishedWinner
          ? (truth.confidence === "high" ? 0.9 : 0.75)
          : truth.decision === "ambiguous" ? 0.45 : 0.4,
        data_coverage: input.coverage,
        evidence: {
          truth_formula_version: truth.formula_version,
          truth_decision: truth.decision,
          truth_candidate_weekday: truth.candidate?.weekday ?? null,
          truth_winner_weekday: truth.winner?.weekday ?? null,
          truth_runner_up_weekday: truth.runner_up?.weekday ?? null,
          truth_gates: truth.gates,
          limitations: truth.limitations,
          block_reasons: blockReasons,
          metric: row,
          excluded_outliers: row.outlier_count,
          comparable_typical_values: typicalValues,
        },
        exclusions: [
          "transferências internas",
          "pagamento de fatura",
          "aplicações e resgates",
          "principal de dívida",
          "lançamentos planejados",
          "datas comportamentais de baixa confiança",
          "dias extraordinários",
        ],
        formula_version: ANTICIPATION_FORMULA_VERSION,
        detector_version: "v2",
      });
    }
  }
  // 2. Fim de semana
  const weekendConfig = input.configs.get("weekend_spending_risk");
  if (weekendConfig) {
    const group = usable.filter((d) => d.weekday === 0 || d.weekday === 6).map((d) => d.total_adjustable);
    const other = usable.filter((d) => d.weekday !== 0 && d.weekday !== 6).map((d) => d.total_adjustable);
    const candidate = finalize(
      baseCandidate(input.userId, "weekend_spending_risk", "weekend", "Gasto ajustável maior no fim de semana", usable),
      group,
      other,
      weekendConfig,
      input.coverage,
    );
    if (candidate) out.push(candidate);
  }

  // 3. Fase do mês
  const phaseConfig = input.configs.get("month_phase_spending_risk");
  if (phaseConfig) {
    for (const phase of ["inicio", "meio", "fim"] as MonthPhase[]) {
      const group = usable.filter((d) => d.month_phase === phase).map((d) => d.total_adjustable);
      const other = usable.filter((d) => d.month_phase !== phase).map((d) => d.total_adjustable);
      const candidate = finalize(
        baseCandidate(
          input.userId,
          "month_phase_spending_risk",
          `phase:${phase}`,
          `Gasto ajustável maior no ${PHASE_LABELS[phase]}`,
          usable,
        ),
        group,
        other,
        phaseConfig,
        input.coverage,
      );
      if (candidate) out.push(candidate);
    }
  }

  // 4. Gastos pequenos acelerando (semana corrente vs semanas anteriores)
  const smallConfig = input.configs.get("small_spend_acceleration");
  if (smallConfig) {
    const byWeek = new Map<string, number>();
    for (const day of usable) {
      byWeek.set(day.week_start, round2((byWeek.get(day.week_start) ?? 0) + day.total_small_spend));
    }
    const weeks = [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (weeks.length >= 4) {
      const recent = weeks.slice(-2).map(([, v]) => v);
      const previous = weeks.slice(0, -2).map(([, v]) => v);
      const candidate = finalize(
        baseCandidate(
          input.userId,
          "small_spend_acceleration",
          "small_spend",
          "Gastos pequenos somando mais que o habitual",
          usable,
        ),
        recent.concat(recent),
        previous,
        { ...smallConfig, min_sample: Math.min(smallConfig.min_sample, 4) },
        input.coverage,
      );
      if (candidate) out.push(candidate);
    }
  }

  // 5. Fatura acelerando no ciclo
  const cardConfig = input.configs.get("card_cycle_acceleration");
  if (cardConfig && (input.cardCycles ?? []).length >= 4) {
    const byCard = new Map<string, typeof input.cardCycles>();
    for (const cycle of input.cardCycles!) {
      const list = byCard.get(cycle.card_id) ?? [];
      list.push(cycle);
      byCard.set(cycle.card_id, list);
    }
    for (const [cardId, cycles] of byCard) {
      const closed = (cycles ?? []).filter((c) => c.closed);
      const open = (cycles ?? []).find((c) => !c.closed);
      if (!open || closed.length < cardConfig.min_sample) continue;
      const paceOf = (c: { total: number; days_elapsed: number }) =>
        c.days_elapsed > 0 ? round2(c.total / c.days_elapsed) : 0;
      const baseline = round2(median(closed.map(paceOf)));
      const current = paceOf(open);
      if (baseline <= 0 || current <= baseline) continue;
      const projected = round2(current * 30);
      const baselineProjected = round2(baseline * 30);
      const delta = round2(projected - baselineProjected);
      const uplift = round2((delta / baselineProjected) * 100);
      if (uplift < cardConfig.min_uplift_pct || delta < cardConfig.min_absolute_delta) continue;
      out.push({
        ...baseCandidate(
          input.userId,
          "card_cycle_acceleration",
          `card:${cardId}`,
          "Fatura crescendo mais rápido que nos ciclos anteriores",
          usable,
        ),
        status: "validated",
        sample_size: closed.length,
        baseline_value: baselineProjected,
        pattern_value: projected,
        uplift_pct: uplift,
        absolute_delta: delta,
        hit_rate: 1,
        consistency: 0.8,
        confidence: Math.min(0.9, 0.5 + closed.length * 0.1),
        data_coverage: round2(input.coverage),
        evidence: { card_id: cardId, cycles_compared: closed.length, daily_pace: current, baseline_pace: baseline },
        exclusions: ["pagamento de fatura", "estornos"],
      });
    }
  }

  // 6. Compromisso recorrente esperado
  const recurringConfig = input.configs.get("expected_recurring_payment");
  if (recurringConfig && (input.recurringHistory ?? []).length > 0) {
    const byMerchant = new Map<string, Array<{ day: number; amount: number; month: string }>>();
    for (const row of input.recurringHistory!) {
      const list = byMerchant.get(row.merchant) ?? [];
      list.push({ day: row.day_of_month, amount: row.amount, month: row.month });
      byMerchant.set(row.merchant, list);
    }
    for (const [merchant, rows] of byMerchant) {
      const months = new Set(rows.map((r) => r.month));
      if (months.size < recurringConfig.min_sample) continue;
      const amount = round2(median(rows.map((r) => r.amount)));
      if (amount < recurringConfig.min_absolute_delta) continue;
      const day = Math.round(median(rows.map((r) => r.day)));
      const spread = median(rows.map((r) => Math.abs(r.day - day)));
      if (spread > 4) continue;
      out.push({
        ...baseCandidate(
          input.userId,
          "expected_recurring_payment",
          `recurring:${merchant}`,
          `Compromisso recorrente com ${merchant}`,
          usable,
        ),
        status: "validated",
        sample_size: months.size,
        baseline_value: amount,
        pattern_value: amount,
        uplift_pct: 0,
        absolute_delta: amount,
        hit_rate: round2(Math.min(1, months.size / 6)),
        consistency: round2(Math.max(0, 1 - spread / 5)),
        confidence: round2(Math.min(0.9, 0.4 + months.size * 0.1)),
        data_coverage: round2(input.coverage),
        evidence: { merchant, expected_day: day, occurrences: months.size, day_spread: spread },
        exclusions: ["transferências internas", "pagamento de fatura"],
      });
    }
  }

  return out;
}

/**
 * Enfraquece ou expira padrões que não se confirmam mais. Chamada com o padrão
 * persistido e o recém-recalculado (ou `null` quando desapareceu).
 */
export function reconcilePattern(
  stored: BehavioralPattern & { id?: string },
  fresh: BehavioralPattern | null,
): BehavioralPattern & { id?: string } {
  if (!fresh) {
    return { ...stored, status: stored.status === "weakened" ? "expired" : "weakened", confidence: round2(stored.confidence * 0.6) };
  }
  const status: BehavioralPattern["status"] = fresh.status === "validated"
    ? (stored.status === "active" ? "active" : "validated")
    : "weakened";
  return { ...stored, ...fresh, status };
}
