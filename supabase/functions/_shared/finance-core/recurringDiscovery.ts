// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Motor de Assinaturas e Recorrências descobertas (`recurring_discovery.v1`).
// Descobre compromissos recorrentes a partir do histórico real: mesmo
// estabelecimento, cadência estável e valor estável. Detecta salto de preço e
// cobrança que não apareceu no ciclo. Puro e determinístico.
import { isRealMonthlyMovement, round2, type TransactionRow, type RecurringRow } from "./facts.ts";
import { buildMerchantResolver, type MerchantAliasRow, type MerchantResolver } from "./merchant.ts";
import {
  confidenceFromSample,
  daysBetweenInclusive,
  makeEnvelope,
  makeEvidence,
  medianOf,
  shiftDays,
  type EngineEnvelope,
  type EnginePeriod,
} from "./engineEnvelope.ts";

export const RECURRING_DISCOVERY_VERSION = "recurring_discovery.v1";

export type RecurringCadence = "weekly" | "monthly" | "bimonthly" | "quarterly" | "yearly";

export interface DetectedSubscription {
  merchant_key: string;
  label: string;
  cadence: RecurringCadence;
  /** Valor da última cobrança. */
  current_amount: number;
  /** Valor da cobrança anterior (para salto de preço). */
  previous_amount: number | null;
  /** Valor típico (mediana das cobranças). */
  typical_amount: number;
  /** Equivalente mensal do compromisso. */
  monthly_equivalent: number;
  occurrences: number;
  first_at: string;
  last_at: string;
  median_interval_days: number;
  expected_next_at: string;
  /** Passou do prazo esperado + tolerância e não apareceu. */
  missing: boolean;
  days_overdue: number;
  /** Variação percentual da última cobrança vs anterior. */
  price_change_pct: number | null;
  price_jump: boolean;
  confidence: "high" | "medium" | "low";
  /** Já existe recorrência cadastrada equivalente. */
  already_registered: boolean;
  amounts: number[];
  dates: string[];
}

export interface RecurringDiscoveryFacts {
  monthly_committed: number;
  subscriptions_count: number;
  missing_count: number;
  price_jump_count: number;
  biggest: { label: string; monthly_equivalent: number } | null;
}

export interface RecurringDiscoveryInput {
  txs: TransactionRow[];
  /** Janela de análise (recomendado: últimos 180 dias). */
  period: EnginePeriod;
  today?: string;
  aliases?: MerchantAliasRow[];
  resolver?: MerchantResolver;
  /** Recorrências já cadastradas manualmente (para não duplicar). */
  registered?: RecurringRow[];
  /** Tolerância de atraso antes de marcar como ausente. */
  graceDays?: number;
}

const CADENCE_RULES: Array<{ cadence: RecurringCadence; min: number; max: number; perMonth: number }> = [
  { cadence: "weekly", min: 5, max: 10, perMonth: 4.345 },
  { cadence: "monthly", min: 24, max: 38, perMonth: 1 },
  { cadence: "bimonthly", min: 52, max: 70, perMonth: 0.5 },
  { cadence: "quarterly", min: 80, max: 100, perMonth: 1 / 3 },
  { cadence: "yearly", min: 330, max: 400, perMonth: 1 / 12 },
];

function inRange(date: string, period: EnginePeriod): boolean {
  const d = date.slice(0, 10);
  return d >= period.from && d <= period.to;
}

function intervalsOf(dates: string[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < dates.length; i += 1) {
    out.push(daysBetweenInclusive(dates[i - 1], dates[i]) - 1);
  }
  return out;
}

function classifyCadence(medianInterval: number): { cadence: RecurringCadence; perMonth: number } | null {
  const rule = CADENCE_RULES.find((r) => medianInterval >= r.min && medianInterval <= r.max);
  return rule ? { cadence: rule.cadence, perMonth: rule.perMonth } : null;
}

/**
 * Descobre assinaturas/compromissos recorrentes. Só promove um grupo quando:
 *  - há pelo menos 2 cobranças (3+ para confiança alta);
 *  - a cadência mediana casa com uma janela conhecida;
 *  - os intervalos são consistentes (desvio <= 35% da mediana);
 *  - o valor é estável (dispersão <= 20% da mediana) ou a cadência é exata.
 */
export function discoverRecurring(
  input: RecurringDiscoveryInput,
): EngineEnvelope<RecurringDiscoveryFacts, DetectedSubscription, DetectedSubscription> {
  const resolver = input.resolver ?? buildMerchantResolver(input.aliases ?? []);
  const today = input.today ?? input.period.to;
  const grace = input.graceDays ?? 5;

  const groups = new Map<string, { label: string; entries: Array<{ date: string; amount: number }> }>();
  let sampleSize = 0;

  for (const t of input.txs) {
    if (t.type !== "expense" || !isRealMonthlyMovement(t)) continue;
    if (!inRange(t.occurred_at, input.period)) continue;
    const resolution = resolver.resolve(t.description);
    if (!resolution) continue;
    const amount = round2(Number(t.amount || 0));
    if (amount <= 0) continue;
    sampleSize += 1;
    const g = groups.get(resolution.key) ?? { label: resolution.label, entries: [] };
    g.entries.push({ date: t.occurred_at.slice(0, 10), amount });
    groups.set(resolution.key, g);
  }

  const registeredKeys = new Set<string>();
  for (const r of input.registered ?? []) {
    const resolution = resolver.resolve((r as unknown as { description?: string | null }).description ?? null);
    if (resolution) registeredKeys.add(resolution.key);
  }

  const found: DetectedSubscription[] = [];

  for (const [key, group] of groups) {
    const entries = [...group.entries].sort((a, b) => (a.date < b.date ? -1 : 1));
    if (entries.length < 2) continue;

    // Uma cobrança por ciclo: colapsa mesmo dia (parcelamentos no mesmo dia).
    const byDay = new Map<string, number>();
    for (const e of entries) byDay.set(e.date, round2((byDay.get(e.date) ?? 0) + e.amount));
    const dates = [...byDay.keys()].sort();
    const amounts = dates.map((d) => byDay.get(d) ?? 0);
    if (dates.length < 2) continue;

    const intervals = intervalsOf(dates);
    const medianInterval = Math.round(medianOf(intervals));
    const cadence = classifyCadence(medianInterval);
    if (!cadence) continue;

    const intervalDeviation = medianInterval > 0
      ? Math.max(...intervals.map((i) => Math.abs(i - medianInterval))) / medianInterval
      : 1;
    if (intervalDeviation > 0.35) continue;

    const typical = round2(medianOf(amounts));
    if (typical <= 0) continue;
    const amountDispersion = Math.max(...amounts.map((a) => Math.abs(a - typical))) / typical;
    if (amountDispersion > 0.35) continue;

    const currentAmount = amounts[amounts.length - 1];
    const previousAmount = amounts.length >= 2 ? amounts[amounts.length - 2] : null;
    const priceChangePct = previousAmount && previousAmount > 0
      ? round2(((currentAmount - previousAmount) / previousAmount) * 100)
      : null;

    const lastAt = dates[dates.length - 1];
    const expectedNext = shiftDays(lastAt, medianInterval);
    const daysOverdue = expectedNext < today ? daysBetweenInclusive(expectedNext, today) - 1 : 0;

    const confidence: DetectedSubscription["confidence"] =
      dates.length >= 4 && amountDispersion <= 0.1
        ? "high"
        : dates.length >= 3 && amountDispersion <= 0.2
          ? "medium"
          : "low";

    found.push({
      merchant_key: key,
      label: group.label,
      cadence: cadence.cadence,
      current_amount: currentAmount,
      previous_amount: previousAmount,
      typical_amount: typical,
      monthly_equivalent: round2(typical * cadence.perMonth),
      occurrences: dates.length,
      first_at: dates[0],
      last_at: lastAt,
      median_interval_days: medianInterval,
      expected_next_at: expectedNext,
      missing: daysOverdue > grace,
      days_overdue: daysOverdue,
      price_change_pct: priceChangePct,
      price_jump: priceChangePct !== null && priceChangePct >= 10 && round2(currentAmount - (previousAmount ?? 0)) >= 5,
      confidence,
      already_registered: registeredKeys.has(key),
      amounts,
      dates,
    });
  }

  found.sort((a, b) => b.monthly_equivalent - a.monthly_equivalent);

  const monthlyCommitted = round2(found.reduce((s, f) => s + f.monthly_equivalent, 0));
  const drivers = found.filter((f) => f.price_jump || f.missing).slice(0, 5);

  return makeEnvelope({
    engine: "recurring_discovery",
    facts: {
      monthly_committed: monthlyCommitted,
      subscriptions_count: found.length,
      missing_count: found.filter((f) => f.missing).length,
      price_jump_count: found.filter((f) => f.price_jump).length,
      biggest: found[0] ? { label: found[0].label, monthly_equivalent: found[0].monthly_equivalent } : null,
    },
    breakdown: found,
    drivers,
    evidence: makeEvidence({
      period: input.period,
      sampleSize,
      formulaVersion: RECURRING_DISCOVERY_VERSION,
      notes: [
        "Recorrência detectada por cadência e valor estáveis no histórico — não é cadastro manual.",
        "Cobrança marcada como ausente considera a data esperada mais uma tolerância de dias.",
      ],
    }),
    confidence: confidenceFromSample(sampleSize, { minSample: 8, goodSample: 40 }),
  });
}
