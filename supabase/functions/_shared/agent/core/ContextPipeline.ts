// ContextPipeline — single facade that consolidates every context source
// used by the Agent Core: conversation history, session state, pending
// confirmations, financial 360 snapshot, memory (Fase 3), user profile (Fase 3),
// personalization preferences (Fase 3).
//
// All accesses are memoised per turn via `create()` — call the same getter
// twice, second call is free. Nothing else in the Core should hit Supabase
// for context directly.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { loadHistory, type HistoryTurn } from "./ConversationHistory.ts";
import { getState, type SessionState } from "./StateManager.ts";
import { findPending, type PendingRow } from "./PendingConfirmations.ts";
import { buildSnapshot, type ContextRequest, type Snapshot360 } from "./FinancialContext360.ts";
import { recall, type MemoryFact, type MemoryKind } from "./MemoryStore.ts";
import { loadProfile, type UserProfile } from "./UserProfile.ts";
import { loadPreferences, type Preferences } from "./PersonalizationEngine.ts";

export type TurnContext = {
  history(limit?: number, excludeMessageId?: string | null): Promise<HistoryTurn[]>;
  state(): Promise<SessionState>;
  pending(): Promise<PendingRow | null>;
  snapshot(req: ContextRequest): Promise<Snapshot360>;
  memory(kinds?: MemoryKind[] | MemoryKind, limit?: number): Promise<MemoryFact[]>;
  profile(): Promise<UserProfile>;
  preferences(): Promise<Preferences>;
  invalidatePending(): void;
};

export function createTurnContext(args: {
  sb: SupabaseClient;
  user_id: string;
  conversation_id: string;
  session_id?: string | null;
}): TurnContext {
  const memo: Record<string, unknown> = {};
  const once = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    if (key in memo) return memo[key] as T;
    const v = await fn();
    memo[key] = v;
    return v;
  };
  return {
    history: (limit = 12, excludeMessageId = null) =>
      once(`hist:${limit}:${excludeMessageId ?? ""}`, () =>
        loadHistory(args.sb, args.conversation_id, { limit, excludeMessageId })),
    state: () =>
      once("state", () => args.session_id
        ? getState(args.sb, args.session_id)
        : Promise.resolve({} as SessionState)),
    pending: () =>
      once("pending", () => findPending(args.sb, args.conversation_id, args.user_id)),
    snapshot: (req) => {
      const key = "snap:" + JSON.stringify(req);
      return once(key, () => buildSnapshot(args.sb, args.user_id, args.conversation_id, req));
    },
    memory: (kinds, limit = 25) =>
      once(`mem:${JSON.stringify(kinds ?? "")}:${limit}`, () =>
        recall(args.sb, args.user_id, { kind: kinds as any, limit })),
    profile: () =>
      once("profile", () => loadProfile(args.sb, args.user_id)),
    preferences: () =>
      once("prefs", () => loadPreferences(args.sb, args.user_id)),
    invalidatePending() { delete memo["pending"]; },
  };
}
