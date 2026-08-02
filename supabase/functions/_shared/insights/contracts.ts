// Contratos do motor único de dicas (insights_catalog.v1).
// Módulo puro: nenhum acesso a rede/banco. Compartilhado por Deno e testes.

export const INSIGHT_CATALOG_VERSION = "insights_catalog.v1";

export type InsightKind =
  | "habit"
  | "alert"
  | "celebration"
  | "onboarding"
  | "opportunity"
  | "categorize_transaction";

export type DetectorKey =
  | "card_statement_due_7d"
  | "card_debt_vs_income"
  | "future_installments_pressure"
  | "card_statement_missing_document"
  | "debt_above_income"
  | "commitments_next_7d"
  | "category_growth"
  | "amount_anomaly"
  | "spending_rhythm"
  | "recurring_merchant"
  | "subscriptions_load"
  | "days_without_entry"
  | "cashflow_forecast"
  | "data_quality_uncategorized"
  | "savings_opportunity"
  | "next_best_action"
  | "financial_risk";

export type DetectorMeta = {
  key: DetectorKey;
  /** Família usada pela política de rotação/cooldown. */
  family: string;
  kind: InsightKind;
  /** Prioridade base: maior vence quando dois detectores disparam. */
  priority: number;
  /** Campos de evidência obrigatórios — sem eles o candidato é descartado. */
  requires: string[];
  description: string;
};

export const DETECTOR_CATALOG: Record<DetectorKey, DetectorMeta> = {
  card_statement_due_7d: { key: "card_statement_due_7d", family: "cartao", kind: "alert", priority: 100, requires: ["due_date", "amount"], description: "Fatura vencendo em até 7 dias." },
  financial_risk: { key: "financial_risk", family: "risco", kind: "alert", priority: 95, requires: ["expense_month", "income_month"], description: "Consumo do mês acima da renda do mês." },
  debt_above_income: { key: "debt_above_income", family: "dividas", kind: "alert", priority: 90, requires: ["active_debt_total", "income_month"], description: "Dívidas ativas acima de um mês de renda." },
  card_debt_vs_income: { key: "card_debt_vs_income", family: "cartao", kind: "alert", priority: 85, requires: ["card_debt_today", "income_month"], description: "Cartão acima de 40% da renda do mês." },
  cashflow_forecast: { key: "cashflow_forecast", family: "caixa", kind: "alert", priority: 82, requires: ["projected_balance", "commitments_next_30d"], description: "Projeção de caixa negativa no horizonte de 30 dias." },
  commitments_next_7d: { key: "commitments_next_7d", family: "caixa", kind: "alert", priority: 80, requires: ["upcoming_commitments_7d", "income_month"], description: "Compromissos de 7 dias acima de 30% da renda." },
  amount_anomaly: { key: "amount_anomaly", family: "anomalia", kind: "alert", priority: 75, requires: ["amount", "typical_amount"], description: "Gasto muito acima do ticket típico." },
  category_growth: { key: "category_growth", family: "categoria", kind: "habit", priority: 70, requires: ["category", "growth_pct"], description: "Categoria crescendo mês contra mês." },
  future_installments_pressure: { key: "future_installments_pressure", family: "cartao", kind: "habit", priority: 65, requires: ["card_future_installments"], description: "Parcelas comprometidas em meses seguintes." },
  subscriptions_load: { key: "subscriptions_load", family: "assinaturas", kind: "opportunity", priority: 60, requires: ["subscriptions_total", "subscriptions_count"], description: "Peso das assinaturas/recorrências no mês." },
  savings_opportunity: { key: "savings_opportunity", family: "economia", kind: "opportunity", priority: 55, requires: ["category", "amount"], description: "Categoria com espaço claro de economia." },
  recurring_merchant: { key: "recurring_merchant", family: "comerciante", kind: "habit", priority: 50, requires: ["merchant", "occurrences", "total"], description: "Comerciante recorrente com gasto somado relevante." },
  spending_rhythm: { key: "spending_rhythm", family: "ritmo", kind: "habit", priority: 45, requires: ["daily_typical", "days_left", "projected_expense"], description: "Ritmo diário projetado para o fim do mês." },
  card_statement_missing_document: { key: "card_statement_missing_document", family: "documentos", kind: "opportunity", priority: 40, requires: ["card_debt_is_estimated"], description: "Fatura sem documento oficial (valor estimado)." },
  data_quality_uncategorized: { key: "data_quality_uncategorized", family: "categorizacao", kind: "categorize_transaction", priority: 35, requires: ["uncategorized_count"], description: "Lançamentos sem categoria prejudicando as leituras." },
  days_without_entry: { key: "days_without_entry", family: "engajamento", kind: "habit", priority: 30, requires: ["days_without_entry"], description: "Dias sem registrar nada." },
  next_best_action: { key: "next_best_action", family: "proxima_acao", kind: "opportunity", priority: 20, requires: ["action"], description: "Próxima melhor ação com base no estado atual." },
};

export function detectorMeta(key: string): DetectorMeta | null {
  return (DETECTOR_CATALOG as Record<string, DetectorMeta>)[key] ?? null;
}

/** Extrai números (pt-BR e simples) de um texto livre. */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  const rx = /-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?|-?\d+(?:\.\d+)?/g;
  for (const raw of String(text ?? "").match(rx) ?? []) {
    let normalized = raw;
    if (raw.includes(",")) normalized = raw.replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    if (Number.isFinite(n)) out.push(Math.abs(n));
  }
  return out;
}

function evidenceNumbers(evidence: unknown, depth = 0): number[] {
  if (depth > 4 || evidence == null) return [];
  if (typeof evidence === "number") return Number.isFinite(evidence) ? [Math.abs(evidence)] : [];
  if (typeof evidence === "string") return extractNumbers(evidence);
  if (Array.isArray(evidence)) return evidence.flatMap((v) => evidenceNumbers(v, depth + 1));
  if (typeof evidence === "object") {
    return Object.values(evidence as Record<string, unknown>).flatMap((v) => evidenceNumbers(v, depth + 1));
  }
  return [];
}

/**
 * Guardrail numérico: todo número presente no texto precisa existir na
 * evidência (com tolerância de arredondamento) ou ser um número trivial
 * (0–31, típico de dias/percentuais pequenos gerados a partir de datas).
 * Retorna os números não suportados — vazio significa texto confiável.
 */
export function unsupportedNumbers(text: string, evidence: unknown): number[] {
  const pool = evidenceNumbers(evidence);
  const rounded = new Set<string>();
  for (const n of pool) {
    rounded.add(n.toFixed(2));
    rounded.add(Math.round(n).toFixed(2));
    rounded.add(Math.floor(n).toFixed(2));
    rounded.add((Math.round(n / 100) * 100).toFixed(2));
  }
  const bad: number[] = [];
  for (const n of extractNumbers(text)) {
    if (n <= 31) continue; // dias, parcelas, percentuais pequenos
    const candidates = [n.toFixed(2), Math.round(n).toFixed(2), Math.floor(n).toFixed(2)];
    const supported = candidates.some((c) => rounded.has(c)) ||
      pool.some((p) => Math.abs(p - n) <= Math.max(1, n * 0.01));
    if (!supported) bad.push(n);
  }
  return bad;
}
