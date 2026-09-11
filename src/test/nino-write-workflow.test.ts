// `nino_write_workflow.v1` — o fluxo de escrita multi-turno não pode morrer
// entre mensagens do WhatsApp nem virar um lançamento genérico.
import { describe, expect, it } from "vitest";
import {
  REQUIRED_SLOTS, MAX_WORKFLOW_TURNS, missingSlots, nextStep, applySlotAnswer,
  type WriteWorkflow,
} from "../../supabase/functions/_shared/agent/core/WriteWorkflowManager";

function wf(over?: Partial<WriteWorkflow>): WriteWorkflow {
  return { id: null, kind: "create_split_expense_draft", slots: {}, asked_slot: null, turns: 0, ...over };
}

describe("slots obrigatórios espelham o schema real das tools", () => {
  it("rolê exige título, total e participantes", () => {
    expect(REQUIRED_SLOTS.create_split_expense_draft).toEqual(["title", "total", "participants"]);
  });
  it("transferência exige as duas contas", () => {
    expect(REQUIRED_SLOTS.create_transfer_draft).toEqual(["amount", "from_account", "to_account"]);
  });
});

describe("missingSlots", () => {
  it("lista vazia de participantes conta como faltando", () => {
    const w = wf({ slots: { title: "Churrasco", total: 300, participants: [] } });
    expect(missingSlots(w)).toEqual(["participants"]);
  });
  it("valor zero é resposta válida, não slot vazio", () => {
    const w = wf({ kind: "create_transaction_draft", slots: { type: "expense", amount: 0 } });
    expect(missingSlots(w)).toEqual([]);
  });
});

describe("nextStep — próximo passo é determinístico", () => {
  it("pergunta o primeiro slot faltante com pergunta humana", () => {
    const step = nextStep(wf({ slots: { title: "Churrasco" } }));
    expect(step).toEqual({
      status: "needs_slot", kind: "create_split_expense_draft",
      slot: "total", question: "Qual o valor total?",
    });
  });

  it("fluxo completo devolve os argumentos canônicos da tool", () => {
    const step = nextStep(wf({ slots: { title: "Churrasco", total: 300, participants: ["Ana"] } }));
    expect(step).toEqual({
      status: "complete", kind: "create_split_expense_draft",
      args: { title: "Churrasco", total: 300, participants: ["Ana"] },
    });
  });

  it("não pergunta para sempre", () => {
    const step = nextStep(wf({ turns: MAX_WORKFLOW_TURNS }));
    expect(step.status).toBe("abandoned");
  });
});

describe("applySlotAnswer — continuidade real entre turnos", () => {
  it("resposta curta preenche exatamente o slot perguntado", () => {
    const before = wf({ slots: { title: "Churrasco" }, asked_slot: "total" });
    const after = applySlotAnswer(before, 300);
    expect(after.slots).toEqual({ title: "Churrasco", total: 300 });
    expect(after.asked_slot).toBeNull();
    expect(after.turns).toBe(1);
    // o próximo passo continua o MESMO fluxo, não abre um lançamento novo
    expect(nextStep(after)).toMatchObject({ kind: "create_split_expense_draft", slot: "participants" });
  });

  it("sem slot perguntado nada é preenchido às cegas", () => {
    const before = wf({ slots: { title: "Churrasco" } });
    expect(applySlotAnswer(before, "qualquer coisa")).toEqual(before);
  });
});
