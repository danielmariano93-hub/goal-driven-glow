// GenericAggregateEligibility (`nino_generic_aggregate.v1`)
// Decide, de forma determinística, quando uma query do IR que NÃO tem motor
// dedicado pode ser executada pelo executor genérico. Só aceita o que o
// executor garante por inteiro; qualquer filtro, dimensão ou janela fora disso
// continua sendo recusa honesta (nunca descartar filtro, nunca aproximar).
import type { FinancialFilter, FinancialQuery, FinancialQueryIR } from "./FinancialQueryIR.ts";
import { AGG_DIMENSIONS } from "./handlers/GenericAggregate.ts";

export const GENERIC_AGGREGATE_TOOL = "spending_aggregate";

const FILTER_FIELDS = new Set<FinancialFilter["field"]>(["category", "merchant", "card", "account", "payment_method"]);
const OPERATIONS = new Set(["value", "sum", "rank", "breakdown", "trend"]);
const DEFAULT_RANK_LIMIT = 10;
/** Janelas máximas por grão: série longa demais não cabe numa resposta legível. */
const MAX_DAYS_BY_GRAIN: Record<string, number> = { day: 92, week: 400, month: 800, quarter: 1100 };

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return -1;
  return Math.round((b - a) / 86_400_000) + 1;
}

const CREDIT_WORDS = /^(credit_card|cartao|cartao de credito|credito|cartao credito|credit card|no cartao|no credito)$/;
const ACCOUNT_WORDS = /^(account|conta|conta corrente|debito|cartao de debito|pix)$/;

/** Forma de pagamento do catálogo (`credit_card` | `account`) ou null. */
export function normalizePaymentMethod(raw: string): "credit_card" | "account" | null {
  const t = String(raw ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  if (CREDIT_WORDS.test(t)) return "credit_card";
  if (ACCOUNT_WORDS.test(t)) return "account";
  return null;
}

export type GenericMapping = {
  tool: typeof GENERIC_AGGREGATE_TOOL;
  capability: "financial_analysis";
  execution: "deterministic";
  args: Record<string, unknown>;
};

export function genericAggregateMapping(
  q: FinancialQuery,
  ir: Pick<FinancialQueryIR, "period">,
): GenericMapping | null {
  const metric = q.metric === "income_amount" ? "income" : q.metric === "expense_amount" ? "expense" : null;
  if (!metric) return null;
  if (!OPERATIONS.has(q.operation)) return null;
  if (q.group_by.length > 1) return null;
  const group = q.group_by[0] ?? null;
  if (group && !(AGG_DIMENSIONS as readonly string[]).includes(group)) return null;

  const seen = new Set<string>();
  const scope: Record<string, string> = {};
  for (const f of q.filters) {
    if (f.op !== "eq" || !FILTER_FIELDS.has(f.field) || seen.has(f.field)) return null;
    const value = String(f.value ?? "").trim();
    if (!value) return null;
    if (f.field === "payment_method") {
      // Valor fora do catálogo não pode virar "0 gastos" em silêncio: ou normaliza, ou recusa.
      if (!normalizePaymentMethod(value)) return null;
    }
    seen.add(f.field);
    scope[f.field] = value;
  }
  // Receita não tem categoria de despesa: o resolvedor de categoria é só de gasto.
  if (metric === "income" && (scope.category || group === "category")) return null;
  // Dimensão já fixada por filtro de igualdade não faz sentido agrupar.
  if (group && seen.has(group)) return null;

  const period = q.period ?? ir.period;
  if (!period?.from || !period?.to) return null;
  const days = daysBetween(period.from, period.to);
  if (days < 1) return null;
  if (group && MAX_DAYS_BY_GRAIN[group] && days > MAX_DAYS_BY_GRAIN[group]) return null;

  const timeSeries = group != null && ["day", "week", "month", "quarter", "weekday"].includes(group);
  const limit = timeSeries ? null : (q.limit ?? (q.operation === "rank" ? DEFAULT_RANK_LIMIT : null));
  // Tendência só existe como série: sem dimensão de tempo o motor devolveria um
  // total e a resposta seria de outra pergunta.
  // "Por dia da semana" chega às vezes como `trend`: o padrão por dia da semana é o
  // próprio detalhamento por dia da semana, então vale como série de 7 pontos.
  if (q.operation === "trend" && !(group && ["day", "week", "month", "quarter", "weekday"].includes(group))) return null;
  // Sem agrupamento só há total: pedir ranking/detalhamento sem dimensão é outra pergunta.
  if (!group && (q.operation === "rank" || q.operation === "breakdown")) return null;

  return {
    tool: GENERIC_AGGREGATE_TOOL,
    capability: "financial_analysis",
    execution: "deterministic",
    args: {
      metric, from: period.from, to: period.to,
      group_by: group ? [group] : [],
      ...scope,
      ...(limit ? { limit } : {}),
    },
  };
}
