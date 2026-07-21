// LearningLoop — post-turn hook that feeds MemoryStore based on user
// interaction signals: confirmations reinforce, cancellations penalize,
// corrections mark a `correction` fact that must never be overwritten.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { remember, recall, type MemoryKind } from "./MemoryStore.ts";

export type TurnSignal = {
  user_id: string;
  intent: string;
  policy_decision: string;
  reply_kind: string;
  tool_calls: Array<{ tool_name: string; args?: any; result?: any; ok: boolean }>;
  user_text: string;
};

export async function learnFromTurn(sb: SupabaseClient, sig: TurnSignal): Promise<void> {
  try {
    // Confirmation → reinforce facts used this turn.
    if (sig.policy_decision === "confirm" || sig.reply_kind === "receipt") {
      await reinforceRecent(sb, sig.user_id);
    }
    // Cancellation / correction → cooldown + memory
    if (sig.policy_decision === "cancel" || /não era isso|errado|corrigir|corrija/i.test(sig.user_text)) {
      await remember(sb, {
        user_id: sig.user_id, kind: "correction",
        key: `correction:${new Date().toISOString().slice(0, 10)}`,
        value: { text: sig.user_text.slice(0, 240), intent: sig.intent },
        source: "correction", confidence: 0.9,
      });
    }
    // Successful drafts on merchants → learn frequent merchant + category
    for (const c of sig.tool_calls) {
      if (!c.ok) continue;
      if (c.tool_name === "create_transaction_draft") {
        const merchant = String(c.args?.description ?? "").trim();
        const category = c.args?.category ?? null;
        if (merchant) {
          await remember(sb, {
            user_id: sig.user_id, kind: "frequent_merchant",
            key: merchant, value: { category, last_amount: c.args?.amount },
            source: "inferred", confidence: 0.55,
          });
        }
        if (category) {
          await remember(sb, {
            user_id: sig.user_id, kind: "favorite_category",
            key: String(category), value: { count: 1 },
            source: "inferred", confidence: 0.5,
          });
        }
      }
    }
  } catch (e) {
    console.error("[learning-loop]", String((e as Error).message).slice(0, 200));
  }
}

async function reinforceRecent(sb: SupabaseClient, user_id: string): Promise<void> {
  const facts = await recall(sb, user_id, { limit: 10 });
  for (const f of facts) {
    if (f.source === "user") continue;
    const next = Math.min(1, f.confidence + 0.05);
    await sb.from("agent_memory").update({
      confidence: next,
      use_count: (f.use_count ?? 0) + 1,
      last_used_at: new Date().toISOString(),
    }).eq("id", f.id);
  }
}
