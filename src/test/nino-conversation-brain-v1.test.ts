import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  actionForTool, toolForAction, validateActionIR,
} from "../../supabase/functions/_shared/agent/core/ActionIR.ts";
import {
  dialogueActsFromContract,
  normalizeConversationTurnContract,
  validateConversationTurnContract,
  type ConversationTurnContract,
} from "../../supabase/functions/_shared/agent/core/ConversationTurnContract.ts";

function contract(over: Partial<ConversationTurnContract>): ConversationTurnContract {
  return {
    version: "conversation_turn_contract.v1",
    act: "new_request",
    mode: "read",
    canonical_request: "Quanto gastei com Alimentação este mês?",
    inherit_focus: false,
    focus: { category: "Alimentação", merchant: null, goal: null, period_expression: "este mês" },
    action: null,
    direct_reply: null,
    clarification_question: null,
    confidence: 0.95,
    ...over,
  };
}

describe("Conversation Architecture V2 — contratos duros", () => {
  it("ActionIR mapeia cada domínio para uma única draft tool", () => {
    expect(toolForAction("goal.create")).toBe("create_goal_draft");
    expect(toolForAction("transaction.create")).toBe("create_transaction_draft");
    expect(toolForAction("transfer.create")).toBe("create_transfer_draft");
    expect(actionForTool("create_goal_draft")).toBe("goal.create");
    expect(actionForTool("create_transaction_draft")).not.toBe("goal.create");
  });

  it("write sem ActionIR falha fechado", () => {
    const normalized = normalizeConversationTurnContract({
      act: "new_request", mode: "write", canonical_request: "cria uma meta",
      inherit_focus: false,
      focus: { category: null, merchant: null, goal: null, period_expression: null },
      action: null, direct_reply: null, clarification_question: null, confidence: 0.9,
    });
    expect(normalized).toBeNull();
  });

  it("action fora de WRITE falha fechado", () => {
    expect(normalizeConversationTurnContract({
      act: "new_request", mode: "read", canonical_request: "qual minha meta?",
      inherit_focus: false,
      focus: { category: null, merchant: null, goal: null, period_expression: null },
      action: { action: "goal.create", slots: { target_amount: 5000 } },
      direct_reply: null, clarification_question: null, confidence: 0.9,
    })).toBeNull();
  });

  it("repair e follow-up viram estado conversacional, não outro router", () => {
    expect(dialogueActsFromContract(contract({ act: "repair", inherit_focus: true }))).toEqual(["repair"]);
    expect(dialogueActsFromContract(contract({ act: "follow_up", inherit_focus: true }))).toEqual(["followup"]);
  });

  it("ActionIR estruturalmente inválido é recusado", () => {
    expect(validateActionIR({ version: "action_ir.v1", action: "goal.create", slots: { target_amount: 5000 } })).toEqual([]);
    expect(validateActionIR({ version: "action_ir.v1", action: "made.up", slots: {} })).toContain("action_ir_action_invalid");
  });
});

describe("Golden conversation — 12 turnos sem falar com o sistema", () => {
  const turns: Array<{ user: string; expected: ConversationTurnContract }> = [
    {
      user: "Quanto eu gastei com alimentação esse mês?",
      expected: contract({ act: "new_request", inherit_focus: false }),
    },
    {
      user: "E no mês passado?",
      expected: contract({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Quanto gastei com Alimentação no mês passado?",
        focus: { category: "Alimentação", merchant: null, goal: null, period_expression: "mês passado" },
      }),
    },
    {
      user: "Quais os estabelecimentos?",
      expected: contract({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Quais estabelecimentos compõem meus gastos de Alimentação no mês passado?",
        focus: { category: "Alimentação", merchant: null, goal: null, period_expression: "mês passado" },
      }),
    },
    {
      user: "Qual foi o maior?",
      expected: contract({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Qual estabelecimento teve o maior gasto em Alimentação no mês passado?",
      }),
    },
    {
      user: "E por quê?",
      expected: contract({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Explique a mudança dos gastos de Alimentação no contexto que estamos analisando.",
      }),
    },
    {
      user: "E se eu reduzir isso em 20%?",
      expected: contract({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Simule reduzir em 20% os gastos de Alimentação do contexto atual.",
      }),
    },
    {
      user: "Como isso impacta minha meta?",
      expected: contract({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Avalie como a economia simulada impacta minha meta relevante no contexto atual.",
      }),
    },
    {
      user: "A de dezembro.",
      expected: contract({
        act: "answer", inherit_focus: true,
        canonical_request: "Use a meta de dezembro para a análise anterior.",
        focus: { category: "Alimentação", merchant: null, goal: "meta de dezembro", period_expression: "mês passado" },
      }),
    },
    {
      user: "Quanto eu teria que guardar?",
      expected: contract({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Quanto preciso guardar para cumprir a meta de dezembro?",
      }),
    },
    {
      user: "Cria uma meta de R$ 5.000 até o fim do ano.",
      expected: contract({
        act: "new_request", mode: "write", canonical_request: "Criar uma meta de R$ 5.000 até o fim do ano.",
        inherit_focus: false,
        focus: { category: null, merchant: null, goal: null, period_expression: "fim do ano" },
        action: { version: "action_ir.v1", action: "goal.create", slots: { target_amount: 5000, target_date_expression: "fim do ano" } },
      }),
    },
    {
      user: "Não foi isso que eu pedi.",
      expected: contract({
        act: "repair", mode: "read", canonical_request: "Corrigir a interpretação da solicitação anterior.",
        inherit_focus: true,
      }),
    },
    {
      user: "Volta no que a gente estava falando de alimentação.",
      expected: contract({
        act: "topic_switch", mode: "read",
        canonical_request: "Retomar a análise de Alimentação.",
        inherit_focus: false,
      }),
    },
  ];

  it("cada turno respeita os invariantes do contrato", () => {
    expect(turns).toHaveLength(12);
    for (const fixture of turns) {
      expect(validateConversationTurnContract(fixture.expected), fixture.user).toEqual([]);
    }
  });

  it("fragmentos herdam foco e tópico novo não herda silenciosamente", () => {
    for (const { user, expected } of turns) {
      if (expected.act === "follow_up" || expected.act === "answer" || expected.act === "repair") {
        expect(expected.inherit_focus, user).toBe(true);
      }
      if (expected.act === "topic_switch") expect(expected.inherit_focus, user).toBe(false);
    }
  });

  it("o turno de meta só pode produzir goal.create", () => {
    const goalTurn = turns.find((t) => t.user.startsWith("Cria uma meta"))!.expected;
    expect(goalTurn.action?.action).toBe("goal.create");
    expect(toolForAction(goalTurn.action!.action)).toBe("create_goal_draft");
  });
});

describe("Wiring arquitetural", () => {
  it("canais entram pelo AgentCoreV2 e o hot path normal não tem autoridade concorrente", () => {
    const orchestrator = readFileSync("supabase/functions/_shared/agent/orchestrator.ts", "utf8");
    const whatsapp = readFileSync("supabase/functions/_shared/agent/core/adapters/WhatsAppAdapter.ts", "utf8");
    const app = readFileSync("supabase/functions/_shared/agent/core/adapters/AppAdapter.ts", "utf8");
    const v2 = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");

    expect(orchestrator).toContain("handleTurnV2(");
    expect(whatsapp).toContain("handleTurnV2(");
    expect(app).toContain("handleTurnV2(");
    expect(v2).toContain('isEnabled("conversation_brain_v1"');
    expect(v2).toContain("preservation_enforced: true");
    expect(v2).not.toContain("classifyCapability(");
    expect(v2).not.toContain("routeIntent(");
    expect(v2).not.toContain("classifyDialogueState(");
  });

  it("falha do Brain abandona V2 em vez de empilhar o legado depois da interpretação", () => {
    const v2 = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    expect(v2).toContain("if (!brain.contract) return await handleLegacyTurn(input)");
  });
});
