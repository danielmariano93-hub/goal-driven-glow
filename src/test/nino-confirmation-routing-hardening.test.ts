import { describe, expect, it } from "vitest";
import { confirmationExecutor } from "../../supabase/functions/_shared/agent/core/PendingConfirmations";

describe("Nino lifecycle hardening — confirmation routing", () => {
  it("routes split receipts through the date-aware atomic executor", () => {
    expect(confirmationExecutor("split_receive")).toBe("agent_execute_split_receive_confirmation_v1");
  });

  it("keeps recurrence and generic lifecycle executors isolated", () => {
    expect(confirmationExecutor("recurring_create")).toBe("agent_execute_recurring_confirmation_v1");
    expect(confirmationExecutor("debt_payment")).toBe("agent_execute_lifecycle_confirmation_v1");
  });
});
