/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures de pipeline com dependências parciais */
// Executor genérico ponta a ponta (`generic_aggregate_v1`): o turno percorre
// contrato → IR → validador → motor → preservação → gate de cumprimento.
// Com a flag desligada o comportamento é o de sempre (falha honesta); ligada,
// a combinação sem motor dedicado executa e continua passando pelos gates.
import { describe, expect, it } from "vitest";
import { bridgeTurnSpecV3ToRuntime } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import { compileFinancialReadFromTurn } from "../../supabase/functions/_shared/agent/core/TurnContractFinancialAdapter";
import { runSemanticTurn } from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline";
import { buildFinancialReadContract } from "../../supabase/functions/_shared/agent/core/FinancialReadContract";
import { verifyFinancialFulfillment } from "../../supabase/functions/_shared/agent/core/ContractFulfillmentGate";
import { spending_aggregate } from "../../supabase/functions/_shared/agent/engineToolsImpl";
import { resolvePeriodPt } from "../../supabase/functions/_shared/analytics/periodResolver";

const NOW = new Date("2026-09-30T11:34:00Z");
const s = (value: string) => ({ value, source: "current_turn" as const, source_span: value });

let n = 0;
const tx = (over: Record<string, unknown>) => ({
  id: `t${++n}`, account_id: "acc1", category_id: "cat-lazer", type: "expense", status: "confirmed",
  amount: 100, occurred_at: "2026-09-10", description: "THALES BAR", payment_method: "credit_card",
  credit_card_id: "card1", movement_kind: "transaction", competence_date: null,
  refund_of_transaction_id: null, ...over,
} as any);

function fakeSb(rows: any[]) {
  const tables: Record<string, any[]> = {
    transactions: rows,
    credit_cards: [{ id: "card1", name: "Nubank" }],
    accounts: [{ id: "acc1", name: "Conta Itaú" }],
    categories: [
      { id: "cat-lazer", name: "Lazer", user_id: null, type: "expense" },
      { id: "cat-transp", name: "Transporte", user_id: null, type: "expense" },
    ],
    merchant_aliases: [],
  };
  return {
    from: (table: string) => {
      const data = tables[table] ?? [];
      const q: any = {
        select: () => q, eq: () => q, gte: () => q, lte: () => q, order: () => q, in: () => q, or: () => q, is: () => q,
        range: (a: number, b: number) => Promise.resolve({ data: data.slice(a, b + 1), error: null }),
        then: (res: any) => Promise.resolve({ data, error: null }).then(res),
      };
      return q;
    },
  };
}

const ROWS = [
  tx({ amount: 100, description: "THALES BAR", category_id: "cat-lazer" }),
  tx({ amount: 30, description: "THALES BAR", category_id: "cat-transp" }),
  tx({ amount: 70, description: "UBER TRIP", category_id: "cat-transp" }),
];

async function runTurn(generic: boolean, spec: { text?: string; group_by?: string[]; filters?: any[]; operation?: string; rows?: any[] } = {}) {
  const text = spec.text ?? "meus gastos no Thales por categoria em setembro";
  const turn = {
    version: "nino_turn_spec.v3", kind: "task", response_intent: "execute", act: "new_request",
    canonical_request: text, inherit_topic: false, references: [],
    tasks: [{
      kind: "financial_query", family: "financial.query", metric: "expense_amount",
      operation: spec.operation ?? "breakdown", group_by: spec.group_by ?? ["category"],
      filters: spec.filters ?? [{ field: "merchant", entity: s("Thales") }],
      periods: [s("setembro")], limit: null, comparison: null,
    }],
  };
  const bridged = bridgeTurnSpecV3ToRuntime(turn as never, NOW);
  if (!bridged.ok) throw new Error("bridge_failed");
  const contract = bridged.contract;
  const period = resolvePeriodPt(text, NOW)!;
  const compiled = compileFinancialReadFromTurn({
    turn: contract, period: { from: period.from, to: period.to, label: period.label }, comparison_period: null,
  });
  if (!compiled?.ir) throw new Error("compile_failed");
  const calls: string[] = [];
  const sb = fakeSb(spec.rows ?? ROWS);
  const out = await runSemanticTurn({
    text, acts: ["read_financial"] as never,
    constraints: { period: true, dimension: true, entity: true },
    period: { from: period.from, to: period.to, label: period.label }, comparison_period: null,
    topic_state: null, max_queries: 1, investigation_enabled: false, now: NOW,
    preservation_enforced: true, typical_monthly_enabled: true, authoritative_contract: true,
    generic_aggregate_enabled: generic,
    failure_reply: "falha honesta",
  } as never, {
    compile: async () => compiled,
    loadOptions: async () => [],
    recordStage: () => {},
    runEngine: async (tool: string, args: any) => {
      calls.push(tool);
      if (tool !== "spending_aggregate") throw new Error(`motor_inesperado:${tool}`);
      const r: any = await spending_aggregate({ sb, user_id: "u1" } as any, args);
      return { ok: r.ok, result: r.result, error: r.error, duration_ms: 1 };
    },
  } as never);
  const fulfillment = verifyFinancialFulfillment({
    contract: buildFinancialReadContract({ turn: contract, requested: out.ir_v3!, grounded_reference: null } as never),
    preservation: out.preservation ?? null,
    grounding: (out as any).grounding ?? null,
  });
  return { out, fulfillment, calls };
}

describe("executor genérico ponta a ponta", () => {
  it("flag desligada: estabelecimento × categoria segue sem motor (comportamento atual)", async () => {
    const { out, calls } = await runTurn(false);
    expect(out.status).toBe("unsupported");
    expect(calls).toEqual([]);
  });

  it("flag ligada: executa pelo executor genérico e passa nos gates", async () => {
    const { out, fulfillment, calls } = await runTurn(true);
    expect(out.status).not.toBe("unsupported");
    expect(calls).toEqual(["spending_aggregate"]);
    const text = String(out.deterministic_text ?? "").replace(/\u00a0/g, " ");
    expect(text).toContain("R$ 130,00");
    expect(text).toContain("*Lazer*");
    expect(text).toContain("*Transporte*");
    expect(out.preservation?.compatible).toBe(true);
    expect(fulfillment.ok).toBe(true);
  });
});


describe("rótulos de estabelecimento com números e datas", () => {
  const CARD_ROWS = [
    tx({ amount: 582.67, description: "Ingresso Anitta - Parcela 2", category_id: "cat-lazer" }),
    tx({ amount: 507, description: "MEP* Eventos Jamil 2026", category_id: "cat-lazer" }),
    tx({ amount: 134.2, description: "JIM.COM", category_id: "cat-lazer" }),
    tx({ amount: 169.29, description: "Lovable", category_id: "cat-lazer" }),
  ];
  it("agrupar por estabelecimento no cartão passa nos gates mesmo com números no nome", async () => {
    const { out, fulfillment, calls } = await runTurn(true, {
      text: "gastos por estabelecimento no cartão Nubank em setembro",
      operation: "breakdown", group_by: ["merchant"],
      filters: [{ field: "card", entity: s("Nubank") }],
      rows: CARD_ROWS,
    });
    expect(calls).toEqual(["spending_aggregate"]);
    // eslint-disable-next-line no-console
    console.log("DBG", JSON.stringify({ status: out.status, errors: out.errors, grounding: (out as any).grounding?.violations, ful: fulfillment.violations, text: out.deterministic_text }));
    expect(fulfillment.ok).toBe(true);
  });
});
