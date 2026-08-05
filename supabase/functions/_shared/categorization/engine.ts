import {
  decideCategoryDeterministic,
  loadEffectiveThresholds,
  shouldAutoApply,
  type AliasRow,
  type CategoryCandidate,
  type CategoryDecision,
  type HistoryRow,
} from "./pipeline.ts";
import { normalizedPattern } from "./normalize.ts";

export const CATEGORY_ENGINE_VERSION = "categorization_contract.v1";

export type ClassificationAction = "auto_apply" | "suggest_review" | "leave_unresolved" | "exclude";
export type ClassificationInput = {
  transaction_id?: string | null;
  type: "income" | "expense" | "transfer";
  description?: string | null;
  explicit_category?: string | null;
  movement_kind?: string | null;
  transfer_group_id?: string | null;
  settles_card_id?: string | null;
};

export type ClassificationResult = CategoryDecision & {
  action: ClassificationAction;
  reason_code: string;
  engine_version: string;
  alternatives: Array<{ category_id: string; confidence: number }>;
};

export function isCategorizationEligible(input: ClassificationInput): boolean {
  return (input.type === "income" || input.type === "expense")
    && (input.movement_kind ?? "transaction") === "transaction"
    && !input.transfer_group_id
    && !input.settles_card_id;
}

function resultFromDecision(decision: CategoryDecision | null, auto: boolean): ClassificationResult {
  if (!decision?.category_id) {
    return {
      category_id: null,
      category_source: "none",
      category_confidence: 0,
      category_reason: "evidência insuficiente",
      action: "leave_unresolved",
      reason_code: "insufficient_evidence",
      engine_version: CATEGORY_ENGINE_VERSION,
      alternatives: [],
    };
  }
  return {
    ...decision,
    action: auto ? "auto_apply" : "suggest_review",
    reason_code: `${decision.category_source}_match`,
    engine_version: CATEGORY_ENGINE_VERSION,
    alternatives: [],
  };
}

// deno-lint-ignore no-explicit-any
export async function loadCategorizationContext(sb: any, userId: string, type: "income" | "expense") {
  const [{ data: categories }, { data: aliases }, { data: history }, thresholds] = await Promise.all([
    sb.from("categories").select("id,name,type,user_id").is("archived_at", null)
      .or(`user_id.eq.${userId},user_id.is.null`),
    sb.from("merchant_aliases").select("alias_key,category_id,confidence").eq("user_id", userId),
    sb.from("transactions").select("description,raw_description,friendly_description,category_id")
      .eq("user_id", userId).eq("type", type).not("category_id", "is", null).limit(3000),
    loadEffectiveThresholds(sb),
  ]);
  const candidates: CategoryCandidate[] = (categories ?? [])
    .filter((row: { type: string }) => row.type === type || row.type === "both")
    .map((row: { id: string; name: string }) => ({ id: row.id, name: row.name }));
  const aliasRows: AliasRow[] = (aliases ?? []).map((row: { alias_key: string; category_id: string | null; confidence: number }) => ({
    pattern: row.alias_key,
    category_id: row.category_id,
    confidence: Number(row.confidence ?? 0.9),
  }));
  const counts = new Map<string, HistoryRow>();
  for (const row of history ?? []) {
    const pattern = normalizedPattern(row.friendly_description ?? row.raw_description ?? row.description ?? "");
    if (!pattern || !row.category_id) continue;
    const key = `${pattern}|${row.category_id}`;
    const current = counts.get(key);
    counts.set(key, { pattern, category_id: row.category_id, count: (current?.count ?? 0) + 1 });
  }
  return { candidates, aliases: aliasRows, history: [...counts.values()], thresholds };
}

// deno-lint-ignore no-explicit-any
export async function classifyDeterministic(sb: any, userId: string, input: ClassificationInput): Promise<ClassificationResult> {
  if (!isCategorizationEligible(input)) {
    return {
      category_id: null, category_source: "none", category_confidence: 0,
      category_reason: "movimento contábil excluído da categorização de consumo",
      action: "exclude", reason_code: "non_consumption_movement",
      engine_version: CATEGORY_ENGINE_VERSION, alternatives: [],
    };
  }
  const type = input.type as "income" | "expense";
  const context = await loadCategorizationContext(sb, userId, type);
  const decision = decideCategoryDeterministic({
    explicit: input.explicit_category,
    description: input.description ?? "",
    candidates: context.candidates,
    aliases: context.aliases,
    history: context.history,
  });
  return resultFromDecision(decision, shouldAutoApply(decision, context.thresholds));
}

export function resultFromLlm(input: { category_id: string | null; confidence: number }, validIds: Set<string>): ClassificationResult | null {
  const confidence = Math.max(0, Math.min(0.9, Number(input.confidence ?? 0)));
  if (!input.category_id || !validIds.has(input.category_id) || confidence < 0.6) return null;
  return {
    category_id: input.category_id,
    category_source: "llm",
    category_confidence: confidence,
    category_reason: "inferência semântica restrita às categorias disponíveis",
    action: confidence >= 0.85 ? "auto_apply" : "suggest_review",
    reason_code: "llm_match",
    engine_version: CATEGORY_ENGINE_VERSION,
    alternatives: [],
  };
}