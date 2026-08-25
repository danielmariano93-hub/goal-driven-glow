// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Motor de Anomalias Personalizadas (`anomaly_engine.v1`).
// "Isso não é normal PARA VOCÊ": banda pessoal por estabelecimento, categoria e
// semana usando mediana + MAD (robusto a outliers). Puro e determinístico.
import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  isRealMonthlyMovement,
  round2,
  type TransactionRow,
} from "./facts.ts";
import { buildMerchantResolver, type MerchantAliasRow, type MerchantResolver } from "./merchant.ts";
import {
  confidenceFromSample,
  daysBetweenInclusive,
  madOf,
  makeEnvelope,
  makeEvidence,
  medianOf,
  shiftDays,
  type EngineEnvelope,
  type EnginePeriod,
} from "./engineEnvelope.ts";

export const ANOMALY_ENGINE_VERSION = "anomaly_engine.v1";

const BRL = (value: number): string =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value || 0));

export type AnomalyScope = "merchant_week" | "category_week" | "ticket" | "record";

export interface Anomaly {
  scope: AnomalyScope;
  label: string;
  /** Valor observado no período atual. */
  observed: number;
  /** Faixa habitual (mediana ± 1,5 MAD, nunca negativa). */
  usual_low: number;
  usual_high: number;
  typical: number;
  deviation_abs: number;
  deviation_ratio: number | null;
  sample_size: number;
  severity: "info" | "attention" | "critical";
  reference: string | null;
  detail: string;
}

export interface AnomalyFacts {
  anomalies_count: number;
  top: Anomaly | null;
  weeks_analyzed: number;
}

export interface AnomalyInput {
  txs: TransactionRow[];
  /** Semana (ou período curto) sob análise. */
  period: EnginePeriod;
  /** Histórico usado para construir a banda pessoal. */
  history: EnginePeriod;
  categoryNames?: Record<string, string>;
  aliases?: MerchantAliasRow[];
  resolver?: MerchantResolver;
  minSample?: number;
}

function inRange(date: string, period: EnginePeriod): boolean {
  const d = date.slice(0, 10);
  return d >= period.from && d <= period.to;
}

/** Chave de semana (segunda-feira como início) para agrupar histórico. */
function weekKey(date: string): string {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const dow = (dt.getUTCDay() + 6) % 7; // 0 = segunda
  return shiftDays(date.slice(0, 10), -dow);
}

function band(values: number[]): { low: number; high: number; typical: number } {
  const typical = round2(medianOf(values));
  const mad = madOf(values);
  const spread = mad > 0 ? mad * 1.5 : typical * 0.25;
  return {
    low: round2(Math.max(0, typical - spread)),
    high: round2(typical + spread),
    typical,
  };
}

function severityOf(observed: number, high: number, deviationAbs: number): Anomaly["severity"] {
  if (high <= 0) return "info";
  const ratio = observed / high;
  if (ratio >= 2 && deviationAbs >= 100) return "critical";
  if (ratio >= 1.4 || deviationAbs >= 80) return "attention";
  return "info";
}

/**
 * Detecta o que está fora do padrão pessoal no período, comparando com a banda
 * habitual construída no histórico.
 */
export function detectAnomalies(input: AnomalyInput): EngineEnvelope<AnomalyFacts, Anomaly, Anomaly> {
  const resolver = input.resolver ?? buildMerchantResolver(input.aliases ?? []);
  const names = input.categoryNames ?? {};
  const attribution = buildRefundAttribution(input.txs);
  const minSample = input.minSample ?? 4;

  const historyMerchantWeeks = new Map<string, Map<string, number>>();
  const historyCategoryWeeks = new Map<string, Map<string, number>>();
  const historyTickets = new Map<string, number[]>();
  const currentMerchant = new Map<string, { label: string; total: number; count: number }>();
  const currentCategory = new Map<string, number>();
  const currentTickets: Array<{ key: string; label: string; amount: number; date: string }> = [];
  let sampleSize = 0;

  const merchantLabels = new Map<string, string>();

  for (const t of input.txs) {
    if (t.type !== "expense" || !isRealMonthlyMovement(t)) continue;
    const signed = behavioralMetricAmount(t, "expense");
    if (signed <= 0) continue;
    const date = t.occurred_at.slice(0, 10);
    const amount = round2(signed);
    const resolution = resolver.resolve(t.description);
    const merchantKey = resolution?.key ?? null;
    if (resolution) merchantLabels.set(resolution.key, resolution.label);
    const categoryId = effectiveCategoryId(t, attribution);
    const categoryName = categoryId ? (names[categoryId] ?? "Categoria removida") : "Sem categoria";

    if (inRange(date, input.period)) {
      sampleSize += 1;
      if (merchantKey) {
        const acc = currentMerchant.get(merchantKey) ?? { label: resolution!.label, total: 0, count: 0 };
        acc.total = round2(acc.total + amount);
        acc.count += 1;
        currentMerchant.set(merchantKey, acc);
        currentTickets.push({ key: merchantKey, label: resolution!.label, amount, date });
      }
      currentCategory.set(categoryName, round2((currentCategory.get(categoryName) ?? 0) + amount));
      continue;
    }

    if (!inRange(date, input.history)) continue;
    const wk = weekKey(date);
    if (merchantKey) {
      const weeks = historyMerchantWeeks.get(merchantKey) ?? new Map<string, number>();
      weeks.set(wk, round2((weeks.get(wk) ?? 0) + amount));
      historyMerchantWeeks.set(merchantKey, weeks);
      const tickets = historyTickets.get(merchantKey) ?? [];
      tickets.push(amount);
      historyTickets.set(merchantKey, tickets);
    }
    const catWeeks = historyCategoryWeeks.get(categoryName) ?? new Map<string, number>();
    catWeeks.set(wk, round2((catWeeks.get(wk) ?? 0) + amount));
    historyCategoryWeeks.set(categoryName, catWeeks);
  }

  const anomalies: Anomaly[] = [];

  for (const [key, cur] of currentMerchant) {
    const weeks = historyMerchantWeeks.get(key);
    if (!weeks || weeks.size < minSample) continue;
    const values = [...weeks.values()];
    const b = band(values);
    if (cur.total <= b.high) continue;
    const deviation = round2(cur.total - b.high);
    anomalies.push({
      scope: "merchant_week",
      label: cur.label,
      observed: cur.total,
      usual_low: b.low,
      usual_high: b.high,
      typical: b.typical,
      deviation_abs: deviation,
      deviation_ratio: b.typical > 0 ? round2(cur.total / b.typical) : null,
      sample_size: weeks.size,
      severity: severityOf(cur.total, b.high, deviation),
      reference: null,
      detail: `${cur.label} ficou acima do seu padrão semanal: ${BRL(cur.total)} agora, contra até ${BRL(b.high)} normalmente.`,
    });
  }

  for (const [name, total] of currentCategory) {
    const weeks = historyCategoryWeeks.get(name);
    if (!weeks || weeks.size < minSample) continue;
    const b = band([...weeks.values()]);
    if (total <= b.high) continue;
    const deviation = round2(total - b.high);
    anomalies.push({
      scope: "category_week",
      label: name,
      observed: total,
      usual_low: b.low,
      usual_high: b.high,
      typical: b.typical,
      deviation_abs: deviation,
      deviation_ratio: b.typical > 0 ? round2(total / b.typical) : null,
      sample_size: weeks.size,
      severity: severityOf(total, b.high, deviation),
      reference: null,
      detail: `${name} ficou acima do seu padrão semanal: ${BRL(total)} agora, contra até ${BRL(b.high)} normalmente.`,
    });
  }

  // Recordes e tickets fora da faixa histórica do próprio estabelecimento.
  const historyMonths = Math.max(1, Math.round(daysBetweenInclusive(input.history.from, input.history.to) / 30));
  for (const ticket of currentTickets) {
    const tickets = historyTickets.get(ticket.key);
    if (!tickets || tickets.length < minSample) continue;
    const b = band(tickets);
    const maxHistoric = Math.max(...tickets);
    if (ticket.amount > maxHistoric) {
      anomalies.push({
        scope: "record",
        label: ticket.label,
        observed: ticket.amount,
        usual_low: b.low,
        usual_high: b.high,
        typical: b.typical,
        deviation_abs: round2(ticket.amount - maxHistoric),
        deviation_ratio: b.typical > 0 ? round2(ticket.amount / b.typical) : null,
        sample_size: tickets.length,
        severity: severityOf(ticket.amount, b.high, round2(ticket.amount - maxHistoric)),
        reference: ticket.date,
        detail: `${ticket.label} teve sua maior compra dos últimos ${historyMonths} meses: ${BRL(ticket.amount)}. Antes, o maior valor era ${BRL(maxHistoric)}.`,
      });
      continue;
    }
    if (ticket.amount > b.high) {
      anomalies.push({
        scope: "ticket",
        label: ticket.label,
        observed: ticket.amount,
        usual_low: b.low,
        usual_high: b.high,
        typical: b.typical,
        deviation_abs: round2(ticket.amount - b.high),
        deviation_ratio: b.typical > 0 ? round2(ticket.amount / b.typical) : null,
        sample_size: tickets.length,
        severity: severityOf(ticket.amount, b.high, round2(ticket.amount - b.high)),
        reference: ticket.date,
        detail: `${ticket.label} ficou acima do seu padrão: ${BRL(ticket.amount)} agora, contra até ${BRL(b.high)} normalmente.`,
      });
    }
  }

  const severityRank = { critical: 0, attention: 1, info: 2 } as const;
  anomalies.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || b.deviation_abs - a.deviation_abs,
  );

  const weeksAnalyzed = new Set<string>();
  for (const weeks of historyCategoryWeeks.values()) for (const k of weeks.keys()) weeksAnalyzed.add(k);

  return makeEnvelope({
    engine: "anomaly_engine",
    facts: {
      anomalies_count: anomalies.length,
      top: anomalies[0] ?? null,
      weeks_analyzed: weeksAnalyzed.size,
    },
    breakdown: anomalies.slice(0, 8),
    drivers: anomalies.slice(0, 3),
    evidence: makeEvidence({
      period: input.period,
      comparisonPeriod: input.history,
      sampleSize,
      formulaVersion: ANOMALY_ENGINE_VERSION,
      notes: [
        "Faixa habitual = mediana ± 1,5 desvio absoluto mediano do próprio histórico.",
        `Só avalia grupos com pelo menos ${minSample} semanas/ocorrências de histórico.`,
      ],
    }),
    confidence: confidenceFromSample(weeksAnalyzed.size, { minSample: 4, goodSample: 10 }),
  });
}
