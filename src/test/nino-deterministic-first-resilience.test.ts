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
    current_topic: "read",
    previous_intent: "read",
    active_category: "Alimentação",
    active_merchant: null,
    references: [],
    last_tool_context: { tool: "analyze_spending", period: null },
  } as any;
}

function activeOverallSpendingMemory() {
  return {
    current_topic: "read",
    previous_intent: "read",
    active_category: null,
    active_merchant: null,
    active_period: { from: "2026-09-21", to: "2026-09-27", label: "21/09 a 27/09" },
    conversation_summary: "Quero saber do dia 21/09 ao dia 27/09 quanto eu gastei",
    references: [],
  } as any;
}

function activeMonthlySeriesMemory() {
  return {
    current_topic: "read",
    previous_intent: "read",
    active_category: "Lazer",
    active_merchant: null,
    active_period: { from: "2026-06-01", to: "2026-09-29", label: "últimos 4 meses" },
    conversation_summary: "Evolução de Lazer mês a mês nos últimos 4 meses",
    references: [{
      id: "monthly-ref",
      type: "entity_set",
      target: "category",
      entity_labels: ["Lazer"],
      created_at: "2026-09-29T10:00:00.000Z",
      expires_at: "2099-09-29T10:30:00.000Z",
      turns_remaining: 5,
      status: "active",
      source: {
        tool_name: "spending_timeseries_monthly",
        query_id: "q-monthly",
        context: {
          evidence: {
            kind: "monthly_series",
            version: "nino_monthly_series.v1",
            formula_version: "monthly.v1",
            months: [
              { month: "2026-06", total: 120, has_data: true, transaction_count: 2 },
              { month: "2026-07", total: 450, has_data: true, transaction_count: 5 },
              { month: "2026-08", total: 300, has_data: true, transaction_count: 3 },
              { month: "2026-09", total: 220, has_data: true, transaction_count: 2 },
            ],
            total: 1090,
            transaction_count: 12,
            window: { from: "2026-06-01", to: "2026-09-29", n: 4 },
            scope: { category: "Lazer", merchant: null },
            partial_first_month: false,
            partial_last_month: true,
          },
        },
      },
    }],
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

  it("recupera troca contextual de categoria com o período executado quando o provider falha", () => {
    const turn = compile("Tá. Agora olha só Lazer pra mim.", activeOverallSpendingMemory());
    expect(turn).toMatchObject({
      mode: "read",
      inherit_focus: false,
      focus: {
        category: "Lazer",
        merchant: null,
        period_expressions: ["2026-09-21..2026-09-27"],
      },
      financial_read: {
        queries: [{
          metric: "expense_amount",
          operation: "sum",
          filters: [{ field: "category", value: "Lazer", op: "eq" }],
        }],
      },
    });
  });

  it("recupera continuação temporal inequívoca sem inventar assunto", () => {
    const memory = { ...activeSpendingMemory(), conversation_summary: "Quanto gastei com alimentação?", active_period: null };
    const turn = compile("E no mês passado?", memory as any);
    expect(turn).toMatchObject({
      mode: "read",
      inherit_focus: true,
      focus: { category: "Alimentação", period_expressions: ["mês passado"] },
      financial_read: { queries: [{ metric: "expense_amount", operation: "sum" }] },
    });
  });

  it("não converte continuação temporal de dívida em gasto", () => {
    const memory = { ...activeOverallSpendingMemory(), current_topic: "dívidas", conversation_summary: "Quais dívidas eu tenho?", active_category: null };
    expect(compile("E no mês passado?", memory as any)).toBeNull();
  });

  it("acolhe uma abertura humana sobre gastos sem depender do provider", () => {
    const turn = compile("Oi Nino, tudo bem? Tô tentando entender melhor meus gastos hoje.");
    expect(turn).toMatchObject({ mode: "converse", act: "conversational", inherit_focus: false });
    expect(turn?.direct_reply).toContain("Vamos olhar isso juntos");
  });

  it("compila comparação e peso por categoria a partir do período ativo", () => {
    const turn = compile("Isso foi muito? O que mais pesou?", activeOverallSpendingMemory());
    expect(turn).toMatchObject({
      mode: "read",
      inherit_focus: true,
      focus: { period_expressions: ["2026-09-14..2026-09-20", "2026-09-21..2026-09-27"] },
      financial_read: {
        queries: [
          { operation: "compare", comparison_baseline_expression: "2026-09-14..2026-09-20", comparison_target_expression: "2026-09-21..2026-09-27" },
          { operation: "breakdown", group_by: ["category"] },
        ],
      },
    });
  });

  it("gera pedido de gráfico referenciado sem chamar IA", () => {
    const turn = compile("Boa. Mostra isso em gráfico.", activeMonthlySeriesMemory());
    expect(turn).toMatchObject({ mode: "converse", inherit_focus: true, reference: { target: "category" } });
    expect(turn?.direct_reply).toContain("gráfico mês a mês");
  });

  it("responde observação e pior mês somente com a evidência mensal persistida", () => {
    const memory = activeMonthlySeriesMemory();
    const observation = compile("O que você acha que eu deveria observar aqui?", memory);
    expect(observation?.direct_reply).toContain("julho de 2026");
    expect(observation?.direct_reply).toContain("R$ 450,00");
    expect(observation?.direct_reply).toContain("mês é parcial");

    const worst = compile("Voltando pro Lazer: qual daqueles quatro meses foi o pior?", memory);
    expect(worst?.direct_reply).toContain("julho de 2026");
    expect(worst?.direct_reply).toContain("R$ 450,00");
  });

  it("trata reação humana sem apagar o contexto financeiro", () => {
    const turn = compile("Caramba, eu não tinha percebido isso.", activeMonthlySeriesMemory());
    expect(turn).toMatchObject({ mode: "converse", inherit_focus: true, reference: { target: "category" } });
    expect(turn?.direct_reply).toContain("meses lado a lado");
  });

  it("resolve 'nela' como a dívida ativa", () => {
    const turn = compile("Beleza. Registra R$ 300 de pagamento nela hoje.", activeDebtMemory());
    expect(turn?.action).toMatchObject({ action: "debt.pay", slots: { amount: 300 } });
    expect(turn?.reference?.target).toBe("debt");
  });

  it("usa o compilador fechado antes do V3 para não consumir quota em turnos inequívocos", () => {
    const source = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    expect(source).toContain("compileDeterministicConversationTurn({ text: brainText, memory })");
    expect(source).toContain("deterministic:closed_contract");
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
