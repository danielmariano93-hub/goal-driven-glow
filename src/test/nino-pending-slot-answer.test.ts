// Regressão: "Itaú" como resposta a "Em qual conta eu registro?" era reinterpretado pelo
// LLM como escrita nova e as duas leituras divergiam (~50% de falha). Agora preenche o slot.
import { describe, expect, it } from "vitest";
import { interpretConversationTurn } from "../../supabase/functions/_shared/agent/core/ConversationAuthority";
import { workflowFromContract } from "../../supabase/functions/_shared/agent/core/ConversationBrainRuntime";
import { nextStep } from "../../supabase/functions/_shared/agent/core/WriteWorkflowManager";

describe("resposta de conta ao slot pendente", () => {
  const workflow = { id: "w1", kind: "create_transaction_draft", slots: { amount: 35, description: "almoço", date: "2026-10-02", type: "expense" }, asked_slot: "account", turns: 1 } as never;
  it("vira write follow_up com a conta, sem chamar o modelo", async () => {
    const out: any = await interpretConversationTurn({ text: "Itaú", history: [], memory: null, workflow, user_context: null, model: null, sb: null, user_id: "u", run_id: null } as never);
    expect(out.contract.mode).toBe("write");
    expect(out.contract.action.action).toBe("transaction.create");
    expect(out.telemetry.ok).toBe(true);
    const built = workflowFromContract(out.contract, workflow);
    expect(built.workflow?.slots.account ?? built.workflow?.slots.account_hint).toBeTruthy();
    expect(nextStep(built.workflow!).status).not.toBe("needs_slot");
  });
});
