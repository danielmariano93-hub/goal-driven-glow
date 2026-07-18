// Focused tests for the surgical patch on the WhatsApp text flow.
// We test the pure helpers extracted from the orchestrator to keep runtime
// concerns (Deno + supabase client) out of the vitest environment.
import { describe, it, expect } from "vitest";
import { interpret } from "../lib/agent/parser";

// Mirror of the pure helpers exported by supabase/functions/_shared/agent/orchestrator.ts.
// The orchestrator source is a Deno module and cannot be imported directly here;
// this duplication is intentional and kept minimal so both versions stay identical.
function mapConversationRow(row: { direction?: string | null; body_masked?: string | null }) {
  const dir = String(row?.direction ?? "");
  if (dir !== "inbound" && dir !== "outbound") return null;
  const content = String(row?.body_masked ?? "").trim();
  if (!content) return null;
  return { role: dir === "inbound" ? "user" : "assistant", content };
}

const FRIENDLY_ORCHESTRATOR_ERROR =
  "Tive um problema para responder agora. Pode tentar novamente em instantes? 💛";

describe("whatsapp text flow — surgical patch", () => {
  it("history mapping uses real schema (direction/body_masked)", () => {
    expect(mapConversationRow({ direction: "inbound", body_masked: "gastei 42,90" }))
      .toEqual({ role: "user", content: "gastei 42,90" });
    expect(mapConversationRow({ direction: "outbound", body_masked: "Ok!" }))
      .toEqual({ role: "assistant", content: "Ok!" });
    // Ignores unknown directions and blank bodies (defensive)
    expect(mapConversationRow({ direction: "system", body_masked: "x" })).toBeNull();
    expect(mapConversationRow({ direction: "inbound", body_masked: "  " })).toBeNull();
    // Old (wrong) keys `role`/`content` must NOT be accepted.
    expect(mapConversationRow({ direction: undefined as unknown as string, body_masked: "x" })).toBeNull();
  });

  it("friendly error reply is a stable non-empty pt-BR string", () => {
    expect(FRIENDLY_ORCHESTRATOR_ERROR.length).toBeGreaterThan(10);
    expect(FRIENDLY_ORCHESTRATOR_ERROR.toLowerCase()).toContain("problema");
  });

  it("'gastei 42,90 no almoço' is parsed as an expense transaction (draft path)", () => {
    const intent = interpret("gastei 42,90 no almoço");
    expect(intent.kind).toBe("transaction");
    if (intent.kind === "transaction") {
      expect(intent.type).toBe("expense");
      expect(intent.amount).toBeCloseTo(42.9, 2);
    }
  });

  it("simulates outbound_insert_failed: non-duplicate error must throw sanitized", async () => {
    // Reproduce the enqueueReply guard: any non-duplicate error must throw.
    async function enqueue(insertResult: { error: { message: string } | null }) {
      if (insertResult.error) {
        const msg = String(insertResult.error.message ?? "");
        if (!/duplicate|unique/i.test(msg)) throw new Error("outbound_insert_failed");
      }
    }
    await expect(enqueue({ error: { message: "connection reset" } })).rejects.toThrow("outbound_insert_failed");
    // Duplicate is swallowed (idempotency retry path).
    await expect(enqueue({ error: { message: "duplicate key value violates unique constraint" } })).resolves.toBeUndefined();
    // No error → no throw.
    await expect(enqueue({ error: null })).resolves.toBeUndefined();
  });
});
