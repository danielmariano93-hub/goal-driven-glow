import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compileDeterministicConversationTurn } from "../../supabase/functions/_shared/agent/core/DeterministicConversationCompiler";
import { isProviderCapacityFailure } from "../../supabase/functions/_shared/agent/core/ConversationAuthority";
import { groundTurnContract, applyGroundedReferenceScope } from "../../supabase/functions/_shared/agent/core/GroundingEngine";

function activeDebtMemory() {
  return {
    active_category: null,
    active_merchant: null,
    references: [{
      id: "debt-ref",
      type: "entity",
      target: "debt",
      entity_labels: ["Empréstimo Lucas"],
      created_at: "2026-09-27T12:00:00.000Z",
      expires_at: "2099-09-27T12:30:00.000Z",
      turns_remaining: 5,
      status: "active",
      source: { tool_name: "get_debt_status", query_id: null },
    }],
  } as any;
}

function activeSpendingMemory() {
  return {
    active_category: "Alimentação",
    active_merchant: null,
    references: [],
    last_tool_context: { tool: "analyze_spending", period: null },
  } as any;
}

const compile = (text: string, memory: any = null) => compileDeterministicConversationTurn({ text, memory });

describe("Nino deterministic-first — sem gastar quota em intenção inequívoca", () => {
  it("consulta dívidas sem IA", () => {
    const turn = compile("Quais dívidas eu tenho? Mostra saldo, parcelas e vencimentos");
    expect(turn?.mode).toBe("read");
    expect(turn?.financial_read?.queries[0]).toMatchObject({ metric: "debt_balance", operation: "value" });
  });

  it("registra pagamento parcial de dívida sem IA", () => {
    const turn = compile("Registra R$300 de pagamento na dívida do Lucas");
    expect(turn?.action).toMatchObject({ action: "debt.pay", slots: { debt: "Lucas", amount: 300 } });
  });

  it("quita dívida pelo saldo conhecido no executor, sem exigir valor na frase", () => {
    const turn = compile("Quita a dívida do Lucas");
    expect(turn?.action).toMatchObject({ action: "debt.pay", slots: { debt: "Lucas", full_payment: true } });
  });

  it("resolve 'nessa' pela memória da dívida e passa escopo ao motor", () => {
    const memory = activeDebtMemory();
    const turn = compile("Paga R$200 nessa", memory);
    expect(turn?.action?.action).toBe("debt.pay");
    expect(turn?.reference?.target).toBe("debt");
    const grounded = groundTurnContract(turn!, memory, new Date("2026-09-27T12:05:00Z"));
    expect(grounded.ok).toBe(true);
    expect(grounded.turn.action?.slots.debt).toBe("Empréstimo Lucas");
    expect(applyGroundedReferenceScope("get_debt_status", {}, grounded.reference)).toEqual({ debt_name: "Empréstimo Lucas" });
  });

  it("lista metas sem IA", () => {
    const turn = compile("Quais metas eu tenho e quanto falta?");
    expect(turn?.financial_read?.queries[0]).toMatchObject({ metric: "goal_progress", operation: "value" });
  });

  it("cria meta + aporte inicial em uma única ação atômica", () => {
    const turn = compile("Cria uma meta Reserva de Emergência de R$20 mil e já coloca R$500 nela");
    expect(turn?.action).toMatchObject({
      action: "goal.create",
      slots: { name: "Reserva de Emergência", target_amount: 20000, initial_contribution: 500 },
    });
  });

  it("cria recorrência sem degradar para lançamento único", () => {
    const turn = compile("Registra Netflix de R$39,90 todo dia 10 como assinatura recorrente");
    expect(turn?.action?.action).toBe("recurring.create");
    expect(turn?.action?.slots).toMatchObject({ amount: 39.9, day_of_month: 10, frequency: "monthly" });
  });

  it("faz CRUD explícito de categoria sem IA", () => {
    expect(compile("Cria uma categoria chamada Pets")?.action)
      .toMatchObject({ action: "category.create", slots: { name: "Pets" } });
    expect(compile("Renomeia a categoria Pets para Animais")?.action)
      .toMatchObject({ action: "category.update", slots: { category: "Pets", new_name: "Animais" } });
    expect(compile("Exclui a categoria Animais")?.action)
      .toMatchObject({ action: "category.delete", slots: { category: "Animais" } });
  });

  it("edita e exclui lançamento explicitamente sem IA", () => {
    expect(compile("Corrige o último Uber para R$79,90")?.action)
      .toMatchObject({ action: "transaction.update", slots: { transaction: "o último Uber", amount: 79.9 } });
    expect(compile("Apaga o último lançamento de Uber")?.action)
      .toMatchObject({ action: "transaction.delete", slots: { transaction: "de Uber" } });
  });

  it("registra recebimento da divisão sem IA", () => {
    const turn = compile("O Lucas já me pagou R$120 da divisão do jantar");
    expect(turn?.action).toMatchObject({ action: "split.receive", slots: { participant: "Lucas", amount: 120 } });
  });

  it("consulta de gasto por categoria não precisa do 120B", () => {
    const turn = compile("Quanto gastei com lazer este mês?");
    expect(turn?.financial_read?.queries[0]).toMatchObject({
      metric: "expense_amount",
      operation: "sum",
      filters: [{ field: "category", value: "Lazer", op: "eq" }],
    });
  });

  it("follow-up por estabelecimentos reutiliza categoria ativa", () => {
    const turn = compile("Em quais estabelecimentos?", activeSpendingMemory());
    expect(turn?.financial_read?.queries[0]).toMatchObject({
      metric: "expense_amount",
      operation: "breakdown",
      group_by: ["merchant"],
    });
  });

  it("série mês a mês reutiliza categoria ativa", () => {
    const turn = compile("Mostra mês a mês os últimos 5 meses", activeSpendingMemory());
    expect(turn?.financial_read?.queries[0]).toMatchObject({ metric: "expense_amount", operation: "trend", group_by: ["month"] });
  });
});

describe("Nino provider resilience — 429 não dispara retry cego no mesmo provedor", () => {
  it("classifica somente falhas reais de capacidade/transporte", () => {
    expect(isProviderCapacityFailure("structured_call_gateway_429")).toBe(true);
    expect(isProviderCapacityFailure("rate limit exceeded")).toBe(true);
    expect(isProviderCapacityFailure("structured_call_gateway_503")).toBe(true);
    expect(isProviderCapacityFailure("semantic_interpreter_v3_contract_invalid")).toBe(false);
  });

  it("deploy automático não executa inferência real do Groq", () => {
    const workflow = readFileSync(".github/workflows/nino-supabase-deploy.yml", "utf8");
    expect(workflow).not.toContain("nino_conversation_provider_smoke.ts");
    expect(workflow).toContain("https://api.groq.com/openai/v1/models");
  });
});
