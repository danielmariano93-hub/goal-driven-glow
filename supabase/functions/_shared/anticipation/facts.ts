// anticipation_contract.v1 — camada de fatos comportamentais.
// Funções puras: entram lançamentos canônicos, saem fatos por lançamento, por
// dia e por ciclo. Toda a classificação financeira (transferência, pagamento
// de fatura, investimento, estorno) reusa `finance-core/facts.ts`.

import {
  EXCLUDED_MOVEMENT_KINDS,
  isExternalTransfer,
  round2,
  type TransactionRow,
} from "../finance-core/facts.ts";
import {
  ANTICIPATION_FORMULA_VERSION,
  type BehavioralClass,
  type CycleFact,
  type DailyFact,
  type MonthPhase,
  type OccurredAtPrecision,
  type TransactionFact,
} from "./contracts.ts";

export type AnticipationTxRow = TransactionRow & {
  occurred_at_time?: string | null;
  occurred_at_timezone?: string | null;
  occurred_at_precision?: string | null;
  category_source?: string | null;
  category_confidence?: number | null;
};

const SMALL_SPEND_CEILING = 50;

const ADJUSTABLE_HINTS = [
  "alimenta", "restaurante", "delivery", "ifood", "lanche", "bar", "mercado",
  "lazer", "entretenimento", "streaming", "viagem", "compras", "vestu",
  "presente", "beleza", "transporte", "uber", "app de", "combust", "pet",
];
const FIXED_HINTS = [
  "aluguel", "condom", "energia", "luz", "agua", "água", "internet", "telefone",
  "escola", "faculdade", "mensalidade", "plano de saude", "plano de saúde",
  "seguro", "assinatura", "financiamento", "presta", "imposto", "iptu", "ipva",
];
const FOOD_HINTS = ["aliment", "mercado", "restaurante", "delivery", "ifood", "lanche", "padaria"];
const LEISURE_HINTS = ["lazer", "entretenimento", "streaming", "bar", "viagem", "cinema", "jogo"];

function norm(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function hits(name: string, hintList: string[]): boolean {
  const n = norm(name);
  return hintList.some((hint) => n.includes(norm(hint)));
}

export function monthPhaseOf(dateStr: string): MonthPhase {
  const day = Number(dateStr.slice(8, 10));
  if (day <= 10) return "inicio";
  if (day <= 20) return "meio";
  return "fim";
}

/** Segunda-feira da semana (ISO) em formato YYYY-MM-DD, sem timezone. */
export function weekStartOf(dateStr: string): string {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const shift = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - shift);
  return date.toISOString().slice(0, 10);
}

export function weekdayOf(dateStr: string): number {
  const [y, m, d] = dateStr.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function normalizeMerchant(description: string | null | undefined): string | null {
  const cleaned = norm(description)
    .replace(/\b(compra|pagamento|debito|credito|pix|ted|doc|de|em|no|na|para)\b/g, " ")
    .replace(/\d+/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 3 ? cleaned : null;
}

function precisionOf(row: AnticipationTxRow): OccurredAtPrecision {
  const raw = String(row.occurred_at_precision ?? "day");
  return raw === "hour" || raw === "minute" ? raw : "day";
}

export type FactBuildInput = {
  userId: string;
  txs: AnticipationTxRow[];
  categories?: Array<{ id: string; name: string }>;
  cardCycleOf?: (row: AnticipationTxRow) => { cycleId: string; cycleDay: number } | null;
  sourceSnapshotId?: string | null;
};

/**
 * Um fato por lançamento. Lançamentos que não representam consumo real
 * (transferência interna, aplicação/resgate, pagamento de fatura, principal de
 * dívida, saldo inicial, planejado não ocorrido) entram marcados como
 * `excluded` — ficam auditáveis mas não alimentam padrão nenhum.
 */
export function buildTransactionFacts(input: FactBuildInput): TransactionFact[] {
  const categoryNames = new Map((input.categories ?? []).map((c) => [c.id, c.name]));
  const out: TransactionFact[] = [];

  for (const row of input.txs) {
    const localDate = String(row.occurred_at).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate)) continue;

    const movementKind = String(row.movement_kind ?? "transaction");
    const isTransfer = row.type === "transfer" || isExternalTransfer(row) || Boolean(row.transfer_group_id);
    const isCardPayment = Boolean(row.settles_card_id) || movementKind === "card_payment";
    const isDebtPrincipal = movementKind === "debt_principal";
    const isRefund = movementKind === "refund";
    const isPlanned = row.status !== "confirmed";
    const excludedKind = EXCLUDED_MOVEMENT_KINDS.has(movementKind);

    const categoryName = row.category_id ? (categoryNames.get(row.category_id) ?? null) : null;
    const isFixed = hits(categoryName ?? "", FIXED_HINTS);
    const isAdjustableCategory = hits(categoryName ?? "", ADJUSTABLE_HINTS);

    let behavioralClass: BehavioralClass = "excluded";
    if (!excludedKind && !isTransfer && !isCardPayment && !isDebtPrincipal && !isPlanned) {
      if (row.type === "income") behavioralClass = "income";
      else if (row.type === "expense") {
        behavioralClass = isFixed ? "consumption_fixed" : "consumption_adjustable";
      }
    }

    const isConsumption = behavioralClass === "consumption_adjustable" || behavioralClass === "consumption_fixed";
    const gross = Math.abs(Number(row.amount ?? 0));
    const net = isRefund ? -gross : gross;
    const cycle = input.cardCycleOf?.(row) ?? null;

    out.push({
      user_id: input.userId,
      transaction_id: row.id,
      formula_version: ANTICIPATION_FORMULA_VERSION,
      local_date: localDate,
      local_time: row.occurred_at_time ? String(row.occurred_at_time).slice(0, 8) : null,
      occurred_at_precision: precisionOf(row),
      weekday: weekdayOf(localDate),
      week_start: weekStartOf(localDate),
      month_phase: monthPhaseOf(localDate),
      card_cycle_id: cycle?.cycleId ?? null,
      card_cycle_day: cycle?.cycleDay ?? null,
      category_id: row.category_id ?? null,
      category_name: categoryName,
      category_confidence: Number(row.category_confidence ?? (row.category_id ? 1 : 0)),
      merchant_normalized: normalizeMerchant(row.description),
      merchant_canonical: normalizeMerchant(row.description),
      movement_kind: movementKind,
      behavioral_class: behavioralClass,
      amount_gross: round2(gross),
      amount_net: round2(net),
      is_consumption: isConsumption,
      is_adjustable: behavioralClass === "consumption_adjustable" && (isAdjustableCategory || !row.category_id),
      is_fixed: behavioralClass === "consumption_fixed",
      is_exceptional: false,
      is_planned: isPlanned,
      is_refund: isRefund,
      is_transfer: isTransfer,
      is_card_payment: isCardPayment,
      is_debt_principal: isDebtPrincipal,
      data_confidence: row.category_id ? 1 : 0.6,
      source_snapshot_id: input.sourceSnapshotId ?? null,
    });
  }

  return out;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Limite superior de normalidade (Tukey) usado para marcar dias extraordinários. */
export function exceptionalThreshold(values: number[]): number {
  const sorted = values.filter((v) => v > 0).slice().sort((a, b) => a - b);
  if (sorted.length < 6) return Number.POSITIVE_INFINITY;
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  return q3 + 1.5 * (q3 - q1);
}

export type DailyAggregateOptions = {
  paydayDays?: number[];
  holidays?: string[];
};

export function aggregateDailyFacts(
  facts: TransactionFact[],
  opts: DailyAggregateOptions = {},
): DailyFact[] {
  const paydays = new Set(opts.paydayDays ?? [1, 2, 3, 4, 5, 15, 16, 17, 30, 31]);
  const holidays = new Set(opts.holidays ?? []);
  const byDate = new Map<string, DailyFact>();

  for (const fact of facts) {
    let day = byDate.get(fact.local_date);
    if (!day) {
      day = {
        user_id: fact.user_id,
        local_date: fact.local_date,
        formula_version: ANTICIPATION_FORMULA_VERSION,
        weekday: fact.weekday,
        week_start: fact.week_start,
        month_phase: fact.month_phase,
        total_consumption: 0,
        total_adjustable: 0,
        total_fixed: 0,
        total_card: 0,
        total_food: 0,
        total_leisure: 0,
        total_small_spend: 0,
        small_spend_count: 0,
        entries_count: 0,
        categorization_coverage: 0,
        amount_uncategorized: 0,
        is_payday_window: paydays.has(Number(fact.local_date.slice(8, 10))),
        is_holiday: holidays.has(fact.local_date),
        is_exceptional_day: false,
        data_confidence: 1,
      };
      byDate.set(fact.local_date, day);
    }

    if (fact.behavioral_class === "excluded") continue;
    day.entries_count += 1;
    if (!fact.category_id) day.amount_uncategorized = round2(day.amount_uncategorized + fact.amount_net);
    if (!fact.is_consumption) continue;

    day.total_consumption = round2(day.total_consumption + fact.amount_net);
    if (fact.is_adjustable) day.total_adjustable = round2(day.total_adjustable + fact.amount_net);
    if (fact.is_fixed) day.total_fixed = round2(day.total_fixed + fact.amount_net);
    if (fact.card_cycle_id || fact.movement_kind === "card_purchase") {
      day.total_card = round2(day.total_card + fact.amount_net);
    }
    if (hits(fact.category_name ?? "", FOOD_HINTS)) day.total_food = round2(day.total_food + fact.amount_net);
    if (hits(fact.category_name ?? "", LEISURE_HINTS)) day.total_leisure = round2(day.total_leisure + fact.amount_net);
    if (fact.amount_net > 0 && fact.amount_net <= SMALL_SPEND_CEILING) {
      day.total_small_spend = round2(day.total_small_spend + fact.amount_net);
      day.small_spend_count += 1;
    }
  }

  const days = [...byDate.values()];
  const threshold = exceptionalThreshold(days.map((d) => d.total_consumption));
  for (const day of days) {
    day.is_exceptional_day = day.total_consumption > threshold;
    const total = day.total_consumption + Math.abs(day.amount_uncategorized);
    day.categorization_coverage = total > 0
      ? round2(Math.max(0, 1 - Math.abs(day.amount_uncategorized) / total))
      : 1;
    day.data_confidence = day.categorization_coverage;
  }
  return days.sort((a, b) => a.local_date.localeCompare(b.local_date));
}

export function aggregateCycleFacts(days: DailyFact[]): CycleFact[] {
  const groups = new Map<string, CycleFact>();
  const push = (kind: CycleFact["cycle_kind"], key: string, day: DailyFact) => {
    const id = `${kind}:${key}`;
    let row = groups.get(id);
    if (!row) {
      row = {
        user_id: day.user_id,
        cycle_kind: kind,
        cycle_key: key,
        period_start: day.local_date,
        period_end: day.local_date,
        formula_version: ANTICIPATION_FORMULA_VERSION,
        total_consumption: 0,
        total_adjustable: 0,
        total_fixed: 0,
        total_card: 0,
        entries_count: 0,
        days_covered: 0,
        metrics: {},
        data_confidence: 1,
      };
      groups.set(id, row);
    }
    if (day.local_date < row.period_start) row.period_start = day.local_date;
    if (day.local_date > row.period_end) row.period_end = day.local_date;
    row.total_consumption = round2(row.total_consumption + day.total_consumption);
    row.total_adjustable = round2(row.total_adjustable + day.total_adjustable);
    row.total_fixed = round2(row.total_fixed + day.total_fixed);
    row.total_card = round2(row.total_card + day.total_card);
    row.entries_count += day.entries_count;
    row.days_covered += 1;
    row.metrics.small_spend = round2((row.metrics.small_spend ?? 0) + day.total_small_spend);
    row.metrics.small_spend_count = (row.metrics.small_spend_count ?? 0) + day.small_spend_count;
    row.data_confidence = Math.min(row.data_confidence, day.data_confidence);
  };

  for (const day of days) {
    push("week", day.week_start, day);
    push("month", day.local_date.slice(0, 7), day);
    if (day.is_payday_window) push("payday_window", `${day.local_date.slice(0, 7)}:${day.month_phase}`, day);
  }
  return [...groups.values()];
}
