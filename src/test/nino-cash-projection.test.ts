/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures de pipeline parciais */
// "Me explica melhor" depois do alerta "caixa fica negativo": o Nino lista, dia a dia, o que
// pesa no caixa (mesma conta do alerta), em vez de perguntar "qual período ou item?".
import { describe, expect, it, vi } from "vitest";

vi.mock("../../supabase/functions/_shared/engine/metrics", () => ({
  computeAgentSnapshot: async () => ({
    today: "2026-10-29", month_end: "2026-10-31", formula_version: "financial_snapshot_contract.v9",
    available_today: 6172.05, projected_month_end_available: 900,
    estimated_income_events: [{ date: "2026-10-30", amount: 200.46, label: "Salário", source: "recurring", confidence: "medium" }],
    commitment_agenda: {
      pending_items: [
        { name: "Parcela Réveillon- Cartão", type: "expense", amount: 1566, date: "2026-11-01", source: "debt_installment", estimated: false, payment_status: "pending" },
        { name: "Fatura Cartão Itaú", type: "expense", amount: 5454.54, date: "2026-11-01", source: "card_statement", estimated: false, payment_status: "pending" },
      ],
      items: [],
    },
  }),
}));

import { explain_cash_projection } from "../../supabase/functions/_shared/agent/tools";
import { semanticBlockText } from "../../supabase/functions/_shared/agent/core/SemanticAnswerFormatter";
import { bridgeTurnSpecV3ToRuntime } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import { compileFinancialReadFromTurn } from "../../supabase/functions/_shared/agent/core/TurnContractFinancialAdapter";
import { runSemanticTurn } from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline";
import { resolvePeriodPt } from "../../supabase/functions/_shared/analytics/periodResolver";

const NOW = new Date("2026-10-29T12:00:00Z");

describe("projeção de caixa explicada", () => {
  it("resolve janela à frente: 'próximos 10 dias'", () => {
    const p = resolvePeriodPt("nos próximos 10 dias", NOW)!;
    expect(p.from).toBe("2026-10-29");
    expect(p.to).toBe("2026-11-07");
  });

  it("a ferramenta soma entradas e saídas dia a dia e acha o primeiro dia negativo", async () => {
    const out: any = await explain_cash_projection({ sb: {} as any, user_id: "u" } as any);
    expect(out.ok).toBe(true);
    expect(out.result.first_negative_date).toBe("2026-11-01");
    expect(out.result.first_negative_balance).toBeCloseTo(6172.05 + 200.46 - 1566 - 5454.54, 2);
    expect(out.result.days.map((d: any) => d.date)).toEqual(["2026-10-30", "2026-11-01"]);
  });

  it("o texto nomeia cada compromisso com data e valor", async () => {
    const out: any = await explain_cash_projection({ sb: {} as any, user_id: "u" } as any);
    const text = semanticBlockText("explain_cash_projection", out.result)!;
    expect(text).toContain("01/11");
    expect(text).toContain("Parcela Réveillon- Cartão");
    expect(text).toContain("Fatura Cartão Itaú");
    expect(text).toMatch(/1\.566,00/);
  });

  it("ponta a ponta: saldo + projeção executa sem pedir período e passa pelos gates", async () => {
    const text = "Quero que você me explique melhor porque o caixa fecha negativo, quais são os lançamentos futuros";
    const spec = {
      version: "nino_turn_spec.v3", kind: "task", response_intent: "execute", act: "new_request",
      canonical_request: text, inherit_topic: false, references: [],
      tasks: [{ kind: "financial_query", family: "financial.query", metric: "balance", operation: "forecast", group_by: [], filters: [], periods: [], limit: null, comparison: null }],
    };
    const month = { from: "2026-10-01", to: "2026-10-31", label: "este mês" };
    const bridged: any = bridgeTurnSpecV3ToRuntime(spec as never, NOW);
    expect(bridged.ok).toBe(true);
    const compiled: any = compileFinancialReadFromTurn({ turn: bridged.contract, period: month, comparison_period: null } as any);
    const out: any = await runSemanticTurn({
      text, acts: ["read_financial"] as never, constraints: { period: false, dimension: false, entity: false },
      period: month, comparison_period: null, topic_state: null, max_queries: 1, investigation_enabled: false, now: NOW,
      preservation_enforced: true, typical_monthly_enabled: true, authoritative_contract: true, failure_reply: "falha",
    } as never, {
      compile: async () => compiled, loadOptions: async () => [], recordStage: () => {},
      runEngine: async (tool: string) => {
        expect(tool).toBe("explain_cash_projection");
        const r: any = await explain_cash_projection({ sb: {} as any, user_id: "u" } as any);
        return { ok: r.ok, result: r.result, error: r.error, duration_ms: 1 };
      },
    } as never);
    expect(out.telemetry.executed_by).not.toBe("honest_domain_failure");
    expect(out.deterministic_text).toContain("Parcela Réveillon- Cartão");
  });
});

describe("lista da projeção e nomes de dados", () => {
  const day = (n: number, balance: number) => ({
    date: `2026-11-${String(n).padStart(2, "0")}`, inflow: 0, outflow: 10, balance,
    items: [{ name: `Item ${n}`, kind: "expense", amount: 10, source: "recurring", estimated: false }],
  });

  it("mostra os primeiros dias (os mais próximos), não os últimos", () => {
    const days = Array.from({ length: 14 }, (_, i) => day(i + 1, 100 - i * 10));
    const text = semanticBlockText("explain_cash_projection", {
      available_today: 200, horizon_days: 30, first_negative_date: "2026-11-14", lowest_date: "2026-11-14",
      lowest_balance: -30, days: days.map((d, i) => ({ ...d, balance: 100 - i * 20 })),
    })!;
    expect(text).toContain("Item 1 ");
    expect(text).toContain("Item 14");
    expect(text).toContain("omitidos");
  });

  it("nome de estabelecimento com termo de fornecedor nos dados não é apagado", async () => {
    const { humanizeReply } = await import("../../supabase/functions/_shared/agent/core/ReplyHumanizer");
    const reply = "• 03/11: − ChatGPT / OpenAI R$ 103,40 (estimado)";
    expect(humanizeReply(reply, "ChatGPT / OpenAI 103.4")).toContain("ChatGPT / OpenAI");
    // sem o termo nos dados, a barreira continua removendo
    expect(humanizeReply("Fui criado pelo Google para ajudar.", "")).not.toMatch(/google/i);
    // atribuição de autoria é apagada mesmo que o termo exista nos dados
    expect(humanizeReply("Fui criado pelo Google para ajudar.", "Google 10.00")).not.toMatch(/criado pelo google/i);
  });
});

describe("cadastro de cartões e contas", () => {
  it("balance + breakdown por cartão/conta mapeia o cadastro", async () => {
    const { mappingForQuery } = await import("../../supabase/functions/_shared/agent/core/IRCapabilityAdapter");
    const q = (group: string) => ({ id: "q1", metric: "balance", operation: "breakdown", group_by: [group], filters: [], limit: null, depends_on: [] } as any);
    expect(mappingForQuery(q("card"), {} as any)?.tool).toBe("list_financial_sources");
    expect(mappingForQuery(q("account"), {} as any)?.tool).toBe("list_financial_sources");
  });

  it("o texto lista nomes, fechamento, vencimento e limite", () => {
    const text = semanticBlockText("list_financial_sources", {
      cards: [{ name: "Cartão Itaú", closing_day: 24, due_day: 1, total_limit: 9000 }],
      accounts: [{ name: "Banco Itau" }],
    })!;
    expect(text).toContain("Cartão Itaú");
    expect(text).toContain("fecha dia 24");
    expect(text).toContain("Banco Itau");
  });
});
