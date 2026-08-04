// anticipation_contract.v2 — detector determinístico `upcoming_cash_pressure`.
//
// Regra: olhar apenas COMPROMISSOS REAIS já registrados (faturas de cartão a
// vencer, parcelas, ocorrências recorrentes planejadas e lançamentos futuros
// com status `planned`) até a próxima entrada de dinheiro prevista e comparar
// com o caixa disponível de hoje. Nenhuma projeção estatística, nenhuma
// fórmula financeira nova: só soma de compromissos versus caixa.

import { round2 } from "../finance-core/facts.ts";
import {
  ANTICIPATION_FORMULA_VERSION,
  type BehavioralPattern,
  type DetectorConfig,
} from "./contracts.ts";

export type Commitment = {
  kind: "card_statement" | "installment" | "recurring" | "planned_expense" | "debt_payment";
  label: string;
  due_date: string; // YYYY-MM-DD
  amount: number; // positivo = saída de caixa
  source_id?: string | null;
};

export type ExpectedIncome = {
  date: string; // YYYY-MM-DD
  amount: number;
  label: string;
};

export type CashPressureInput = {
  userId: string;
  todayIso: string;
  availableCash: number;
  commitments: Commitment[];
  nextIncome: ExpectedIncome | null;
  /** Dias de horizonte quando não há entrada prevista conhecida. */
  fallbackHorizonDays?: number;
  coverage: number;
  config: DetectorConfig;
};

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Retorna o padrão de pressão de caixa quando existe déficit material antes da
 * próxima entrada. Retorna `null` quando não há risco ou faltam dados.
 */
export function detectCashPressure(input: CashPressureInput): BehavioralPattern | null {
  const { config } = input;
  const horizonEnd = input.nextIncome?.date
    ? input.nextIncome.date.slice(0, 10)
    : addDays(input.todayIso, input.fallbackHorizonDays ?? 14);
  if (horizonEnd <= input.todayIso) return null;

  const inWindow = input.commitments
    .filter((c) => {
      const due = c.due_date.slice(0, 10);
      return due >= input.todayIso && due <= horizonEnd && Number.isFinite(c.amount) && c.amount > 0;
    })
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  if (inWindow.length === 0) return null;

  const totalCommitted = round2(inWindow.reduce((sum, c) => sum + c.amount, 0));
  const cash = round2(input.availableCash);
  const deficit = round2(totalCommitted - cash);

  if (deficit < Math.max(config.min_absolute_delta, 1)) return null;

  // Confiança: quantidade e diversidade de compromissos + cobertura de dados.
  const kinds = new Set(inWindow.map((c) => c.kind)).size;
  const confidence = round2(Math.min(
    0.95,
    0.55 + Math.min(0.2, inWindow.length * 0.04) + Math.min(0.1, kinds * 0.05) + Math.min(0.1, input.coverage * 0.1),
  ));
  if (confidence < config.min_confidence) return null;

  const firstBreach = (() => {
    let running = cash;
    for (const c of inWindow) {
      running = round2(running - c.amount);
      if (running < 0) return { date: c.due_date.slice(0, 10), label: c.label, running };
    }
    return null;
  })();

  const label = input.nextIncome
    ? `Compromissos acima do caixa antes da próxima entrada (${input.nextIncome.label})`
    : "Compromissos acima do caixa nos próximos dias";

  return {
    user_id: input.userId,
    detector: "upcoming_cash_pressure",
    pattern_key: `cash_pressure:${horizonEnd}`,
    label,
    status: "validated",
    sample_size: inWindow.length,
    window_start: input.todayIso,
    window_end: horizonEnd,
    baseline_value: cash,
    pattern_value: totalCommitted,
    uplift_pct: cash > 0 ? round2((deficit / cash) * 100) : 100,
    absolute_delta: deficit,
    hit_rate: 1,
    consistency: 1,
    confidence,
    data_coverage: round2(input.coverage),
    evidence: {
      horizon_end: horizonEnd,
      available_cash: cash,
      total_committed: totalCommitted,
      deficit,
      commitments_count: inWindow.length,
      commitment_kinds: [...new Set(inWindow.map((c) => c.kind))],
      next_income: input.nextIncome,
      first_breach: firstBreach,
      top_commitments: inWindow.slice(0, 5).map((c) => ({
        kind: c.kind,
        label: c.label,
        due_date: c.due_date.slice(0, 10),
        amount: round2(c.amount),
      })),
    },
    exclusions: ["transferências internas", "lançamentos já pagos", "estornos"],
    formula_version: ANTICIPATION_FORMULA_VERSION,
    detector_version: "v2",
  };
}
