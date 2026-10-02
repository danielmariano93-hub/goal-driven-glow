// Regressão: "gráfico mês a mês" sem período pedia esclarecimento/era não suportado.
import { it, expect } from "vitest";
import { bridgeTurnSpecV3ToRuntime } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
const NOW = new Date("2026-10-02T12:00:00-03:00");
const fin = (periods: any[], extra: any = {}) => ({ version: "nino_turn_spec.v3", kind: "task", response_intent: "execute", act: "new_request", canonical_request: "gráfico mês a mês", inherit_topic: false, references: [], tasks: [{ kind: "financial_query", family: "financial.query", metric: "expense_amount", operation: "trend", group_by: ["month"], filters: [], periods, limit: null, comparison: null, ...extra }] });
it("série mês a mês sem período usa janela de 6 meses; com período respeita o dito", () => {
  const r0: any = bridgeTurnSpecV3ToRuntime(fin([]) as any, NOW);
  expect(r0.contract.focus.period_expressions).toEqual(["últimos 6 meses"]);
  const r1: any = bridgeTurnSpecV3ToRuntime(fin([{ value: "últimos 6 meses", source: "current_turn", source_span: "x" }]) as any, NOW);
  expect(r1.contract.focus.period_expressions).toHaveLength(1);
});
