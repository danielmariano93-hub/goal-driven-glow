import { describe, expect, it } from "vitest";
import { independentMonthComparison } from "../../supabase/functions/_shared/agent/core/IndependentTemporalOracle";
import { verifyExecutedFinancialScopes } from "../../supabase/functions/_shared/agent/core/ExecutionScopeGate";
import { verifyFinancialFulfillment } from "../../supabase/functions/_shared/agent/core/ContractFulfillmentGate";
import type { FinancialReadContractV4 } from "../../supabase/functions/_shared/agent/core/FinancialReadContract";

const day = "2026-11-24";
const current = { from: "2026-11-01", to: day };
const same = { from: "2026-10-01", to: "2026-10-24" };
const whole = { from: "2026-10-01", to: "2026-10-31" };
const contract = (baseline: { from:string;to:string }) => ({
  version: "financial_read_contract.v4", source_turn_version: "conversation_turn_contract.v2",
  domain: "financial_read", semantic_request: null, semantic_periods: [],
  requested: { intent: "analyze", period: current, comparison_period: baseline,
    queries: [{ legacy_operation: "compare", time: current, metric: "expense_amount", group_by: [], filters: [] }] },
  slots: { intent: "resolved", time: "resolved", reference: "not_applicable", entity: "not_applicable" },
  grounded_reference: null,
}) as unknown as FinancialReadContractV4;
const call = (baseline: { from:string;to:string }) => ({
  tool_name: "compare_periods", ok: true,
  args: { period_a: current, period_b: baseline },
});

describe("source-text temporal oracle independently verifies financial execution", () => {
  it("grounds current-to-previous SAME DAYS across natural phrasings", () => {
    for (const question of [
      "como to esse mês comparado com o mesmo período do mês anterior",
      "Nino, compara esse mês com mês passado",
      "tô gastando mais ou menos que no mês passado, até agora?",
    ]) expect(independentMonthComparison(question, day))
      .toEqual({ target: current, baseline: same, mode: "same_elapsed_days" });
  });
  it("recognizes a FULL previous month and normalizes harmless repeated vowels", () => {
    for (const question of [
      "compara o que gastei esse mês até agora com outubro inteiro",
      "compara esse mês com outubro inteiiro, por favor",
      "compara este mês com o mês passado completo",
    ]) expect(independentMonthComparison(question, day))
      .toEqual({ target: current, baseline: whole, mode: "previous_full_month" });
  });
  it("resolves leap years, short months and year boundaries", () => {
    const feb = independentMonthComparison("compare esse mês ao mesmo período do mês anterior", "2026-03-30");
    expect(feb?.baseline).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(independentMonthComparison("compare esse mês ao mês passado", "2026-11-30")).toBeNull();
    const jan = independentMonthComparison("compare esse mês ao mês passado", "2026-01-15");
    expect(jan?.baseline).toEqual({ from: "2025-12-01", to: "2025-12-15" });
  });
  it("does not override dates, other months, or unrelated questions", () => {
    for (const question of [
      "quanto gastei no mês passado?",
      "compara agosto com setembro",
      "compara esse mês com setembro",
      "compara esse mês até dia 15 com o mês anterior",
      "compara novembro inteiro com outubro",
    ]) expect(independentMonthComparison(question, day)).toBeNull();
  });
  it("rejects a self-consistent IR/tool pair when it contradicts the original request", () => {
    const request = "como to esse mês comparado com o mesmo período do mês anterior";
    const errors = verifyExecutedFinancialScopes(contract(whole), [call(whole)], { requested_text: request, reference_date: day });
    expect(errors.map(x=>x.code)).toContain("original_request_vs_executed_window_mismatch");
    expect(errors.map(x=>x.code)).not.toContain("comparison_execution_window_mismatch");
  });
  it("does not reject correctly executed same days or explicit full month", () => {
    expect(verifyExecutedFinancialScopes(contract(same), [call(same)],
      { requested_text: "compare esse mês ao mesmo período do mês anterior", reference_date: day })).toEqual([]);
    expect(verifyExecutedFinancialScopes(contract(whole), [call(whole)],
      { requested_text: "compara esse mês com outubro inteiro", reference_date: day })).toEqual([]);
  });
  it("fulfillment blocks a plausible answer built on wrong but self-consistent windows", () => {
    const verdict = verifyFinancialFulfillment({
      contract: contract(whole), preservation: null, grounding: null,
      requested_text: "como estou esse mês comparado com o mesmo período do mês anterior?",
      reference_date: day,
      tool_calls: [call(whole)],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.violations.map(v => v.code)).toContain("original_request_vs_executed_window_mismatch");
  });
});

describe("o oráculo é só veto: o tempo é calculado pelo TimeSpec, não reescrito por regex", () => {
  const today = "2026-11-24";
  it("não reconhece intervalos ambíguos nem meses nomeados fora do par atual/anterior", () => {
    for (const question of ["compara setembro com agosto", "compara esse mês do dia 1 ao dia 10 com outubro",
      "quanto gastei mês passado", "compara novembro inteiro com outubro"]) {
      expect(independentMonthComparison(question, today)).toBeNull();
    }
  });
  it("o núcleo do agente não re-ancora nem remenda janelas depois do contrato do modelo", async () => {
    const { readFileSync } = await import("node:fs");
    const core = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    for (const gone of ["scopeForSingleComparison", "groundComparisonTurn", "sameWindowComparison", "alignTurnPeriods", "SameWindowGuard"]) {
      expect(core).not.toContain(gone);
    }
    const oracle = readFileSync("supabase/functions/_shared/agent/core/IndependentTemporalOracle.ts", "utf8");
    expect(oracle).not.toContain("groundComparisonTurn");
    expect(oracle).not.toContain("scopeForSingleComparison");
  });
});
