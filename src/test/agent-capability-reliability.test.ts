import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { interpret } from "../../supabase/functions/_shared/agent/parser";
import { classifyCapability, resumeDeterministicCapability } from "../../supabase/functions/_shared/agent/core/CapabilityRouter";
import {
  formatBeforeSpending,
  formatFinancialSnapshot,
  formatGoalsOverview,
} from "../../supabase/functions/_shared/agent/core/DeterministicAnswers";
import { openAIToolDefinitions } from "../../supabase/functions/_shared/agent/tools";
import { validate } from "../../supabase/functions/_shared/agent/core/ResponseValidator";

const capability = (text: string) => classifyCapability(text, interpret(text), null);

describe("roteamento de capacidades e confiabilidade do Nino", () => {
  it("obriga a fonte canônica para perguntas factuais prioritárias", () => {
    expect(capability("Quais são minhas metas cadastradas?")).toMatchObject({
      name: "goals_overview", execution: "deterministic", required_tool: "get_goals_overview",
    });
    expect(capability("Como estou financeiramente?")).toMatchObject({
      name: "financial_snapshot", execution: "deterministic", required_tool: "get_financial_snapshot",
    });
    expect(capability("Se eu gastar R$ 100 na categoria lazer amanhã, qual o impacto?")).toMatchObject({
      name: "before_spending", execution: "deterministic", required_tool: "run_before_spending",
      tool_args: expect.objectContaining({ amount: 100, category: "lazer" }),
    });
    expect(capability("Se eu fizer um gasto de 100 reais em lazer no dia 15")).toMatchObject({
      name: "before_spending", execution: "deterministic", required_tool: "run_before_spending",
      tool_args: expect.objectContaining({
        amount: 100, category: "lazer", planned_date: expect.stringMatching(/^\d{4}-\d{2}-15$/),
      }),
    });
    expect(capability("Se eu fizer um gasto de 100 reais em lazer")).toMatchObject({
      name: "before_spending", execution: "deterministic", required_tool: null,
      clarification: expect.stringContaining("qual data"),
    });
  });

  it("não deixa uma pergunta literal de sexta cair no resumo do mês", () => {
    const decision = capability("Quanto gastei na sexta?");
    expect(decision.name).toBe("weekday_literal");
    expect(decision.clarification).toContain("última ocorrência");
    expect(decision.allowed_tools).not.toContain("get_financial_snapshot");
    const lastFriday = capability("Quanto gastei na última sexta?");
    expect(lastFriday).toMatchObject({
      name: "weekday_literal", execution: "deterministic", required_tool: "get_spending_for_date",
      tool_args: { date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    });
  });

  it("retoma com segurança a data que faltou na simulação anterior", () => {
    const current = "amanhã no cartão Nubank";
    const resumed = resumeDeterministicCapability(
      current,
      interpret(current),
      "Se eu fizer um gasto de 100 reais em lazer",
    );
    expect(resumed).toMatchObject({
      name: "before_spending", required_tool: "run_before_spending",
      reason: "canonical_spending_simulation_resumed",
      tool_args: expect.objectContaining({ amount: 100, category: "lazer", method: "card", card: "nubank" }),
    });
    expect(resumeDeterministicCapability("obrigado", interpret("obrigado"), "Se eu gastar 100 em lazer")).toBeNull();
  });

  it("limita o conjunto de ferramentas por domínio", () => {
    const split = capability("Quero registrar e dividir um rolê");
    expect(split.name).toBe("split_expense");
    expect(split.allowed_tools).toEqual([
      "list_accounts", "list_categories", "list_credit_cards", "create_split_expense_draft",
    ]);
    expect(openAIToolDefinitions(split.allowed_tools)).toHaveLength(4);
    expect(openAIToolDefinitions(capability("Me ajude").allowed_tools).length).toBeLessThanOrEqual(11);
    expect(openAIToolDefinitions()).toHaveLength(51);
  });

  it("formata simulação usando somente o contrato snapshot.v4", () => {
    const reply = formatBeforeSpending({
      amount: 100, planned_date: "2026-08-08", available_today: 550,
      available_after_now: 450, projected_month_end_before: 300,
      projected_month_end_after: 200, known_future_commitments: 250,
      category_goal_impact: {
        category_name: "Lazer", spent_before: 200, spent_after: 300,
        limit: 400, remaining_after: 100, exceeds: false,
      }, limitations: [],
    });
    expect(reply).toContain("R$ 550,00 → R$ 450,00");
    expect(reply).toContain("restariam R$ 100,00");
    expect(reply).not.toContain("undefined");
    expect(reply).not.toContain("NaN");
  });

  it("explica saldo, ritmo e compromissos sem matemática do modelo", () => {
    const reply = formatFinancialSnapshot({
      available_today: 550, current_month_income: 1000, current_month_expense: 300,
      daily_pace: 100, typical_daily_pace: 90, known_future_commitments: 250,
      projected_month_end_available: 200, cards_owed_estimated: false,
    });
    expect(reply).toContain("R$ 10,00/dia acima");
    expect(reply).toContain("R$ 250,00 de outros compromissos");
  });

  it("inclui metas pessoais, de categoria e conjuntas no mesmo overview", () => {
    const reply = formatGoalsOverview({
      overall_attainment_pct: 75,
      items: [{ name: "Reserva", achieved: 500, target: 1000, attainment_pct: 50, remaining: 500 }],
      category_goals: [{ name: "Lazer", achieved: 200, target: 400, remaining: 200 }],
      shared_goals: [{ title: "Viagem", target_amount: 2000, deadline: "2026-12-01" }],
    });
    expect(reply).toContain("Reserva");
    expect(reply).toContain("Categoria Lazer");
    expect(reply).toContain("Meta conjunta Viagem");
  });

  it("aplica observabilidade e fallback global sem usuário privilegiado", () => {
    const migration = readFileSync("supabase/migrations/20260807210000_agent_reliability_capability_routing.sql", "utf8");
    expect(migration).toContain("deterministic_tool");
    expect(migration).toContain("openai/gpt-5-mini");
    expect(migration).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(migration).not.toContain("@gmail.com");
  });

  it("usa o mesmo Core nos dois adaptadores e a RPC atômica para rolê", () => {
    const app = readFileSync("supabase/functions/_shared/agent/core/adapters/AppAdapter.ts", "utf8");
    const whatsapp = readFileSync("supabase/functions/_shared/agent/core/adapters/WhatsAppAdapter.ts", "utf8");
    const policy = readFileSync("supabase/functions/_shared/agent/core/PolicyEngine.ts", "utf8");
    expect(app).toContain("handleTurn({");
    expect(whatsapp).toContain("handleTurn({");
    expect(app).not.toContain("tryFastPathCardExpense");
    expect(policy).toContain("confirmationExecutor(pending.kind)");
  });

  it("bloqueia resposta factual quando a fonte obrigatória não foi consultada", () => {
    const checked = validate("Seu saldo é R$ 9.999,00.", {
      requiredTool: "get_financial_snapshot",
      toolCalls: [],
    });
    expect(checked.action).toBe("accept");
    expect(checked.reasons).toContain("required_tool_missing:get_financial_snapshot");
    expect(checked.body).not.toContain("9.999");
    expect(checked.body).toContain("Não consegui consultar");
  });

  it("filtra metas conjuntas explicitamente mesmo sob service_role", () => {
    const tools = readFileSync("supabase/functions/_shared/agent/tools.ts", "utf8");
    expect(tools).toContain('.eq("created_by", ctx.user_id)');
    expect(tools).toContain('.eq("user_id", ctx.user_id).eq("invite_status", "accepted")');
    expect(tools).not.toContain('ctx.sb.from("shared_goals").select("id,title,target_amount,deadline")');
  });
});
