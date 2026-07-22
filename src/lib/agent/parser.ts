// Deterministic Portuguese-BR interpreter for financial short-messages.
// Used both as a fallback when the LLM is not configured and as the parser
// invoked from tests. Never invents accounts/categories — those are resolved
// server-side by the orchestrator using the user's own data.

export type ParsedIntent =
  | { kind: "transaction"; type: "expense" | "income"; amount: number; occurred_at: string; description?: string; category_hint?: string; account_hint?: string }
  | { kind: "transfer"; amount: number; occurred_at: string; from_hint?: string; to_hint?: string }
  | { kind: "goal_contribution"; amount: number; occurred_at: string; goal_hint?: string }
  | { kind: "goal"; name: string; target_amount: number }
  | { kind: "query"; topic: "summary" | "recent" | "before_spending"; description?: string; amount?: number }
  | { kind: "confirm" }
  | { kind: "cancel" }
  | { kind: "unknown"; text: string };

/** Interpret a Brazilian currency literal without silently changing magnitude.
 *  "1.234,56" → 1234.56, "42,90" → 42.9, "100" → 100, "1,234.56" → 1234.56 */
export function parseBrAmount(raw: string): number | null {
  if (!raw) return null;
  let s = raw.trim().replace(/^r\$\s*/i, "");
  s = s.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // BR canonical: dot = thousands, comma = decimal
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    s = s.replace(",", ".");
  } else if (hasDot) {
    // Only dots: treat as thousands separator when every dot group has exactly 3 digits
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

/** Today in America/Sao_Paulo as ISO yyyy-mm-dd */
export function todaySaoPaulo(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** True when `iso` is a real calendar date (round-trips through Date). */
export function isValidCalendarDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso ?? "")) return false;
  const [y, m, d] = iso.split("-").map(Number);
  if (y < 1970 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Shift a São Paulo ISO date by N days. */
export function shiftSaoPaulo(baseIso: string, days: number): string {
  const [Y, M, D] = baseIso.split("-").map(Number);
  const dt = new Date(Date.UTC(Y, M - 1, D + days, 12, 0, 0));
  return todaySaoPaulo(dt);
}

/** Detect hoje/ontem/anteontem in pt-BR text. Returns the resolved ISO date
 *  (America/Sao_Paulo) or null when the text has no relative anchor. */
export function resolveRelativeDate(text: string, now: Date = new Date()): string | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const today = todaySaoPaulo(now);
  if (/\banteontem\b/.test(t)) return shiftSaoPaulo(today, -2);
  if (/\bontem\b/.test(t)) return shiftSaoPaulo(today, -1);
  if (/\bhoje\b|\bagora\b/.test(t)) return today;
  return null;
}

/** Server-side sanitizer for `occurred_at`. Precedence:
 *  1) If user text contains a relative anchor (hoje/ontem/anteontem), FORCE it.
 *  2) Else, if the model produced a valid, plausible date, keep it.
 *  3) Else, fall back to today in America/Sao_Paulo.
 *  Plausibility: no future dates; no dates older than 370 days unless the
 *  text itself carries an explicit YYYY-MM-DD literal. */
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
  const t = text.toLowerCase();
  const shift = (days: number) => {
    // Build date at 12:00 in SP to avoid TZ edge
    const [Y, M, D] = today.split("-").map(Number);
    const dt = new Date(Date.UTC(Y, M - 1, D + days, 12, 0, 0));
    return todaySaoPaulo(dt);
  };
  if (/\bhoje\b/.test(t)) return today;
  if (/\bontem\b/.test(t)) return shift(-1);
  if (/\banteontem\b/.test(t)) return shift(-2);
  return today;
}

const CONFIRM_WORDS = /^\s*(confirmar|confirma|sim|ok|okay|yes|👍)\s*[.!]?\s*$/i;
const CANCEL_WORDS = /^\s*(cancelar|cancela|não|nao|no|❌)\s*[.!]?\s*$/i;

// Loose confirm/cancel: aceita apenas frases inteiramente compostas por
// palavras de afirmação/negação (≤4 palavras). Evita casar frases naturais
// como "Ta escrito na mensagem" (contém "ta") ou "isso não é meu".
const CONFIRM_LOOSE = /^\s*(?:(?:sim|pode|confirma(?:r|do)?|ok|okay|beleza|blz|manda(?:\s+ver)?|vai|isso(?:\s+mesmo)?|positivo|claro|yes|👍)[\s,.!?]*){1,4}$/i;
const CANCEL_LOOSE  = /^\s*(?:(?:n[aã]o|cancela(?:r)?|negativo|deixa(?:\s+pra\s+l[aá])?|esquece|no|❌)[\s,.!?]*){1,4}$/i;

const AMOUNT_RE = /(?:r\$\s*)?(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i;

export function interpret(text: string, now: Date = new Date()): ParsedIntent {
  const raw = (text ?? "").trim();
  if (!raw) return { kind: "unknown", text: "" };
  if (CONFIRM_WORDS.test(raw)) return { kind: "confirm" };
  if (CANCEL_WORDS.test(raw)) return { kind: "cancel" };

  // Loose confirm/cancel: só quando não houver valor monetário.
  if (!AMOUNT_RE.test(raw)) {
    if (CONFIRM_LOOSE.test(raw)) return { kind: "confirm" };
    if (CANCEL_LOOSE.test(raw)) return { kind: "cancel" };
  }


  const lower = raw.toLowerCase();
  const occurred_at = relativeDate(lower, now);
  const amountMatch = lower.match(AMOUNT_RE);
  const amount = amountMatch ? parseBrAmount(amountMatch[1]) : null;

  // Queries (no writes)
  if (/\b(resumo|saldo|quanto (tenho|gastei)|extrato)\b/.test(lower)) {
    return { kind: "query", topic: "summary" };
  }
  if (/\b(últim|ultim).*\b(transa|lanc|gasto)/.test(lower)) {
    return { kind: "query", topic: "recent" };
  }
  if (/\b(posso gastar|antes de gastar|se eu gastar)\b/.test(lower) && amount !== null) {
    return { kind: "query", topic: "before_spending", amount, description: raw };
  }

  if (amount === null) return { kind: "unknown", text: raw };

  // Transfer
  if (/\btransfer(i|ir|indo|iu)\b/.test(lower) || /\bpassei? .* para\b/.test(lower)) {
    const parts = lower.match(/\bde\s+([\wçãéíáóêô ]+?)\s+para\s+([\wçãéíáóêô ]+)/);
    return {
      kind: "transfer", amount, occurred_at,
      from_hint: parts?.[1]?.trim(), to_hint: parts?.[2]?.trim(),
    };
  }

  // Goal contribution
  if (/\b(guardei|poupei|separei|aport(ei|e))\b.*\b(meta|objetivo|reserva|para )/.test(lower)) {
    const g = lower.match(/\b(?:meta|objetivo|reserva|para)\s+([\wçãéíáóêô ]+)/);
    return { kind: "goal_contribution", amount, occurred_at, goal_hint: g?.[1]?.trim() };
  }

  // Income vs expense
  const isIncome = /\b(recebi|ganhei|entrou|salário|salario|pix recebi|pagamento recebido)\b/.test(lower);
  const isExpense = /\b(gastei|paguei|comprei|almo[çc]|jantar|caf[eé]|uber|99|mercado|farm[aá]cia|conta|boleto|assinatura)\b/.test(lower);

  // Extract description around the noun
  const descMatch = lower.match(/\b(?:no|na|em|com|de)\s+([\wçãéíáóêô]+(?:\s+[\wçãéíáóêô]+){0,3})/);
  const description = descMatch?.[1]?.trim();

  const catMatch = lower.match(/\b(mercado|almoço|almoco|jantar|caf[eé]|uber|99|farm[aá]cia|lazer|assinatura|transporte|combust[íi]vel|educa[cç][aã]o|sa[uú]de|casa|contas)\b/);
  const accMatch = lower.match(/\b(nubank|itau|itaú|bradesco|santander|inter|caixa|carteira|dinheiro|c6|picpay|mercadopago)\b/);

  return {
    kind: "transaction",
    type: isIncome && !isExpense ? "income" : "expense",
    amount, occurred_at, description,
    category_hint: catMatch?.[1], account_hint: accMatch?.[1],
  };
}
