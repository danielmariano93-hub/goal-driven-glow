// nino_severity.v1 — "crítico" só quando o risco é de fato grande.
// A conta dona mostrou meta com impacto de R$ 26 marcada como crítica. Regra aprovada em 05/11/2026:
// crítico = impacto >= 5% da renda mensal, ou (só em prazo/caixa) vencimento em até 3 dias, ou atraso.
// Sem renda conhecida não rebaixa nada (na dúvida, mantém o que a origem decidiu).
import type { FinancialSituation } from "./contracts.ts";
import { pillarOf } from "./pillars.ts";

export const CRITICAL_INCOME_SHARE = 0.05;
export const CRITICAL_DEADLINE_DAYS = 3;

export function qualifiesAsCritical(
  s: Pick<FinancialSituation, "communication_kind" | "impact_amount" | "days_until">,
  monthlyIncome: number,
): boolean {
  if (!(monthlyIncome > 0)) return true;
  if (s.communication_kind === "debt_overdue") return true;
  if (s.impact_amount >= monthlyIncome * CRITICAL_INCOME_SHARE) return true;
  // Prazo só conta para prazo/caixa; fim do período de uma meta não é vencimento.
  return pillarOf(s.communication_kind) === "proteger" && s.days_until != null && s.days_until <= CRITICAL_DEADLINE_DAYS;
}

/** Rebaixa para "attention" o crítico sem impacto material. O motivo fica em evidence.severity_downgraded. */
export function normalizeSeverity(s: FinancialSituation, monthlyIncome: number): FinancialSituation {
  if (s.severity !== "critical" || qualifiesAsCritical(s, monthlyIncome)) return s;
  return { ...s, severity: "attention", evidence: { ...s.evidence, severity_downgraded: "below_5pct_income" } };
}
