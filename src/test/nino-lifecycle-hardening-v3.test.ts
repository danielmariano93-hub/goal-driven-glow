import { describe, expect, it } from "vitest";
import {
  leaksInfrastructure,
  sanitizeUserFacingText,
  USER_SAFE_MESSAGES,
} from "../../supabase/functions/_shared/agent/core/UserSafeError";
import {
  captureReferenceObjects,
} from "../../supabase/functions/_shared/agent/core/ConversationReferenceStore";
import { groundTurnContract } from "../../supabase/functions/_shared/agent/core/GroundingEngine";
import { normalizeConversationTurnContract } from "../../supabase/functions/_shared/agent/core/ConversationTurnContract";
import { interpretConversationTurn } from "../../supabase/functions/_shared/agent/core/ConversationAuthority";
import { bridgeTurnSpecV3ToRuntime } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";

describe("Nino lifecycle hardening — linguagem humana", () => {
  it("bloqueia exatamente o tipo de resposta técnica que vazou no WhatsApp", () => {
    const leaked = "📊 Não consegui validar com segurança que o cálculo executado preservou exatamente o recorte da sua pergunta. Para não te entregar um número de outra janela, categoria ou regra de comparação, bloqueei a resposta.";
    expect(leaksInfrastructure(leaked)).toBe(true);
    expect(sanitizeUserFacingText(leaked)).toBe(USER_SAFE_MESSAGES.AI_TEMPORARY_UNAVAILABLE);
  });

  it("não bloqueia uma resposta financeira humana e simples", () => {
    const text = "Aqui está a evolução dos seus gastos mês a mês. 📊";
    expect(leaksInfrastructure(text)).toBe(false);
    expect(sanitizeUserFacingText(text)).toBe(text);
  });
});

describe("Nino lifecycle hardening — referência de dívida", () => {
  it("guarda a dívida que acabou de ser mostrada ao usuário", () => {
    const refs = captureReferenceObjects([{
      tool_name: "get_debt_status",
      ok: true,
      args: {},
      result: {
        facts: {
          worst: null,
          next_due: { name: "Empréstimo Lucas", outstanding_balance: 1200 },
        },
      },
    }], new Date("2026-09-27T03:00:00Z"));

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ target: "debt", entity_labels: ["Empréstimo Lucas"] });
  });

  it("'essa dívida' preenche a ação de pagamento sem inventar outro nome", () => {
    const turn = normalizeConversationTurnContract({
      version: "conversation_turn_contract.v2",
      act: "follow_up",
      mode: "write",
      domain: "financial_write",
      canonical_request: "Pagar 300 reais dessa dívida",
      inherit_focus: true,
      focus: { category: null, merchant: null, goal: null, period_expression: null, period_expressions: [] },
      action: { version: "action_ir.v1", action: "debt.pay", slots: { amount: "300" } },
      direct_reply: null,
      clarification_question: null,
      resolution: { intent: "resolved", reference: "resolved", time: "not_applicable", entity: "not_applicable", action: "resolved" },
      reference: { kind: "previous_entity", target: "debt", expression: "essa dívida", status: "resolved" },
      financial_read: null,
      advisory_kind: null,
    });
    expect(turn).not.toBeNull();

    const now = new Date("2026-09-27T03:05:00Z");
    const memory = {
      references: [{
        id: "ref-debt-1",
        type: "entity",
        target: "debt",
        entity_labels: ["Empréstimo Lucas"],
        created_at: "2026-09-27T03:00:00.000Z",
        expires_at: "2026-09-27T03:30:00.000Z",
        turns_remaining: 5,
        status: "active",
        source: { tool_name: "get_debt_status", query_id: null },
      }],
      active_topic_id: null,
      active_category: null,
      active_merchant: null,
    } as any;

    const grounded = groundTurnContract(turn!, memory, now);
    expect(grounded.ok).toBe(true);
    expect(grounded.turn.action?.slots.debt).toBe("Empréstimo Lucas");
    expect(grounded.turn.action?.slots.amount).toBe("300");
  });

  it("V3 não perde 'essa dívida' ao passar para a execução", () => {
    const bridged = bridgeTurnSpecV3ToRuntime({
      version: "turn_spec.v3",
      kind: "task",
      act: "follow_up",
      response_intent: "execute",
      canonical_request: "Pagar 300 reais dessa dívida",
      inherit_topic: true,
      references: [{
        kind: "entity_reference",
        target: "debt",
        expression: "essa dívida",
        source: "current_turn",
      }],
      tasks: [{
        kind: "financial_write",
        family: "financial.write",
        action: "debt.pay",
        slots: { amount: "300" },
      }],
    } as any);

    expect(bridged.ok).toBe(true);
    if (!bridged.ok) return;
    expect(bridged.contract.reference).toMatchObject({
      kind: "previous_entity",
      target: "debt",
      expression: "essa dívida",
    });
    expect(bridged.contract.action?.action).toBe("debt.pay");
  });
});

describe("Nino lifecycle hardening — ações compostas", () => {
  it("criar meta + aporte inicial vira uma única ação atômica", () => {
    const bridged = bridgeTurnSpecV3ToRuntime({
      version: "turn_spec.v3",
      kind: "task",
      act: "new_request",
      response_intent: "execute",
      canonical_request: "Criar meta Viagem de 20 mil e já colocar 500 nela",
      inherit_topic: false,
      references: [],
      tasks: [
        {
          kind: "financial_write",
          family: "financial.write",
          action: "goal.create",
          slots: { name: "Viagem", target_amount: "20000" },
        },
        {
          kind: "financial_write",
          family: "financial.write",
          action: "goal.contribute",
          slots: { goal: "Viagem", amount: "500" },
        },
      ],
    } as any);

    expect(bridged.ok).toBe(true);
    if (!bridged.ok) return;
    expect(bridged.contract.action?.action).toBe("goal.create");
    expect(bridged.contract.action?.slots).toMatchObject({
      name: "Viagem",
      target_amount: "20000",
      initial_contribution: "500",
    });
  });

  it("não executa parcialmente duas escritas sem compilador atômico", () => {
    const bridged = bridgeTurnSpecV3ToRuntime({
      version: "turn_spec.v3",
      kind: "task",
      act: "new_request",
      response_intent: "execute",
      canonical_request: "Registrar um gasto e criar uma categoria",
      inherit_topic: false,
      references: [],
      tasks: [
        { kind: "financial_write", family: "financial.write", action: "transaction.create", slots: { amount: "50" } },
        { kind: "financial_write", family: "financial.write", action: "category.create", slots: { name: "Teste" } },
      ],
    } as any);

    expect(bridged.ok).toBe(false);
  });
});

describe("Nino lifecycle hardening — atalhos determinísticos", () => {
  it("'mostra isso em gráfico' reutiliza a série mensal sem chamar IA", async () => {
    const outcome = await interpretConversationTurn({
      text: "Me mostra isso em gráfico",
      history: [],
      memory: {
        active_category: "Lazer",
        active_merchant: null,
        references: [{
          id: "monthly-ref",
          type: "entity",
          target: "category",
          entity_labels: ["Lazer"],
          created_at: "2026-09-27T03:00:00.000Z",
          expires_at: "2099-09-27T03:30:00.000Z",
          turns_remaining: 5,
          status: "active",
          source: {
            tool_name: "spending_timeseries_monthly",
            query_id: null,
            context: {
              evidence: {
                kind: "monthly_series",
                version: "nino_monthly_series.v1",
                formula_version: "test",
                months: [{ month: "2026-08", total: 100, has_data: true, transaction_count: 1 }],
                total: 100,
                transaction_count: 1,
                window: { from: "2026-08-01", to: "2026-08-31", n: 1 },
                scope: { category: "Lazer", merchant: null },
                partial_first_month: false,
                partial_last_month: false,
              },
            },
          },
        }],
      } as any,
      workflow: null,
      model: "unused",
      user_id: null,
    } as any);

    expect(outcome.telemetry.llm_calls).toBe(0);
    expect(outcome.contract?.direct_reply).toContain("gráfico");
  });

  it("'e no mês passado?' reaproveita uma análise de gastos sem chamar IA", async () => {
    const outcome = await interpretConversationTurn({
      text: "E no mês passado?",
      history: [],
      memory: {
        active_category: "Alimentação",
        active_merchant: null,
        last_tool_context: { tool: "analyze_spending", period: null },
        references: [],
      } as any,
      workflow: null,
      model: "unused",
      user_id: null,
    } as any);

    expect(outcome.telemetry.llm_calls).toBe(0);
    expect(outcome.contract?.mode).toBe("read");
    expect(outcome.contract?.focus.category).toBe("Alimentação");
    expect(outcome.contract?.focus.period_expression).toMatch(/mês passado/i);
  });

  it("'desfaz isso' vira reversão segura sem depender da IA", async () => {
    const outcome = await interpretConversationTurn({
      text: "Desfaz isso",
      history: [],
      memory: null,
      workflow: null,
      model: "unused",
      user_id: null,
    } as any);

    expect(outcome.telemetry.llm_calls).toBe(0);
    expect(outcome.contract?.mode).toBe("write");
    expect(outcome.contract?.action?.action).toBe("undo.last");
  });
});