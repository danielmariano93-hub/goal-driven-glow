// GroundingEngine (`nino_grounding_engine.v2`)
//
// Deterministic binding of conversational references to structured working
// memory. It never changes intent; it only proves what a reference points to.

import type { CanonicalConversationTurnContract } from "./ConversationTurnContract.ts";
import type { ConversationMemory } from "./ConversationMemory.ts";
import {
  resolveStructuredReference,
  type GroundedReference,
} from "./ConversationReferenceStore.ts";

export type GroundedTurn = {
  turn: CanonicalConversationTurnContract;
  reference: GroundedReference;
  ok: boolean;
  clarification: string | null;
};

function clarificationFor(turn: CanonicalConversationTurnContract): string {
  const expression = turn.reference?.expression?.trim();
  const target = turn.reference?.target;
  if (target === "debt") return expression
    ? `Quando você diz “${expression}”, qual dívida você quer dizer?`
    : "Qual dívida você quer usar?";
  if (target === "goal") return expression
    ? `Quando você diz “${expression}”, qual meta você quer dizer?`
    : "Qual meta você quer usar?";
  if (target === "category") return expression
    ? `Quando você diz “${expression}”, qual categoria você quer dizer?`
    : "Qual categoria você quer usar?";
  if (expression) {
    return `Quando você diz “${expression}”, não ficou claro para mim a que você está se referindo. Pode me dizer qual é?`;
  }
  return "Não ficou claro para mim a que você está se referindo. Pode me dizer qual é?";
}

function preferredEntity(turn: CanonicalConversationTurnContract, memory: ConversationMemory | null): string | null {
  const target = turn.reference?.target;
  if (target === "category") return turn.focus.category ?? memory?.active_category ?? null;
  if (target === "merchant") return turn.focus.merchant ?? memory?.active_merchant ?? null;
  return null;
}

const WRITE_REFERENCE_SLOT: Readonly<Record<string, string>> = {
  category: "category",
  merchant: "merchant",
  card: "card",
  account: "account",
  goal: "goal",
  debt: "debt",
};

/**
 * A reference already proven by the store can fill an ABSENT write slot. It
 * never overwrites a value explicitly interpreted from the current turn.
 *
 * The current V2 executor still keeps the canonical contract object obtained
 * before grounding. We therefore bind the missing slot on that same object at
 * this deterministic boundary; this is intentionally narrow and disappears
 * when the executor consumes GroundedTurn directly.
 */
function bindGroundedWriteReference(
  turn: CanonicalConversationTurnContract,
  grounded: GroundedReference,
): CanonicalConversationTurnContract {
  if (turn.mode !== "write" || !turn.action) return turn;
  if (grounded.status !== "resolved" || grounded.entity_labels.length !== 1 || !grounded.target) return turn;
  const slot = WRITE_REFERENCE_SLOT[grounded.target];
  if (!slot) return turn;
  const current = turn.action.slots?.[slot];
  if (current != null && String(current).trim()) return turn;
  turn.action.slots[slot] = grounded.entity_labels[0];
  return turn;
}

export function groundTurnContract(
  turn: CanonicalConversationTurnContract,
  memory: ConversationMemory | null,
  now: Date = new Date(),
): GroundedTurn {
  if (turn.reference && (turn.reference.kind === "quoted_turn" || turn.reference.kind === "active_topic")) {
    return {
      turn,
      reference: {
        status: "resolved", reference_id: null, target: turn.reference.target,
        entity_labels: [], reason: turn.reference.kind,
      },
      ok: true,
      clarification: null,
    };
  }
  const grounded = resolveStructuredReference(
    turn.reference,
    memory?.references ?? [],
    now,
    {
      topic_id: memory?.active_topic_id ?? null,
      preferred_entity: preferredEntity(turn, memory),
    },
  );
  if (!turn.reference) {
    return { turn, reference: grounded, ok: true, clarification: null };
  }
  if (grounded.status !== "resolved") {
    return {
      turn,
      reference: grounded,
      ok: false,
      clarification: clarificationFor(turn),
    };
  }
  if (turn.mode === "write" && grounded.entity_labels.length !== 1) {
    return {
      turn,
      reference: { ...grounded, status: "ambiguous", reason: "write_reference_requires_single_entity" },
      ok: false,
      clarification: clarificationFor(turn),
    };
  }
  return {
    turn: bindGroundedWriteReference(turn, grounded),
    reference: grounded,
    ok: true,
    clarification: null,
  };
}

/**
 * Applies an already-grounded reference to engine arguments. This is binding,
 * not interpretation. Unsupported tool/scope combinations are left untouched
 * and will be rejected later by ContractFulfillmentGate if the scope was
 * required but not declared by execution.
 */
export function applyGroundedReferenceScope(
  tool: string,
  args: Record<string, unknown>,
  grounded: GroundedReference | null | undefined,
): Record<string, unknown> {
  if (!grounded || grounded.status !== "resolved" || !grounded.entity_labels.length) return args;
  if (
    grounded.target === "category"
    && ["compare_periods", "compare_to_monthly_average", "analyze_spending"].includes(tool)
  ) {
    return { ...args, category_scope: [...grounded.entity_labels] };
  }
  if (grounded.target === "debt" && tool === "get_debt_status" && grounded.entity_labels.length === 1) {
    return { ...args, debt_name: grounded.entity_labels[0] };
  }
  return args;
}

/** Extracts the scope an engine declares it actually applied. */
export function executedReferenceScope(result: unknown): {
  target: string;
  entity_labels: string[];
} | null {
  const r = (result ?? {}) as Record<string, unknown>;
  const scope = r.applied_reference_scope as Record<string, unknown> | null | undefined;
  if (!scope || !Array.isArray(scope.entity_labels)) return null;
  const labels = scope.entity_labels.map((v) => String(v).trim()).filter(Boolean);
  if (!labels.length) return null;
  return { target: String(scope.target ?? "generic"), entity_labels: labels };
}
