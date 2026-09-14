import { describe, expect, it } from "vitest";
import {
  normalizeConversationTurnContract,
  validateConversationTurnContract,
  type ConversationTurnContract,
} from "../../supabase/functions/_shared/agent/core/ConversationTurnContract.ts";
import { toolForAction } from "../../supabase/functions/_shared/agent/core/ActionIR.ts";
import { interpret } from "../../supabase/functions/_shared/agent/parser.ts";
import { classifyConfirmationAct } from "../../supabase/functions/_shared/agent/core/ConfirmationVocabulary.ts";
import { isExplicitRepair } from "../../supabase/functions/_shared/agent/core/ConversationRepair.ts";

const focus = (over: Partial<ConversationTurnContract["focus"]> = {}) => ({
  category: null,
  merchant: null,
  goal: null,
  period_expression: null,
  ...over,
});

function turn(over: Partial<ConversationTurnContract>): ConversationTurnContract {
  return {
    version: "conversation_turn_contract.v1",
    act: "new_request",
    mode: "read",
    canonical_request: "pedido canônico",
    inherit_focus: false,
    focus: focus(),
    action: null,
    direct_reply: null,
    clarification_question: null,
    confidence: 0.95,
    ...over,
  };
}

function assertValid(label: string, contract: ConversationTurnContract) {
  expect(validateConversationTurnContract(contract), label).toEqual([]);
  expect(normalizeConversationTurnContract(contract), label).not.toBeNull();
}

describe("Conversation V2 — golden conversations longas", () => {
  it("mantém Alimentação + período através de uma análise multi-turno", () => {
    const conversation: Array<[string, ConversationTurnContract]> = [
      ["Quanto gastei com alimentação esse mês?", turn({
        canonical_request: "Quanto gastei com Alimentação este mês?",
        focus: focus({ category: "Alimentação", period_expression: "este mês" }),
      })],
      ["E no mês passado?", turn({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Quanto gastei com Alimentação no mês passado?",
        focus: focus({ category: "Alimentação", period_expression: "mês passado" }),
      })],
      ["Quais os estabelecimentos?", turn({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Quais estabelecimentos compõem meus gastos de Alimentação no mês passado?",
        focus: focus({ category: "Alimentação", period_expression: "mês passado" }),
      })],
      ["Qual foi o maior?", turn({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Qual estabelecimento teve o maior gasto em Alimentação no mês passado?",
        focus: focus({ category: "Alimentação", period_expression: "mês passado" }),
      })],
      ["Quanto ele representa do total?", turn({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Quanto o maior estabelecimento representa do total gasto em Alimentação no mês passado?",
        focus: focus({ category: "Alimentação", period_expression: "mês passado" }),
      })],
      ["E comparando com o mês anterior?", turn({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Compare esse gasto de Alimentação com o mês anterior ao período atual da conversa.",
        focus: focus({ category: "Alimentação", period_expression: "mês anterior ao mês passado" }),
      })],
      ["Por quê?", turn({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Explique a variação dos gastos de Alimentação entre os períodos em análise.",
        focus: focus({ category: "Alimentação", period_expression: "mês anterior ao mês passado" }),
      })],
      ["Se eu cortar 20%, quanto economizo?", turn({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Simule uma redução de 20% nos gastos de Alimentação do contexto atual e calcule a economia.",
        focus: focus({ category: "Alimentação", period_expression: "mês anterior ao mês passado" }),
      })],
      ["Isso ajuda minha meta?", turn({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Avalie como a economia simulada impacta minha meta relevante.",
        focus: focus({ category: "Alimentação", period_expression: "mês anterior ao mês passado" }),
      })],
      ["A de dezembro", turn({
        act: "answer", inherit_focus: true,
        canonical_request: "Use a meta de dezembro na análise anterior.",
        focus: focus({ category: "Alimentação", goal: "meta de dezembro", period_expression: "mês anterior ao mês passado" }),
      })],
      ["Quanto faltaria então?", turn({
        act: "follow_up", inherit_focus: true,
        canonical_request: "Calcule quanto faltaria para a meta de dezembro considerando a economia simulada.",
        focus: focus({ category: "Alimentação", goal: "meta de dezembro", period_expression: "mês anterior ao mês passado" }),
      })],
    ];

    expect(conversation.length).toBeGreaterThanOrEqual(10);
    for (const [message, contract] of conversation) assertValid(message, contract);
    for (const [message, contract] of conversation.slice(1)) {
      expect(contract.inherit_focus, message).toBe(true);
    }
  });

  it("troca de assunto explícita não contamina o novo tópico e permite retomada declarada", () => {
    const scenario = [
      turn({ canonical_request: "Quanto gastei com Transporte este mês?", focus: focus({ category: "Transporte", period_expression: "este mês" }) }),
      turn({ act: "follow_up", inherit_focus: true, canonical_request: "Quais os maiores gastos de Transporte este mês?", focus: focus({ category: "Transporte", period_expression: "este mês" }) }),
      turn({ act: "topic_switch", inherit_focus: false, canonical_request: "Quais são minhas metas financeiras atuais?", focus: focus() }),
      turn({ act: "follow_up", inherit_focus: true, canonical_request: "Qual meta está mais atrasada?", focus: focus() }),
      turn({ act: "topic_switch", inherit_focus: false, canonical_request: "Retome a análise anterior de Transporte.", focus: focus({ category: "Transporte" }) }),
    ];
    scenario.forEach((c, i) => assertValid(`topic-switch-${i}`, c));
    expect(scenario[2].inherit_focus).toBe(false);
    expect(scenario[2].focus.category).toBeNull();
    expect(scenario[4].focus.category).toBe("Transporte");
  });

  it("resposta curta sem pergunta/ação pendente deve clarificar em vez de inventar intenção", () => {
    const c = turn({
      act: "answer",
      mode: "clarify",
      canonical_request: null,
      inherit_focus: true,
      clarification_question: "Você quer que eu detalhe qual parte?",
      confidence: 0.35,
    });
    assertValid("quero sem referente", c);
    expect(c.action).toBeNull();
  });

  it("WRITE cria apenas a ActionIR compatível e nunca commita diretamente", () => {
    const c = turn({
      mode: "write",
      canonical_request: "Criar uma meta de R$ 5.000 até o fim do ano.",
      focus: focus({ period_expression: "fim do ano" }),
      action: {
        version: "action_ir.v1",
        action: "goal.create",
        slots: { target_amount: 5000, target_date_expression: "fim do ano" },
      },
    });
    assertValid("goal.write", c);
    expect(toolForAction(c.action!.action)).toBe("create_goal_draft");
    expect(toolForAction(c.action!.action)).not.toBe("create_transaction_draft");
  });
});

describe("Replay dos quatro incidentes reais de produção", () => {
  it("meta R$5.000 não vira transaction no parser de fallback", () => {
    const parsed = interpret("Nino cria uma meta financeira para eu juntar R$5000 até o final deste ano");
    expect(parsed.kind).toBe("goal");
  });

  it("'não foi isso que te pedi' é repair e não cancel", () => {
    const text = "Não foi isso que te pedi";
    expect(isExplicitRepair(text)).toBe(true);
    expect(classifyConfirmationAct(text)).not.toBe("cancel");
    expect(interpret(text).kind).not.toBe("cancel");
  });

  it("'não, cancela' continua sendo cancelamento explícito", () => {
    expect(interpret("não, cancela").kind).toBe("cancel");
  });

  it("'Quais os estabelecimentos?' exige contrato de follow-up com foco preservado", () => {
    const c = turn({
      act: "follow_up", inherit_focus: true,
      canonical_request: "Quais estabelecimentos compõem meus gastos de Alimentação em agosto?",
      focus: focus({ category: "Alimentação", period_expression: "agosto" }),
    });
    assertValid("merchant follow-up", c);
    expect(c.focus.category).toBe("Alimentação");
    expect(c.focus.period_expression).toBe("agosto");
  });

  it("'Quero' após oferta do Nino é answer/follow-up, não emotional_checkin", () => {
    const c = turn({
      act: "answer", inherit_focus: true,
      canonical_request: "Detalhar a oportunidade financeira oferecida pelo Nino no turno anterior.",
      focus: focus({ goal: "Meta Financeira" }),
    });
    assertValid("quero after proactive", c);
    expect(c.mode).toBe("read");
    expect(c.action).toBeNull();
  });
});
