/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures de pipeline parciais */
// Cartão/categoria inexistente: a recusa honesta com as opções reais é a resposta
// (`nino_domain_refusal.v1`). Antes o gate de cumprimento a trocava por texto genérico.
import { describe, expect, it } from "vitest";
import { bridgeTurnSpecV3ToRuntime } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import { compileFinancialReadFromTurn } from "../../supabase/functions/_shared/agent/core/TurnContractFinancialAdapter";
import { runSemanticTurn } from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline";
import { analyze_spending } from "../../supabase/functions/_shared/agent/tools";
import { resolvePeriodPt } from "../../supabase/functions/_shared/analytics/periodResolver";

const NOW = new Date("2026-10-29T09:00:00Z");
const s = (value: string) => ({ value, source: "current_turn" as const, source_span: value });

function emptySb() {
  const q: any = {
    select: () => q, eq: () => q, gte: () => q, lte: () => q, order: () => q, in: () => q, or: () => q, is: () => q,
    range: () => Promise.resolve({ data: [], error: null }),
    then: (r: any) => Promise.resolve({ data: [], error: null }).then(r),
  };
  return { from: () => q };
}

async function turn(field: "card" | "category", value: string, text: string) {
  const spec = {
    version: "nino_turn_spec.v3", kind: "task", response_intent: "execute", act: "new_request",
    canonical_request: text, inherit_topic: false, references: [],
    tasks: [{ kind: "financial_query", family: "financial.query", metric: "expense_amount", operation: "sum", group_by: [], filters: [{ field, entity: s(value) }], periods: [s("setembro")], limit: null, comparison: null }],
  };
  const bridged: any = bridgeTurnSpecV3ToRuntime(spec as never, NOW);
  const period = resolvePeriodPt(text, NOW)!;
  const compiled: any = compileFinancialReadFromTurn({ turn: bridged.contract, period: { from: period.from, to: period.to, label: period.label }, comparison_period: null });
  return await runSemanticTurn({
    text, acts: ["read_financial"] as never, constraints: { period: true, dimension: false, entity: true },
    period: { from: period.from, to: period.to, label: period.label }, comparison_period: null,
    topic_state: null, max_queries: 1, investigation_enabled: false, now: NOW,
    preservation_enforced: true, typical_monthly_enabled: true, authoritative_contract: true, failure_reply: "falha",
  } as never, {
    compile: async () => compiled, loadOptions: async () => ["Cartão Itaú"], recordStage: () => {},
    runEngine: async (_tool: string, args: any) => {
      const r: any = await analyze_spending({ sb: emptySb(), user_id: "u" } as any, args);
      return { ok: r.ok, result: r.result, error: r.error, duration_ms: 1 };
    },
  } as never);
}

describe("recusa de entidade inexistente", () => {
  it("cartão inexistente: resposta específica com as opções reais, sem número", async () => {
    const out: any = await turn("card", "Nubank", "quanto gastei no cartão Nubank em setembro?");
    expect(out.telemetry.executed_by).toBe("honest_domain_failure");
    expect(out.deterministic_text).toContain("Não encontrei esse cartão");
    expect(out.deterministic_text).toContain("Cartão Itaú");
    expect(out.deterministic_text).not.toMatch(/R\$/);
  });

  it("categoria inexistente: idem", async () => {
    const out: any = await turn("category", "Foobar", "quanto gastei com a categoria Foobar em setembro?");
    expect(out.telemetry.executed_by).toBe("honest_domain_failure");
    expect(out.deterministic_text).toContain("Não encontrei essa categoria");
  });
});
