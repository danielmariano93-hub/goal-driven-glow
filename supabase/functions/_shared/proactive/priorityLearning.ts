// nino_priority_learning.v1 — o ranking aprende com o que a pessoa FAZ (função pura).
// =================================================================================
// Sinal explícito vale mais que implícito:
//  - "agi"/abriu a ação  → ação (sobe o tipo para essa pessoa);
//  - "dispensar"         → dispensa (o mecanismo existente pode silenciar o tipo);
//  - "outra orientação" repetido ou ver várias vezes sem agir → só PENALIDADE
//    suave de nota, nunca silêncio. E risco crítico nunca é penalizado.
import type { FinancialSituation, MultiFinanceProactiveContext } from "./contracts.ts";

export const PRIORITY_LEARNING_VERSION = "nino_priority_learning.v1";

export type PriorityEvent = {
  kind: string;
  fingerprint: string;
  event: "impression" | "acted" | "next_requested" | "dismissed" | string;
  created_at: string;
};

export type PriorityLearning = {
  explicit: Record<string, { dismissals: number; actions: number }>;
  /** Ajuste de nota por tipo (≤ 0). */
  adjustment: Record<string, number>;
};

export const LEARNING_LIMITS = {
  windowDays: 45,
  nextRequestedPenalty: 4,
  ignoredImpressionsThreshold: 5,
  ignoredPenalty: 10,
  maxPenalty: 30,
} as const;

export function learnFromPriorityEvents(events: PriorityEvent[], now: Date = new Date()): PriorityLearning {
  const since = now.getTime() - LEARNING_LIMITS.windowDays * 86_400_000;
  const byKind = new Map<string, { impressions: Set<string>; acted: number; next: number; dismissed: number }>();
  for (const row of events) {
    if (!row.kind || Date.parse(row.created_at) < since) continue;
    const entry = byKind.get(row.kind) ?? { impressions: new Set<string>(), acted: 0, next: 0, dismissed: 0 };
    if (row.event === "impression") entry.impressions.add(row.fingerprint);
    else if (row.event === "acted") entry.acted += 1;
    else if (row.event === "next_requested") entry.next += 1;
    else if (row.event === "dismissed") entry.dismissed += 1;
    byKind.set(row.kind, entry);
  }
  const explicit: PriorityLearning["explicit"] = {};
  const adjustment: PriorityLearning["adjustment"] = {};
  for (const [kind, entry] of byKind) {
    if (entry.acted || entry.dismissed) explicit[kind] = { dismissals: entry.dismissed, actions: entry.acted };
    let penalty = entry.next * LEARNING_LIMITS.nextRequestedPenalty;
    if (entry.acted === 0 && entry.impressions.size >= LEARNING_LIMITS.ignoredImpressionsThreshold) {
      penalty += LEARNING_LIMITS.ignoredPenalty;
    }
    // Agir anula a leitura implícita de desinteresse.
    if (entry.acted > 0) penalty = 0;
    if (penalty > 0) adjustment[kind] = -Math.min(LEARNING_LIMITS.maxPenalty, penalty);
  }
  return { explicit, adjustment };
}

/** Soma o sinal explícito ao aprendizado por tipo já existente (WhatsApp/app). */
export function mergeLearning(
  base: MultiFinanceProactiveContext["learning"],
  learned: PriorityLearning,
): MultiFinanceProactiveContext["learning"] {
  const merged: MultiFinanceProactiveContext["learning"] = {};
  for (const [kind, value] of Object.entries(base ?? {})) merged[kind] = { ...value };
  for (const [kind, value] of Object.entries(learned.explicit)) {
    const entry = merged[kind] ??= { dismissals: 0, actions: 0, false_positives: 0 };
    entry.dismissals += value.dismissals;
    entry.actions += value.actions;
  }
  return merged;
}

/** Penalidade implícita vai para a evidência; o ranking aplica (nunca em crítico). */
export function applyLearningAdjustment(situations: FinancialSituation[], learned: PriorityLearning): FinancialSituation[] {
  return situations.map((situation) => {
    const delta = learned.adjustment[situation.communication_kind] ?? 0;
    if (!delta || situation.severity === "critical") return situation;
    return {
      ...situation,
      evidence: { ...situation.evidence, learning_adjustment: delta, learning_version: PRIORITY_LEARNING_VERSION },
    };
  });
}

/** Assunto canônico de um fingerprint ("...:situation:<chave>" → "<chave>"). Espelha `nino_topic_of`. */
export function topicOf(fingerprint: string): string {
  const value = String(fingerprint ?? "");
  const index = value.indexOf("situation:");
  return index >= 0 ? value.slice(index + "situation:".length) : value;
}

/**
 * O que a pessoa dispensou (na Home ou na página do Nino) não volta em nenhum
 * canal dentro da janela; as janelas (crítico 3 dias, resto 90) vêm do banco.
 */
export function withoutDismissed(situations: FinancialSituation[], dismissedKeys: string[]): FinancialSituation[] {
  if (!dismissedKeys.length) return situations;
  const keys = new Set(dismissedKeys);
  return situations.filter((situation) => !keys.has(situation.fingerprint) && !keys.has(topicOf(situation.fingerprint)));
}
