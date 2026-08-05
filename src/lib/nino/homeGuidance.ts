import type { SpendingProjection } from "@/lib/engine/metrics";
import type { FinancialSituationAction, HomeDiagnosisView } from "@/lib/nino/diagnosis";

export type HomeGuidancePresentation = {
  severity: "informative" | "attention" | "critical";
  title: string;
  supportingText: string | null;
  action: FinancialSituationAction | null;
  hasDetails: boolean;
};

const METHODOLOGY = /(o cálculo considera|metodologia|confiança|base observada|dados observados)/i;

function normalized(value: string) {
  return value.toLocaleLowerCase("pt-BR").replace(/[^a-z0-9á-ú]+/gi, " ").trim();
}

function compact(value: string, max = 240) {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const sentence = clean.slice(0, max + 1).match(/^(.{80,240}?[.!?])(?:\s|$)/)?.[1];
  if (sentence) return sentence;
  const cut = clean.slice(0, max + 1);
  return `${cut.slice(0, Math.max(0, cut.lastIndexOf(" "))).trim()}…`;
}

export function buildHomeGuidancePresentation(
  diagnosis: HomeDiagnosisView,
  projectionAvailability: "available" | "partial" | "unavailable",
): HomeGuidancePresentation | null {
  const item = diagnosis.primary;
  if (!item) return null;
  const title = (item.one_line_summary || item.headline).trim();
  const titleKey = normalized(title);
  const candidates = [
    item.cause_summary,
    diagnosis.counterpoint ? `Também vale saber: ${diagnosis.counterpoint.one_line_summary || diagnosis.counterpoint.headline}` : null,
    item.consequence_summary,
    projectionAvailability === "available" ? item.forecast_summary : null,
  ].filter((value): value is string => Boolean(value?.trim()));
  const supporting = candidates.find((value) => {
    const key = normalized(value);
    return !METHODOLOGY.test(value) && key !== titleKey && !titleKey.includes(key) && !key.includes(titleKey);
  }) ?? null;

  return {
    severity: item.severity === "critical" ? "critical" : item.severity === "attention" ? "attention" : "informative",
    title,
    supportingText: supporting ? compact(supporting) : null,
    action: diagnosis.hasTrustedAction ? diagnosis.action : null,
    hasDetails: Boolean(diagnosis.evidenceSummary || candidates.length > 1 || projectionAvailability === "available"),
  };
}

export function projectionCanBeDetailed(
  projection: SpendingProjection | null,
  availability: "available" | "partial" | "unavailable",
) {
  return availability === "available" ? projection : null;
}