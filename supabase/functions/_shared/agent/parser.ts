// Deterministic Portuguese-BR interpreter for financial short-messages.
// Used both as a fallback when the LLM is not configured and as the parser
// invoked from tests. Never invents accounts/categories — those are resolved
// server-side by the orchestrator using the user's own data.

import { parseSpelledMoney } from "./amountWords.ts";
import { allowsEntryDraft } from "./core/HypotheticalGuard.ts";
import { classifyConfirmationAct } from "./core/ConfirmationVocabulary.ts";
import { isExplicitRepair } from "./core/ConversationRepair.ts";

export type ParsedIntent =
  | { kind: "transaction"; type: "expense" | "income"; amount: number; occurred_at: string; description?: string; category_hint?: string; account_hint?: string }
  | { kind: "transfer"; amount: number; occurred_at: string; from_hint?: string; to_hint?: string }
  | { kind: "goal_contribution"; amount: number; occurred_at: string; goal_hint?: string }
  | { kind: "goal"; name: string; target_amount: number; target_date?: string }
  | { kind: "query"; topic: "summary" | "recent" | "before_spending"; description?: string; amount?: number }
  | { kind: "confirm" }
  | { kind: "cancel" }
  | { kind: "unknown"; text: string };

export function parseBrAmount(raw: string): number | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^r\$\s*/i, "");
  s = s.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) s = s.replace(/\./g, "").replace(",", ".");
  else if (hasComma) s = s.replace(",", ".");
  else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

export const SCALE_SUFFIX_RX = /^\s*(?:reais?\s+)?(mil|milh(?:o|õ)es|milh(?:a|ã)o|mi|k)\b/i;

export function scaleAfter(text: string): { factor: number; consumed: number } {
  const m = String(text ?? "").match(SCALE_SUFFIX_RX);
  if (!m) return { factor: 1, consumed: 0 };
  const token = m[1].toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return { factor: token === "mil" || token === "k" ? 1_000 : 1_000_000, consumed: m[0].length };
}

export function parseBrAmountWithScale(raw: string, trailing: string): number | null {
  const base = parseBrAmount(raw);
  if (base == null) return null;
  const { factor } = scaleAfter(trailing);
  return Math.round(base * factor * 100) / 100;
}

export function todaySaoPaulo(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

export function isValidCalendarDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? "")) return false;
  const [y, m, d] = iso.split("-").map(Number);
  if (y < 1970 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function shiftSaoPaulo(baseIso: string, days: number): string {
  const [Y, M, D] = baseIso.split("-").map(Number);
  const dt = new Date(Date.UTC(Y, M - 1, D + days, 12, 0, 0));
  return todaySaoPaulo(dt);
}

export function resolveRelativeDate(text: string, now: Date = new Date()): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const today = todaySaoPaulo(now);
  if (/\banteontem\b/.test(t)) return shiftSaoPaulo(today, -2);
  if (/\bontem\b/.test(t)) return shiftSaoPaulo(today, -1);
  if (/\bhoje\b|\bagora\b/.test(t)) return today;
  return null;
}

export function resolveOccurredAt(input: { text?: string; modelValue?: string | null; now?: Date }): { iso: string; source: "relative" | "model" | "today"; note?: string } {
  const now = input.now ?? new Date();
  const today = todaySaoPaulo(now);
  const rel = resolveRelativeDate(input.text ?? "", now);
  if (rel) return { iso: rel, source: "relative" };
  const mv = String(input.modelValue ?? "");
  if (isValidCalendarDate(mv)) {
    const explicit = /\b\d{4}-\d{2}-\d{2}\b/.test(input.text ?? "");
    const [Y1, M1, D1] = today.split("-").map(Number);
    const [Y2, M2, D2] = mv.split("-").map(Number);
    const t0 = Date.UTC(Y1, M1 - 1, D1);
    const tv = Date.UTC(Y2, M2 - 1, D2);
    const diffDays = Math.round((t0 - tv) / 86400000);
    if (tv > t0) return { iso: today, source: "today", note: "future_rejected" };
    if (diffDays > 370 && !explicit) return { iso: today, source: "today", note: "too_old_rejected" };
    return { iso: mv, source: "model" };
  }
  return { iso: today, source: "today" };
}

function relativeDate(text: string, now: Date = new Date()): string {
  const today = todaySaoPaulo(now);
  if (/\bhoje\b/.test(text)) return today;
  if (/\bontem\b/.test(text)) return shiftSaoPaulo(today, -1);
  if (/\banteontem\b/.test(text)) return shiftSaoPaulo(today, -2);
  return today;
}

const CONFIRM_WORDS = /^\s*(confirm(?:o|a|ar|ado|ada|amos)?|sim|ok|okay|yes|isso|👍)\s*[.!]?\s*$/i;
const CANCEL_WORDS = /^\s*(cancelar|cancela|não|nao|no|❌)\s*[.!]?\s*$/i;
const CONFIRM_LOOSE = /^\s*(sim|pode|confirm(?:o|a|ar|ado|amos)?|ok|okay|beleza|blz|manda|vai|positivo|claro|yes|👍|isso\s+mesmo)\b/i;
const CANCEL_LOOSE = /^\s*(cancela(?:r)?|negativo|deixa|esquece|no|❌)\b/i;
const EXPLICIT_CANCEL_RX = /^\s*(?:(?:não|nao)\s*[,;:-]?\s*)?(?:cancela(?:r)?\b|deixa\s+pra\s+l[aá]\b|esquece(?:\s+isso)?\b)/i;
const AMOUNT_RE = /(?:r\$\s*)?(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i;

function isGoalCreateIntent(text: string): boolean {
  const t = String(text ?? "").toLowerCase();
  if (/\?\s*$/.test(text.trim()) || /^\s*(como|quanto|qual|quais|por que|porque)\b/i.test(text)) return false;
  return /\b(cria|crie|criar|monta|monte|montar|define|defina|definir|estabelece|estabeleca|quero criar|preciso criar|faz|faca|fazer)\b.{0,70}\b(meta|objetivo)\b/i.test(t);
}

function isGoalContributionIntent(text: string): boolean {
  return /\b(guardei|poupei|separei|aport(?:ei|e))\b.*\b(meta|objetivo|reserva|para )/i.test(text);
}

function isGoalDiscussion(text: string): boolean {
  return /\b(meta|objetivo)\b/i.test(text) && !isGoalContributionIntent(text);
}

function goalTargetDate(text: string, now: Date): string | undefined {
  const raw = String(text ?? "");
  const lower = raw.toLowerCase();
  const iso = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso && isValidCalendarDate(iso)) return iso;
  const br = lower.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (br) {
    const candidate = `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
    if (isValidCalendarDate(candidate)) return candidate;
  }
  if (/\b(?:at[eé]\s+)?(?:o\s+)?(?:fim|final)\s+(?:deste|desse|do)\s+ano\b/i.test(raw)
    || /\bat[eé]\s+(?:o\s+)?fim\s+do\s+ano\b/i.test(raw)) return `${todaySaoPaulo(now).slice(0, 4)}-12-31`;
  return undefined;
}

function goalName(amount: number, text: string): string {
  const value = amount.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  if (/\bjuntar\b/i.test(text)) return `Juntar R$ ${value}`;
  if (/\b(?:guardar|economizar|poupar)\b/i.test(text)) return `Guardar R$ ${value}`;
  return `Meta de R$ ${value}`;
}

export function parseStructuredCard(text: string, now: Date = new Date()): Extract<ParsedIntent, { kind: "transaction" }> | null {
  const raw = String(text ?? "");
  if (!raw.trim()) return null;
  const clean = raw.replace(/\*/g, "");
  const field = (labels: string) => {
    const rx = new RegExp(`(?:^|\\n)\\s*(?:[•\\-*·]\\s*)?(?:${labels})\\s*:\\s*(.+)`, "i");
    const m = clean.match(rx);
    return m?.[1]?.trim() || null;
  };
  const expenseRaw = field("despesa|gasto|sa[íi]da|valor");
  const incomeRaw = field("receita|entrada|recebimento");
  const amountRaw = incomeRaw ?? expenseRaw;
  if (!amountRaw) return null;
  const description = field("descri[çc][aã]o|estabelecimento");
  if (!description) return null;
  const digits = amountRaw.match(AMOUNT_RE);
  const amount = digits ? parseBrAmount(digits[1]) : parseSpelledMoney(amountRaw);
  if (amount === null || !(amount > 0)) return null;
  const dateRaw = field("data|quando");
  let occurred_at = relativeDate(String(dateRaw ?? clean).toLowerCase(), now);
  if (dateRaw) {
    const iso = dateRaw.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    const br = dateRaw.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
    if (iso && isValidCalendarDate(iso[1])) occurred_at = iso[1];
    else if (br) {
      const y = br[3] ? (br[3].length === 2 ? `20${br[3]}` : br[3]) : todaySaoPaulo(now).slice(0, 4);
      const candidate = `${y}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
      if (isValidCalendarDate(candidate)) occurred_at = candidate;
    }
  }
  return {
    kind: "transaction",
    type: incomeRaw ? "income" : "expense",
    amount,
    occurred_at,
    description,
    category_hint: field("categoria") ?? undefined,
    account_hint: field("conta|carteira") ?? undefined,
  };
}

export function interpret(text: string, now: Date = new Date()): ParsedIntent {
  const raw = (text ?? "").trim();
  if (!raw) return { kind: "unknown", text: "" };
  const card = parseStructuredCard(raw, now);
  if (card) return card;
  if (CONFIRM_WORDS.test(raw)) return { kind: "confirm" };
  if (CANCEL_WORDS.test(raw)) return { kind: "cancel" };
  if (EXPLICIT_CANCEL_RX.test(raw)) return { kind: "cancel" };
  if (isExplicitRepair(raw)) return { kind: "unknown", text: raw };

  const wordCount = raw.split(/\s+/).length;
  if (wordCount <= 4 && !AMOUNT_RE.test(raw) && parseSpelledMoney(raw) === null) {
    if (CONFIRM_LOOSE.test(raw)) return { kind: "confirm" };
    if (CANCEL_LOOSE.test(raw)) return { kind: "cancel" };
  }
  if (wordCount <= 3 && !AMOUNT_RE.test(raw) && parseSpelledMoney(raw) === null) {
    const act = classifyConfirmationAct(raw);
    if (act === "confirm") return { kind: "confirm" };
    if (act === "cancel") return { kind: "cancel" };
  }

  const lower = raw.toLowerCase();
  const occurred_at = relativeDate(lower, now);
  const amountMatch = lower.match(AMOUNT_RE);
  const amount = amountMatch
    ? parseBrAmountWithScale(amountMatch[1], lower.slice((amountMatch.index ?? 0) + amountMatch[0].length))
    : parseSpelledMoney(lower);

  if (/\b(resumo|saldo|quanto (tenho|gastei)|extrato)\b/.test(lower)) return { kind: "query", topic: "summary" };
  if (/\b(últim|ultim).*\b(transa|lanc|gasto)/.test(lower)) return { kind: "query", topic: "recent" };
  if (/\b(posso gastar|antes de gastar|se eu gastar)\b/.test(lower) && amount !== null) return { kind: "query", topic: "before_spending", amount, description: raw };
  if (amount === null) return { kind: "unknown", text: raw };

  if (isGoalCreateIntent(raw)) return { kind: "goal", name: goalName(amount, raw), target_amount: amount, target_date: goalTargetDate(raw, now) };
  if (isGoalDiscussion(raw)) return { kind: "unknown", text: raw };
  if (!allowsEntryDraft(raw)) return { kind: "unknown", text: raw };

  if (/\btransfer(i|ir|ência|encia|ir)\b/.test(lower)) {
    const from = lower.match(/\b(?:da|de)\s+(?:conta\s+)?([\p{L}\d ._-]+?)\s+para\s+(?:a\s+)?(?:conta\s+)?([\p{L}\d ._-]+?)(?:\s+(?:hoje|ontem|anteontem)|$)/iu);
    return { kind: "transfer", amount, occurred_at, from_hint: from?.[1]?.trim(), to_hint: from?.[2]?.trim() };
  }

  if (isGoalContributionIntent(raw)) {
    const gm = lower.match(/\b(?:meta|objetivo|reserva)\s+([\p{L}\d ._-]+)/iu);
    return { kind: "goal_contribution", amount, occurred_at, goal_hint: gm?.[1]?.trim() };
  }

  const explicitIncome = /\b(recebi|receita|entrada|salário|salario|caiu)\b/.test(lower);
  const explicitExpense = /\b(gastei|paguei|comprei|despesa|saída|saida|custou)\b/.test(lower);
  const type: "expense" | "income" = explicitIncome && !explicitExpense ? "income" : "expense";
  const desc = raw
    .replace(AMOUNT_RE, " ")
    .replace(/\b(hoje|ontem|anteontem)\b/gi, " ")
    .replace(/\b(eu\s+)?(gastei|paguei|comprei|recebi|custou)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
  return { kind: "transaction", type, amount, occurred_at, description: desc || undefined };
}
