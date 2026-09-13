// Deterministic Portuguese-BR interpreter for financial short-messages.
// Used both as a fallback when the LLM is not configured and as the parser
// invoked from tests. Never invents accounts/categories — those are resolved
// server-side by the orchestrator using the user's own data.

import { allowsEntryDraft } from "@/lib/agent/hypothetical";

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

const CONFIRM_WORDS = /^\s*(confirmar|confirma|sim|ok|okay|yes|👍)\s*[.!]?\s*$/i;
const CANCEL_WORDS = /^\s*(cancelar|cancela|não|nao|no|❌)\s*[.!]?\s*$/i;
const CONFIRM_LOOSE = /^\s*(sim|pode|confirma(?:r|do)?|ok|okay|beleza|blz|manda|vai|positivo|claro|yes|👍|isso\s+mesmo)\b/i;
const CANCEL_LOOSE = /^\s*(cancela(?:r)?|negativo|deixa|esquece|no|❌)\b/i;
const AMOUNT_RE = /(?:r\$\s*)?(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i;

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

export function interpret(text: string, now: Date = new Date()): ParsedIntent {
  const raw = (text ?? "").trim();
  if (!raw) return { kind: "unknown", text: "" };
  if (CONFIRM_WORDS.test(raw)) return { kind: "confirm" };
  if (CANCEL_WORDS.test(raw)) return { kind: "cancel" };

  const wordCount = raw.split(/\s+/).length;
  if (wordCount <= 4 && !AMOUNT_RE.test(raw)) {
    if (CONFIRM_LOOSE.test(raw)) return { kind: "confirm" };
    if (CANCEL_LOOSE.test(raw)) return { kind: "cancel" };
  }

  const lower = raw.toLowerCase();
  const occurred_at = relativeDate(lower, now);
  const amountMatch = lower.match(AMOUNT_RE);
  const amount = amountMatch
    ? parseBrAmountWithScale(amountMatch[1], lower.slice((amountMatch.index ?? 0) + amountMatch[0].length))
    : null;

  if (/\b(resumo|saldo|quanto (tenho|gastei)|extrato)\b/.test(lower)) return { kind: "query", topic: "summary" };
  if (/\b(últim|ultim).*\b(transa|lanc|gasto)/.test(lower)) return { kind: "query", topic: "recent" };
  if (/\b(posso gastar|antes de gastar|se eu gastar)\b/.test(lower) && amount !== null) {
    return { kind: "query", topic: "before_spending", amount, description: raw };
  }

  if (amount === null) return { kind: "unknown", text: raw };

  if (isGoalCreateIntent(raw)) {
    return { kind: "goal", name: goalName(amount, raw), target_amount: amount, target_date: goalTargetDate(raw, now) };
  }

  if (isGoalDiscussion(raw)) return { kind: "unknown", text: raw };
  if (!allowsEntryDraft(raw)) return { kind: "unknown", text: raw };

  if (/\btransfer(i|ir|indo|iu)\b/.test(lower) || /\bpassei? .* para\b/.test(lower)) {
    const parts = lower.match(/\bde\s+([\wçãéíáóêô ]+?)\s+para\s+([\wçãéíáóêô ]+)/);
    return { kind: "transfer", amount, occurred_at, from_hint: parts?.[1]?.trim(), to_hint: parts?.[2]?.trim() };
  }

  if (isGoalContributionIntent(lower)) {
    const g = lower.match(/\b(?:meta|objetivo|reserva|para)\s+([\wçãéíáóêô ]+)/);
    return { kind: "goal_contribution", amount, occurred_at, goal_hint: g?.[1]?.trim() };
  }

  const isIncome = /\b(recebi|ganhei|entrou|salário|salario|pix recebi|pagamento recebido)\b/.test(lower);
  const isExpense = /\b(gastei|paguei|comprei|almo[çc]|jantar|caf[eé]|uber|99|mercado|farm[aá]cia|conta|boleto|assinatura)\b/.test(lower);
  const descMatch = lower.match(/\b(?:no|na|em|com|de)\s+([\wçãéíáóêô]+(?:\s+[\wçãéíáóêô]+){0,3})/);
  const catMatch = lower.match(/\b(mercado|almoço|almoco|jantar|caf[eé]|uber|99|farm[aá]cia|lazer|assinatura|transporte|combust[íi]vel|educa[cç][aã]o|sa[uú]de|casa|contas)\b/);
  const accMatch = lower.match(/\b(nubank|itau|itaú|bradesco|santander|inter|caixa|carteira|dinheiro|c6|picpay|mercadopago)\b/);

  return {
    kind: "transaction",
    type: isIncome && !isExpense ? "income" : "expense",
    amount, occurred_at, description: descMatch?.[1]?.trim(),
    category_hint: catMatch?.[1], account_hint: accMatch?.[1],
  };
}
