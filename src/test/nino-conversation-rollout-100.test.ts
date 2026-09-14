import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Conversation Architecture V2 — rollout de produção", () => {
  it("ativa Conversation Brain e Write Workflow para 100% dos usuários", () => {
    const migration = readFileSync(
      "supabase/migrations/20260914170000_nino_conversation_brain_rollout_100.sql",
      "utf8",
    );

    expect(migration).toContain("'conversation_brain_v1', true, 100");
    expect(migration).toContain("'write_workflow_v1', true, 100");
  });

  it("mantém shadow desativado quando V2 passa a ser autoritativo", () => {
    const migration = readFileSync(
      "supabase/migrations/20260914170000_nino_conversation_brain_rollout_100.sql",
      "utf8",
    );

    expect(migration).toContain("'conversation_brain_shadow_v1', false, 0");
    expect(migration).toContain("ON CONFLICT (flag_name) DO UPDATE");
  });
});
