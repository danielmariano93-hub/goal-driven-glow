import type { FinancialSituation, FinancialSituationAction } from "@/lib/nino/diagnosis";

const SAFE_NINO_ROUTE = /^\/app\/[A-Za-z0-9\-/?=&_.~:@!$'()*+,;[\]]*$/;

export function diagnosisRoute(action?: FinancialSituationAction | null, fallback = "/app/nino") {
  const route = action?.route?.trim() ?? "";
  if (!route || route.startsWith("//") || /[<>"\s\\]/.test(route)) return fallback;
  return SAFE_NINO_ROUTE.test(route.replace(/%[0-9A-Fa-f]{2}/g, "a")) ? route : fallback;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function transactionIds(situation: FinancialSituation): string[] {
  const pairs = Array.isArray(situation.evaluation?.pairs) ? situation.evaluation.pairs : [];
  return pairs.flatMap((pair) => {
    if (!pair || typeof pair !== "object") return [];
    const rows = (pair as { transactions?: unknown }).transactions;
    return Array.isArray(rows) ? rows.filter((id): id is string => typeof id === "string") : [];
  });
}

/** Resolve o destino usando o contexto da situação, inclusive em cards secundários sem ação anexada. */
export function diagnosisRouteForSituation(
  situation: FinancialSituation,
  action?: FinancialSituationAction | null,
) {
  const evaluation = situation.evaluation ?? {};
  if (situation.situation_type === "data_quality_issue") return "/app/lancamentos?filtro=sem-categoria";
  if (situation.situation_type === "duplicate_review") {
    const query = new URLSearchParams({ revisar: "duplicidades" });
    const ids = transactionIds(situation);
    if (ids.length) query.set("ids", ids.join(","));
    return `/app/lancamentos?${query.toString()}`;
  }
  if (situation.situation_type === "goal_feasibility") {
    const goalId = stringValue(evaluation.goal_id);
    return goalId ? `/app/metas?goal=${encodeURIComponent(goalId)}&action=recalibrate` : "/app/metas";
  }
  if (situation.situation_type === "card_cycle_pressure" || ["bill", "installment"].includes(String(evaluation.future_kind ?? ""))) {
    const cardId = stringValue(evaluation.card_id);
    return cardId ? `/app/cartoes?card=${encodeURIComponent(cardId)}` : "/app/cartoes";
  }
  if (situation.situation_type === "recurring_commitment_pressure") {
    const debtId = stringValue(evaluation.debt_id);
    return debtId ? `/app/dividas?debt=${encodeURIComponent(debtId)}&action=pagar` : "/app/dividas";
  }
  if (situation.situation_type === "behavioral_pattern") {
    if (evaluation.days_without_checkin != null) return "/app/emocoes?action=checkin";
    return situation.status === "observed" ? "/app/nino?section=aprendizados" : "/app/lancamentos";
  }

  if (situation.situation_type === "anticipation") return "/app/planejamento";
  if (situation.situation_type === "cash_flow_imbalance") return "/app/relatorios";
  if (situation.situation_type === "spending_pace_change") return "/app/relatorios";
  return diagnosisRoute(action, "/app/relatorios");
}

export function diagnosisActionLabel(situation: FinancialSituation, action?: FinancialSituationAction | null) {
  if (["resolved", "expired", "suppressed"].includes(situation.status)) return null;
  const title = action?.title?.trim();
  if (title && title !== "Resolver agora") return title;
  if (situation.situation_type === "behavioral_pattern") {
    // A rota canônica dessa leitura é o check-in: o rótulo precisa dizer a mesma coisa.
    if (situation.evaluation?.days_without_checkin != null) return "Registrar como me sinto";
    return situation.status === "observed" ? "Entender o padrão" : "Ver os gastos do padrão";
  }
  if (situation.situation_type === "data_quality_issue") return "Classificar lançamentos";
  if (situation.situation_type === "duplicate_review") return "Revisar duplicidades";
  if (situation.situation_type === "goal_feasibility") return "Recalibrar meta";
  if (situation.temporal_scope === "future") return "Planejar agora";
  if (situation.status === "improving") return "Ver o que melhorou";
  return "Ver detalhes";
}