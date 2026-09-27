// ActionSlotResolver (`nino_conversation_brain.v2`)
// Deterministic binding for ActionIR slots. The LLM preserves human temporal
// expressions; this module turns them into executable fields without inventing.

import type { ActionIR } from "./ActionIR.ts";
import { isValidCalendarDate, todaySaoPaulo } from "../parser.ts";

const MONTHS: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function resolveTargetDateExpression(expression: unknown, now: Date = new Date()): string | null {
  const raw = String(expression ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  const iso = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso && isValidCalendarDate(iso)) return iso;

  const br = lower.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (br) {
    const candidate = `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
    return isValidCalendarDate(candidate) ? candidate : null;
  }

  const current = todaySaoPaulo(now);
  const [year, currentMonth] = current.split("-").map(Number);
  if (/\b(fim|final)\s+(?:deste|desse|do)\s+ano\b/i.test(raw)
    || /\bat[eé]\s+(?:o\s+)?(?:fim|final)\s+do\s+ano\b/i.test(raw)) {
    return `${year}-12-31`;
  }

  const monthName = Object.keys(MONTHS).find((name) => new RegExp(`\\b${name}\\b`, "i").test(lower));
  if (monthName) {
    const month = MONTHS[monthName];
    const explicitYear = Number(lower.match(/\b(20\d{2})\b/)?.[1] ?? 0);
    const targetYear = explicitYear || (month < currentMonth ? year + 1 : year);
    const dd = String(lastDay(targetYear, month)).padStart(2, "0");
    return `${targetYear}-${String(month).padStart(2, "0")}-${dd}`;
  }
  return null;
}

function normalizeTransactionSlots(slots: Record<string, unknown>): void {
  // Semantic V3 speaks in human concepts; the draft tool speaks in canonical
  // persistence names. This translation is deterministic and carries no new meaning.
  if (slots.description == null && slots.merchant != null) slots.description = slots.merchant;
  if (slots.occurred_at == null && slots.date != null) slots.occurred_at = slots.date;

  const account = String(slots.account ?? "").trim();
  const payment = String(slots.payment_method ?? "").toLowerCase();
  if (slots.credit_card == null && (payment === "credit_card" || /\bcart[aã]o\b/i.test(account))) {
    if (account) slots.credit_card = account.replace(/^cart[aã]o\s*/i, "").trim() || account;
    delete slots.account;
    slots.payment_method = "credit_card";
  }
  if (slots.credit_card != null) slots.payment_method = "credit_card";
}

export function bindActionSlots(ir: ActionIR, now: Date = new Date()): Record<string, unknown> {
  const slots: Record<string, unknown> = { ...(ir.slots ?? {}) };

  if (ir.action.startsWith("transaction.")) normalizeTransactionSlots(slots);

  if (ir.action === "goal.create" || ir.action === "goal.update") {
    if (slots.target_amount == null && slots.amount != null) slots.target_amount = slots.amount;
    if (!slots.target_date && slots.target_date_expression) {
      const resolved = resolveTargetDateExpression(slots.target_date_expression, now);
      if (resolved) slots.target_date = resolved;
    }
    delete slots.target_date_expression;
  }

  if (ir.action === "debt.create" && slots.original_amount == null && slots.amount != null) {
    slots.original_amount = slots.amount;
  }

  if (ir.action === "debt.pay" && slots.paid_at == null && slots.date != null) slots.paid_at = slots.date;
  if (ir.action === "split.receive" && slots.paid_at == null && slots.date != null) slots.paid_at = slots.date;

  if (ir.action.startsWith("recurring.")) {
    if (slots.day_of_month == null && slots.day != null) slots.day_of_month = slots.day;
    if (slots.frequency == null && slots.day_of_month != null) slots.frequency = "monthly";
  }

  return slots;
}
