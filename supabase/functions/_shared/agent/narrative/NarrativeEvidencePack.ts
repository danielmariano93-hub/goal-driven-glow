// NarrativeEvidencePack (`nino_narrative.v1`)
//
// Contrato TIPADO de evidência para a camada de linguagem. Nada aqui calcula,
// soma, divide ou projeta: só LÊ o que o motor determinístico já produziu
// (candidato + evidência canônica) e declara o que pode e o que não pode ser
// afirmado. A camada de linguagem recebe SOMENTE este pacote.
// deno-lint-ignore-file no-explicit-any
import type { CommunicationCandidate } from "../../intelligence/contracts.ts";

export const NARRATIVE_EVIDENCE_PACK_VERSION = "nino_narrative_evidence.v1";

export type NarrativeFactKind = "money" | "percentage" | "count" | "date" | "text";

export type NarrativeFact = {
  key: string;
  label: string;
  kind: NarrativeFactKind;
  value: number | null;
  text: string | null;
};

export type NarrativeEvidencePack = {
  version: typeof NARRATIVE_EVIDENCE_PACK_VERSION;
  kind: string;
  severity: "info" | "attention" | "critical";
  confidence: number | null;
  period: { from: string; to: string; label: string } | null;
  primary_fact: NarrativeFact | null;
  supporting_facts: NarrativeFact[];
  entities: { categories: string[]; merchants: string[]; goals: string[]; cards: string[] };
  /** Corpo determinístico do motor: fallback e fonte de todo número citável. */
  deterministic_body: string;
  deterministic_title: string;
  /** Números que a narrativa pode citar (valores e percentuais canônicos). */
  allowed_numbers: number[];
  /** Datas (ISO) que a narrativa pode citar. */
  allowed_dates: string[];
  allowed_claims: NarrativeClaim[];
  prohibited_claims: string[];
  /** Contexto declarado pelo próprio usuário, ainda dentro da validade. */
  user_context: string[];
  question_hint: string | null;
};

export type NarrativeClaim =
  | "fact"
  | "comparison"
  | "trend"
  | "cause"
  | "risk"
  | "forecast"
  | "achievement"
  | "recommendation";

const MONEY_KEYS = [
  "amount", "value", "total", "impact_amount", "delta", "difference", "monthly_amount",
  "average", "typical", "previous_total", "current_total", "balance", "available",
  "projected_total", "remaining", "installment_amount", "target_amount", "saved_amount",
];
const PERCENT_KEYS = ["percent", "percentage", "share", "variation", "progress", "pace", "ratio"];
const COUNT_KEYS = ["count", "transactions_count", "occurrences", "installments", "days"];

function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value);
}

function strList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v : (v as any)?.name ?? (v as any)?.label ?? ""))
      .map((v) => String(v).trim())
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

/** Números já escritos no corpo determinístico também são canônicos. */
export function numbersInText(text: string): number[] {
  const out: number[] = [];
  const money = String(text ?? "").matchAll(/R\$\s?([\d.]+(?:,\d{1,2})?)/g);
  for (const m of money) {
    const n = Number(m[1].replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(n)) out.push(n);
  }
  const percents = String(text ?? "").matchAll(/(\d+(?:[.,]\d+)?)\s?%/g);
  for (const m of percents) {
    const n = Number(m[1].replace(",", "."));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

export function datesInText(text: string): string[] {
  return Array.from(String(text ?? "").matchAll(/\b(\d{2})\/(\d{2})(?:\/(\d{4}))?\b/g))
    .map((m) => (m[3] ? `${m[3]}-${m[2]}-${m[1]}` : `${m[2]}-${m[1]}`));
}

function claimsFor(kind: string, evidence: Record<string, unknown>): NarrativeClaim[] {
  const claims = new Set<NarrativeClaim>(["fact"]);
  if (evidence.comparison || evidence.previous_total != null || evidence.baseline != null) claims.add("comparison");
  if (evidence.trend || evidence.direction) claims.add("trend");
  if (evidence.cause_summary || evidence.top_categories || evidence.drivers) claims.add("cause");
  if (evidence.forecast || evidence.projected_total != null) claims.add("forecast");
  if (/risk|pressure|overdue|at_risk|spike|imbalance|relapse/.test(kind)) claims.add("risk");
  if (/progress|achievement|discipline|saving|goal_progress/.test(kind)) claims.add("achievement");
  if (evidence.action || evidence.recommendation || evidence.next_action) claims.add("recommendation");
  return [...claims];
}

const BASE_PROHIBITED = [
  "número que não esteja na evidência",
  "causa não declarada na evidência",
  "projeção não declarada na evidência",
  "julgamento moral sobre o gasto",
  "promessa de rendimento ou de resultado garantido",
  "menção a modelo, provedor de IA ou nome interno de motor",
];

export function buildNarrativeEvidencePack(
  candidate: Pick<CommunicationCandidate, "kind" | "severity" | "title" | "body"> & {
    evidence?: Record<string, unknown> | null;
  },
  opts?: { userContext?: string[]; supporting?: NarrativeFact[] },
): NarrativeEvidencePack {
  const evidence = (candidate.evidence ?? {}) as Record<string, unknown>;
  const deterministicBody = String(evidence.deterministic_body ?? candidate.body ?? "").trim();
  const deterministicTitle = String(candidate.title ?? "").trim();

  const facts: NarrativeFact[] = [];
  const allowedNumbers = new Set<number>();
  const allowedDates = new Set<string>();

  for (const [key, raw] of Object.entries(evidence)) {
    const lower = key.toLowerCase();
    if (isIsoDate(raw)) {
      allowedDates.add(String(raw).slice(0, 10));
      facts.push({ key, label: key, kind: "date", value: null, text: String(raw).slice(0, 10) });
      continue;
    }
    const value = num(raw);
    if (value == null) continue;
    const kind: NarrativeFactKind = PERCENT_KEYS.some((k) => lower.includes(k))
      ? "percentage"
      : COUNT_KEYS.some((k) => lower.includes(k))
      ? "count"
      : MONEY_KEYS.some((k) => lower.includes(k))
      ? "money"
      : "count";
    if (kind !== "count" || COUNT_KEYS.some((k) => lower.includes(k))) {
      facts.push({ key, label: key, kind, value, text: null });
      allowedNumbers.add(value);
    }
  }

  for (const n of numbersInText(deterministicBody)) allowedNumbers.add(n);
  for (const n of numbersInText(deterministicTitle)) allowedNumbers.add(n);

  const periodRaw = (evidence.period ?? null) as Record<string, unknown> | null;
  const period = periodRaw && isIsoDate(periodRaw.from) && isIsoDate(periodRaw.to)
    ? {
      from: String(periodRaw.from).slice(0, 10),
      to: String(periodRaw.to).slice(0, 10),
      label: String(periodRaw.label ?? "").trim() || `${String(periodRaw.from).slice(0, 10)} a ${String(periodRaw.to).slice(0, 10)}`,
    }
    : null;
  if (period) {
    allowedDates.add(period.from);
    allowedDates.add(period.to);
  }

  const primaryValue = num(evidence.impact_amount ?? evidence.amount ?? evidence.total);
  const primary_fact: NarrativeFact | null = primaryValue != null
    ? { key: "impact", label: "peso no mês", kind: "money", value: primaryValue, text: null }
    : facts[0] ?? null;
  if (primaryValue != null) allowedNumbers.add(primaryValue);

  return {
    version: NARRATIVE_EVIDENCE_PACK_VERSION,
    kind: String(candidate.kind ?? ""),
    severity: (["info", "attention", "critical"] as const).includes(candidate.severity as any)
      ? (candidate.severity as any)
      : "info",
    confidence: num(evidence.confidence),
    period,
    primary_fact,
    supporting_facts: [
      ...(opts?.supporting ?? []),
      ...facts.filter((f) => f !== primary_fact).slice(0, 6),
    ].slice(0, 8),
    entities: {
      categories: strList(evidence.categories ?? evidence.category ?? evidence.category_name).slice(0, 6),
      merchants: strList(evidence.merchants ?? evidence.merchant ?? evidence.merchant_name).slice(0, 6),
      goals: strList(evidence.goals ?? evidence.goal_name).slice(0, 4),
      cards: strList(evidence.cards ?? evidence.card_name).slice(0, 4),
    },
    deterministic_body: deterministicBody,
    deterministic_title: deterministicTitle,
    allowed_numbers: [...allowedNumbers],
    allowed_dates: [...allowedDates],
    allowed_claims: claimsFor(String(candidate.kind ?? ""), evidence),
    prohibited_claims: [
      ...BASE_PROHIBITED,
      ...(Array.isArray(evidence.prohibited_patterns) ? evidence.prohibited_patterns.map(String) : []),
    ],
    user_context: (opts?.userContext ?? []).map((c) => String(c).trim()).filter(Boolean).slice(0, 4),
    question_hint: typeof evidence.question_hint === "string" ? evidence.question_hint.trim() || null : null,
  };
}
