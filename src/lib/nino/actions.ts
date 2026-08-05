import type { FinancialSituation, FinancialSituationAction } from "@/lib/nino/diagnosis";

const SAFE_NINO_ROUTE = /^\/app\/[A-Za-z0-9\-/?=&_.~:@!$'()*+,;[\]]*$/;

export function diagnosisRoute(action?: FinancialSituationAction | null, fallback = "/app/nino") {
  const route = action?.route?.trim() ?? "";
  if (!route || route.startsWith("//") || /[<>"\s\\]/.test(route)) return fallback;
  return SAFE_NINO_ROUTE.test(route.replace(/%[0-9A-Fa-f]{2}/g, "a")) ? route : fallback;
}

export function diagnosisActionLabel(situation: FinancialSituation, action?: FinancialSituationAction | null) {
  if (["resolved", "expired", "suppressed"].includes(situation.status)) return null;
  const title = action?.title?.trim();
  if (title && title !== "Resolver agora") return title;
  if (situation.situation_type === "behavioral_pattern") return situation.status === "observed" ? "Entender o padrão" : "Ver os gastos do padrão";
  if (situation.situation_type === "data_quality_issue") return "Classificar lançamentos";
  if (situation.situation_type === "duplicate_review") return "Revisar duplicidades";
  if (situation.situation_type === "goal_feasibility") return "Recalibrar meta";
  if (situation.temporal_scope === "future") return "Planejar agora";
  if (situation.status === "improving") return "Ver o que melhorou";
  return "Ver detalhes";
}