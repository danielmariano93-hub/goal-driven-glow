// Nino Runtime V3 — semantic comparator.
//
// Comparison deliberately ignores prose style and provenance labels. We compare
// the semantic contract: turn kind/act, task families, entities, periods and
// write payload meaning. This is used both by shadow evaluation and by the
// independent deep-review gate for consequential turns.

import type { TurnSpecV3, SemanticTaskV3 } from "./TurnSpecV3.ts";
import { resolvePeriodExpressionV3 } from "./TemporalContractV3.ts";

export type SemanticSignatureV3 = {
  kind: TurnSpecV3["kind"];
  act: TurnSpecV3["act"];
  canonical_request: string;
  task_families: string[];
  entities: Array<{ field: string; value: string }>;
  periods: string[];
  tasks: Array<Record<string, unknown>>;
};

export type SemanticComparisonV3 = {
  same_kind: boolean;
  same_act: boolean;
  same_task_families: boolean;
  same_entities: boolean;
  same_periods: boolean;
  semantic_match: boolean;
  divergence_reasons: string[];
};

function norm(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.map(norm).filter(Boolean))].sort();
}

function entityPairs(tasks: SemanticTaskV3[]): Array<{ field: string; value: string }> {
  const out: Array<{ field: string; value: string }> = [];
  for (const task of tasks) {
    if (task.kind === "financial_query") {
      for (const filter of task.filters) {
        out.push({ field: filter.field, value: norm(filter.entity.value) });
      }
    } else if (task.kind === "goal_query" && task.goal?.value) {
      out.push({ field: "goal", value: norm(task.goal.value) });
    }
  }
  return out
    .filter((item) => item.value)
    .sort((a, b) => `${a.field}:${a.value}`.localeCompare(`${b.field}:${b.value}`));
}

function periodValues(tasks: SemanticTaskV3[]): string[] {
  const out: string[] = [];
  for (const task of tasks) {
    if (task.kind === "financial_query") {
      out.push(...task.periods.map((period) => period.value));
      if (task.comparison?.baseline.kind === "period" && task.comparison.baseline.period?.value) {
        out.push(task.comparison.baseline.period.value);
      }
      if (task.comparison?.target?.value) out.push(task.comparison.target.value);
    } else if (task.kind === "advisory") {
      out.push(...task.periods.map((period) => period.value));
    }
  }
  // Compare the resolved window, not the wording: "este mês", "esse mês" and
  // "mês atual" are the same period. Unresolvable text stays textual.
  return sortedUnique(out.map((value) => {
    const grounded = resolvePeriodExpressionV3({ value, source: "current_turn", source_span: null });
    return grounded ? `${grounded.from}..${grounded.to}` : value;
  }));
}

/**
 * Semantic review compares meaning, not serialization. Models may emit the same
 * money as 50, 50.00, 50,00 or R$ 50,00. Canonicalize those spellings before
 * deciding that the tiers disagree. Dates/IDs/names are intentionally left as
 * normalized text so distinct entities cannot collapse accidentally.
 */
function normalizeSlotValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  const raw = String(value ?? "").trim();
  const withoutCurrency = raw.replace(/^r\$\s*/i, "").trim();
  let numeric: string | null = null;
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(withoutCurrency)) {
    numeric = withoutCurrency.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d+(?:,\d+)$/.test(withoutCurrency)) {
    numeric = withoutCurrency.replace(",", ".");
  } else if (/^-?\d+(?:\.\d+)?$/.test(withoutCurrency)) {
    numeric = withoutCurrency;
  }
  if (numeric != null) {
    const parsed = Number(numeric);
    if (Number.isFinite(parsed)) return String(parsed);
  }
  return norm(raw);
}

const SLOT_KEY_ALIASES: Record<string, string> = {
  occurred_at: "date",
  data: "date",
  valor: "amount",
  value: "amount",
};

/** Free text varies between readings and is reviewed by the user in the draft. */
const FREE_TEXT_SLOTS = new Set(["description", "notes", "note", "descricao", "observacao"]);

/** Slots whose value changes what money moves: both readings must state them identically. */
export const CRITICAL_WRITE_SLOTS = new Set(["amount", "installments", "full_payment", "initial_contribution", "target_amount"]);

const RELATIVE_DATES: Record<string, string> = {
  hoje: "today", today: "today", agora: "today", now: "today",
  ontem: "yesterday", yesterday: "yesterday",
  anteontem: "day_before_yesterday",
};

function isoFromDateText(text: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  return null;
}

function normalizeWriteSlotValue(key: string, value: unknown): string {
  const normalized = normalizeSlotValue(value);
  if (key === "date") {
    // "hoje" e "2026-10-02" (ou "02/10/2026") são a mesma data: sem isso as duas leituras "divergiam".
    const iso = isoFromDateText(normalized);
    if (iso) {
      const spToday = new Date(Date.now() - 3 * 3600_000);
      const dayMs = 86_400_000;
      const fmt = (d: Date) => d.toISOString().slice(0, 10);
      if (iso === fmt(spToday)) return "today";
      if (iso === fmt(new Date(spToday.getTime() - dayMs))) return "yesterday";
      if (iso === fmt(new Date(spToday.getTime() - 2 * dayMs))) return "day_before_yesterday";
      return iso;
    }
    return RELATIVE_DATES[normalized] ?? normalized;
  }
  return normalized;
}

function normalizedWriteSlots(slots: Record<string, unknown> | null | undefined): Array<[string, string]> {
  const out = new Map<string, string>();
  for (const [rawKey, value] of Object.entries(slots ?? {})) {
    const key = SLOT_KEY_ALIASES[norm(rawKey)] ?? norm(rawKey);
    if (FREE_TEXT_SLOTS.has(key)) continue;
    if (value == null || String(value).trim() === "") continue;
    out.set(key, normalizeWriteSlotValue(key, value));
  }
  return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Two write readings are compatible when the action matches, every critical
 * slot is present in both with the same value, and no optional slot stated by
 * BOTH readings carries different values. An optional slot filled by only one
 * reading is not a contradiction (the draft shows it for user confirmation).
 */
function compatibleWriteShapes(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (a.kind !== "financial_write" || b.kind !== "financial_write") return false;
  if (a.action !== b.action) return false;
  const slotsA = new Map(a.slots as Array<[string, string]>);
  const slotsB = new Map(b.slots as Array<[string, string]>);
  for (const key of CRITICAL_WRITE_SLOTS) {
    if (slotsA.has(key) !== slotsB.has(key)) return false;
    if (slotsA.has(key) && slotsA.get(key) !== slotsB.get(key)) return false;
  }
  for (const [key, value] of slotsA) {
    if (slotsB.has(key) && slotsB.get(key) !== value) return false;
  }
  return true;
}

function compatibleTaskLists(a: Array<Record<string, unknown>>, b: Array<Record<string, unknown>>): boolean {
  if (a.length !== b.length) return false;
  const reads = (list: Array<Record<string, unknown>>) => list.filter((t) => t.kind !== "financial_write").map((t) => JSON.stringify(t));
  if (JSON.stringify(reads(a)) !== JSON.stringify(reads(b))) return false;
  const writesA = a.filter((t) => t.kind === "financial_write");
  const writesB = [...b.filter((t) => t.kind === "financial_write")];
  for (const write of writesA) {
    const index = writesB.findIndex((candidate) => compatibleWriteShapes(write, candidate));
    if (index < 0) return false;
    writesB.splice(index, 1);
  }
  return writesB.length === 0;
}

function taskShape(task: SemanticTaskV3): Record<string, unknown> {
  if (task.kind === "financial_query") {
    return {
      kind: task.kind,
      family: task.family,
      metric: task.metric,
      operation: task.operation,
      group_by: [...task.group_by].sort(),
      filters: entityPairs([task]),
      periods: periodValues([task]),
      limit: task.limit,
      comparison: task.comparison
        ? {
          direction: task.comparison.direction,
          baseline_kind: task.comparison.baseline.kind,
          baseline_months: task.comparison.baseline.kind === "mean_previous_complete_months"
            ? task.comparison.baseline.months
            : null,
        }
        : null,
    };
  }
  if (task.kind === "goal_query") {
    return { kind: task.kind, family: task.family, operation: task.operation, goal: norm(task.goal?.value) || null };
  }
  if (task.kind === "advisory") {
    // Decision options are prose and legitimately vary between tiers; the
    // hypothetical scenario parameters are semantics and must agree.
    const scenario = task.scenario
      ? {
        lever: task.scenario.lever,
        category: norm(task.scenario.category) || null,
        amount: task.scenario.amount == null ? null : normalizeSlotValue(task.scenario.amount),
        percent: task.scenario.percent ?? null,
        goal: norm(task.scenario.goal) || null,
      }
      : null;
    return { kind: task.kind, family: task.family, operation: task.operation, periods: periodValues([task]), scenario };
  }
  return {
    kind: task.kind,
    family: task.family,
    action: task.action,
    slots: normalizedWriteSlots(task.slots),
  };
}

export function semanticSignatureV3(turn: TurnSpecV3): SemanticSignatureV3 {
  const tasks = turn.kind === "task" ? [...turn.tasks] : [];
  return {
    kind: turn.kind,
    act: turn.act,
    canonical_request: norm(turn.canonical_request),
    task_families: tasks.map((task) => task.family).sort(),
    entities: entityPairs(tasks),
    periods: periodValues(tasks),
    // A compound request is a set of tasks; two readings that list the same
    // tasks in a different order mean the same thing.
    tasks: tasks.map(taskShape).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

export function compareSemanticSignaturesV3(
  official: SemanticSignatureV3,
  candidate: SemanticSignatureV3,
): SemanticComparisonV3 {
  const sameKind = official.kind === candidate.kind;
  // Without tasks the act label is phrasing ("conversational" vs
  // "new_request" for the same chat turn), not an executable difference.
  const sameAct = official.act === candidate.act
    || (official.kind === candidate.kind && official.kind !== "task");
  const sameFamilies = stable(official.task_families) === stable(candidate.task_families);
  const sameEntities = stable(official.entities) === stable(candidate.entities);
  const samePeriods = stable(official.periods) === stable(candidate.periods);
  const sameTasks = stable(official.tasks) === stable(candidate.tasks)
    || compatibleTaskLists(official.tasks, candidate.tasks);
  const reasons: string[] = [];
  if (!sameKind) reasons.push("turn_kind_mismatch");
  if (!sameAct) reasons.push("act_mismatch");
  if (!sameFamilies) reasons.push("task_family_mismatch");
  if (!sameEntities) reasons.push("entity_mismatch");
  if (!samePeriods) reasons.push("period_mismatch");
  if (!sameTasks) reasons.push("task_semantics_mismatch");
  return {
    same_kind: sameKind,
    same_act: sameAct,
    same_task_families: sameFamilies,
    same_entities: sameEntities,
    same_periods: samePeriods,
    semantic_match: sameKind && sameAct && sameFamilies && sameEntities && samePeriods && sameTasks,
    divergence_reasons: reasons,
  };
}