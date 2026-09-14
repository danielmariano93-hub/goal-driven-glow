import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rolloutDecision } from "../../supabase/functions/_shared/agent/core/FeatureFlags.ts";

describe("Conversation Brain shadow v1", () => {
  it("nasce desligado e com rollout 0%", () => {
    const migration = readFileSync("supabase/migrations/20260913220000_nino_conversation_brain_v1.sql", "utf8");
    expect(migration).toContain("'conversation_brain_shadow_v1', false, 0");
    expect(rolloutDecision("conversation_brain_shadow_v1", "user-a", {
      enabled: false, rollout_percent: 100, pilot_user_ids: [],
    })).toBe(false);
    expect(rolloutDecision("conversation_brain_shadow_v1", "user-a", {
      enabled: true, rollout_percent: 0, pilot_user_ids: [],
    })).toBe(false);
  });

  it("shadow armazena contrato/telemetria sem possuir runtime de tools", () => {
    const source = readFileSync("supabase/functions/_shared/agent/core/ConversationBrainShadow.ts", "utf8");
    expect(source).toContain("interpretConversationTurn");
    expect(source).toContain("conversation_brain_shadow_evaluations");
    expect(source).not.toContain("runTool(");
    expect(source).not.toContain("executeBrainWriteTurn(");
    expect(source).not.toContain("create_transaction_draft");
    expect(source).not.toContain("create_goal_draft");
  });

  it("quando shadow está ativo, o legado continua sendo a resposta autoritativa", () => {
    const core = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    expect(core).toContain('isEnabled("conversation_brain_shadow_v1"');
    expect(core).toContain("Promise.all([");
    expect(core).toContain("handleLegacyTurn(input)");
    expect(core).toContain("evaluateConversationBrainShadow({");
    expect(core).toContain("return legacy;");
  });

  it("telemetria shadow não é exposta ao usuário autenticado", () => {
    const migration = readFileSync("supabase/migrations/20260913220000_nino_conversation_brain_v1.sql", "utf8");
    expect(migration).toContain("conversation_brain_shadow_evaluations ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON public.conversation_brain_shadow_evaluations FROM authenticated, anon");
    expect(migration).toContain("GRANT ALL ON public.conversation_brain_shadow_evaluations TO service_role");
  });
});
