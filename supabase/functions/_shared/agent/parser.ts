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

const AMOUNT_RE = /(?:r\$\s*)?(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i;

export function interpret(text: string, now: Date = new Date()): ParsedIntent {
  const raw = (text ?? "").trim();
  if (!raw) return { kind: "unknown", text: "" };
  if (CONFIRM_WORDS.test(raw)) return { kind: "confirm" };
  if (CANCEL_WORDS.test(raw)) return { kind: "cancel" };

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
