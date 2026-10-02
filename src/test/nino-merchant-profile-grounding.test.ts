// Regressão: "e no Thales?" era barrado porque o ticket médio do estabelecimento
// (R$ 87,50) não contava como evidência do merchant_profile.
import { it, expect } from "vitest";
import { merchantProfile } from "../../supabase/functions/_shared/finance-core/merchantIntelligence";
import { runSemanticTurn } from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline";
import { capabilityFromFinancialIR } from "../../supabase/functions/_shared/agent/core/IRCapabilityAdapter";
const tx = (id: string, d: string, amt: number, desc: string) => ({ id, user_id: "u", account_id: "a", category_id: "c1", type: "expense", status: "confirmed", amount: amt, occurred_at: d, competence_date: d, description: desc, origin: "manual" });
const txs = [tx("1","2026-09-12",130,"Restaurante Thales"), tx("2","2026-09-26",45,"Restaurante Thales"), tx("3","2026-08-23",62,"iFood")];
for (const [label, from, to] of [["set", "2026-09-01", "2026-09-30"]] as const) {
it("m " + label, async () => {
  const period = { from, to };
  const env: any = merchantProfile({ txs: txs as any, period, query: "Thales", aliases: [], categoryId: null } as any);
  const f = env.facts;
  const result = { ...env, period, filters: { merchant: "Thales", category: null }, total_metric: f.net_total, transactions_count: f.count, answer_format: { headline: `${f.label}: R$ ${f.net_total.toFixed(2).replace(".", ",")} em ${f.count} compra(s), ticket médio R$ ${f.avg_ticket.toFixed(2).replace(".", ",")}.`, delta_abs: f.delta_abs } };
  const ir: any = { version: "financial_query_ir.v2", intent: "lookup", queries: [{ id: "q1", metric: "expense_amount", operation: "value", group_by: [], limit: null, depends_on: [], filters: [{ field: "merchant", op: "eq", value: "Thales" }] }], period: { ...period, label: "p" }, comparison_period: null, assumptions: [], needs_clarification: [], completeness_targets: [], source: "llm", unsupported_reason: null };
  const cap = capabilityFromFinancialIR(ir);
  const out: any = await runSemanticTurn({ text: "f", acts: ["read_financial"], constraints: { period: false, dimension: false, entity: false }, period: ir.period, comparison_period: null, topic_state: null, max_queries: 1, investigation_enabled: false, now: new Date("2026-10-02T12:00:00-03:00"), failure_reply: "FALHA", authoritative_contract: true, preservation_enforced: true } as never, { compile: async () => ({ ir, telemetry: null }), loadOptions: async () => [], recordStage: () => {}, runEngine: async () => ({ ok: true, result, duration_ms: 1 }) } as never);
  expect(out.errors).toEqual([]);
  expect(out.grounding?.violations).toEqual([]);
  expect(String(out.turn?.reply)).toContain("87,50");
});
}
