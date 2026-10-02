// Regressão: "compara setembro com agosto" era barrado por grounding porque o
// percentual com separador de milhar ("2.746,4%") era lido como "746,4".
import { it, expect } from "vitest";
import { computeCompare } from "../../supabase/functions/_shared/analytics/compare";
import { runSemanticTurn } from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline";
import { capabilityFromFinancialIR } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter";
const tx = (id: string, d: string, amt: number, cat: string, type = "expense") => ({ id, user_id: "u", account_id: "a", category_id: cat, type, status: "confirmed", amount: amt, occurred_at: d, description: "x", origin: "manual" });
const txs = [tx("8","2026-09-02",200,"c5"), tx("9","2026-09-04",55,"c6"), tx("10","2026-09-07",380,"c4"), tx("11","2026-09-20",150,"c7"), tx("12","2026-09-27",120,"c5"), tx("13","2026-08-31",6500,"c8","income"), tx("1","2026-08-23",62,"c1"), tx("2","2026-08-29",55.9,"c2"), tx("3","2026-09-01",1800,"c3"), tx("4","2026-09-26",45,"c1"), tx("5","2026-09-12",130,"c1"), tx("6","2026-09-29",420,"c4"), tx("7","2026-09-28",55.9,"c2")];
const names = new Map([["c1","Alimentação"],["c2","Assinaturas"],["c3","Moradia"],["c4","Mercado"],["c5","Lazer"],["c6","Transporte"],["c7","Saúde"],["c8","Salário"]]);
it("comparação com variação acima de 999% (milhar no percentual) passa no grounding", async () => {
  const A = { from: "2026-09-01", to: "2026-09-30" }, B = { from: "2026-08-01", to: "2026-08-31" };
  const res = computeCompare({ txs: txs as any, categoryNames: names, metric: "expense", period_a: B, period_b: A, group_by: "category" });
  const result = { ...res, requested_group_by: "none", requested_comparison_direction: "any", requested_limit: null };
  const ir: any = { version: "financial_query_ir.v2", intent: "lookup", queries: [{ id: "q1", metric: "expense_amount", operation: "compare", group_by: [], limit: null, depends_on: [], filters: [] }], period: { ...A, label: "setembro" }, comparison_period: { ...B, label: "agosto" }, assumptions: [], needs_clarification: [], completeness_targets: [], source: "llm", unsupported_reason: null };
  const cap = capabilityFromFinancialIR(ir);
  expect(cap.capability?.required_tool).toBe("compare_periods");
  const out: any = await runSemanticTurn({ text: "f", acts: ["read_financial"], constraints: { period: false, dimension: false, entity: false }, period: ir.period, comparison_period: ir.comparison_period, topic_state: null, max_queries: 1, investigation_enabled: false, now: new Date("2026-10-02T12:00:00-03:00"), failure_reply: "FALHA", authoritative_contract: true, preservation_enforced: true } as never, { compile: async () => ({ ir, telemetry: null }), loadOptions: async () => [], recordStage: () => {}, runEngine: async () => ({ ok: true, result, duration_ms: 1 }) } as never);
  expect(out.errors).toEqual([]);
  expect(out.grounding?.ok).toBe(true);
  expect(String(out.turn?.reply)).toMatch(/aumentaram.*2\.746,4%/);
});
