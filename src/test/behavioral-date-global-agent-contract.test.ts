import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveBehavioralDate } from "../../supabase/functions/_shared/analytics/behavioralDate";

const source = (path: string) => readFileSync(path, "utf8");

describe("contrato global de data comportamental e capacidades do Nino", () => {
  it("preserva a data contábil e bloqueia postagem bancária de baixa confiança", () => {
    const resolved = resolveBehavioralDate({
      occurred_at: "2026-08-03",
      behavioral_day: "2026-08-03",
      behavior_date_source: "bank_posting_date",
      behavior_date_confidence: 0.35,
    });
    expect(resolved.day).toBe("2026-08-03");
    expect(resolved.eligibleForBehavior).toBe(false);
  });

  it("faz rollout sem e-mail, UUID pessoal ou lista piloto", () => {
    const migration = source("supabase/migrations/20260807120000_behavioral_date_global_rollout_and_agent_capabilities.sql");
    expect(migration).toContain("anticipation_rollout_pct=100");
    expect(migration).toContain("anticipation_rollout_user_ids='{}'::uuid[]");
    expect(migration).toContain("SELECT public.reprocess_transaction_behavior_dates(250000)");
    expect(migration).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(migration).not.toContain("@gmail.com");
  });

  it("expõe as mesmas capacidades no registro compartilhado do agente", () => {
    const tools = source("supabase/functions/_shared/agent/tools.ts");
    for (const name of ["get_weekday_spending_pattern", "run_before_spending", "get_goals_overview", "create_split_expense_draft"]) {
      expect(tools).toContain(`name: "${name}"`);
    }
    const pending = source("supabase/functions/_shared/agent/core/PendingConfirmations.ts");
    expect(pending).toContain("agent_execute_shared_expense_confirmation");
    expect(tools).toContain("category_goal_impact");
  });
});
