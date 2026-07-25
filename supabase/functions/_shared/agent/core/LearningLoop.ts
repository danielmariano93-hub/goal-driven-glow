// LearningLoop — post-turn learning with structured corrections.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { remember, recall } from "./MemoryStore.ts";
import { interpretSemanticQuery } from "../../intelligence/semanticQuery.ts";

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
    if (sig.policy_decision === "confirm" || sig.reply_kind === "receipt") {
      await reinforceRecent(sb, sig.user_id);
    }

    const isCorrection = sig.policy_decision === "cancel"
      || /não era isso|não foi isso|nao era isso|nao foi isso|errado|corrigir|corrija|eu digo na média|eu digo na media|sem considerar/i.test(sig.user_text);
    if (isCorrection) {
      const semantic = interpretSemanticQuery(sig.user_text);
      const rejected = [...sig.tool_calls].reverse().find(c => c.ok)?.tool_name ?? null;
      const key = semantic ? `correction:${semantic.intent}` : `correction:${sig.intent}`;
      await remember(sb, {
        user_id: sig.user_id,
        kind: "correction",
        key,
        value: {
          text: sig.user_text.slice(0, 400),
          original_intent: sig.intent,
          corrected_intent: semantic?.intent ?? null,
          corrected_interpretation: semantic?.interpretation ?? null,
          corrected_metric_key: semantic?.metric_key ?? null,
          rejected_tool: rejected,
        },
        source: "correction",
        confidence: 0.98,
      });
    }

    for (const c of sig.tool_calls) {
      if (!c.ok) continue;
      if (c.tool_name === "create_transaction_draft") {
        const merchant = String(c.args?.description ?? "").trim();
        const category = c.args?.category ?? null;
        if (merchant) {
          await remember(sb, {
            user_id: sig.user_id,
            kind: "frequent_merchant",
            key: merchant,
            value: { category, last_amount: c.args?.amount },
            source: "inferred",
            confidence: 0.55,
          });
        }
        if (category) {
          await remember(sb, {
            user_id: sig.user_id,
            kind: "favorite_category",
            key: String(category),
            value: { count: 1 },
            source: "inferred",
            confidence: 0.5,
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
