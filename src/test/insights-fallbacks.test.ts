import { describe, it, expect } from "vitest";
import { InsightSchema, parseInsightResponse, pickFallback, CTA_ROUTE_RX } from "@/lib/insights/fallbacks";

const base = {
  total_tx_ever: 0,
  month: "2026-07",
  income_month: 0,
  expense_month: 0,
  balance_month: 0,
  active_goals: 0,
  goal_names: [] as string[],
};

describe("InsightSchema", () => {
  it("rejects empty title/body", () => {
    expect(InsightSchema.safeParse({ title: "", body: "" }).success).toBe(false);
    expect(InsightSchema.safeParse({ title: "   ", body: "algo com texto suficiente" }).success).toBe(false);
    expect(InsightSchema.safeParse({ title: "ok titulo", body: "  " }).success).toBe(false);
  });

  it("rejects meaningless strings", () => {
    expect(InsightSchema.safeParse({ title: "null", body: "algo com texto suficiente" }).success).toBe(false);
    expect(InsightSchema.safeParse({ title: "undefined", body: "algo com texto suficiente" }).success).toBe(false);
    expect(InsightSchema.safeParse({ title: "----", body: "algo com texto suficiente" }).success).toBe(false);
  });

  it("rejects cta_route outside /app/", () => {
    const r = InsightSchema.safeParse({
      title: "Titulo bom",
      body: "Corpo com tamanho suficiente para passar.",
      cta_route: "/outra/rota",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a well-formed payload and trims", () => {
    const r = InsightSchema.safeParse({
      type: "habit",
      title: "  Titulo bom  ",
      body: "Corpo com tamanho suficiente para passar.",
      cta_label: "Ver",
      cta_route: "/app/lancamentos",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.title).toBe("Titulo bom");
    }
  });

  it("parseInsightResponse returns null for bad input", () => {
    expect(parseInsightResponse(null)).toBeNull();
    expect(parseInsightResponse({ title: "", body: "" })).toBeNull();
    expect(parseInsightResponse("not-json")).toBeNull();
  });
});

describe("pickFallback", () => {
  const scenarios = [
    { name: "onboarding zero tx", f: { ...base } },
    { name: "poucos lançamentos", f: { ...base, total_tx_ever: 2 } },
    { name: "gastos > entradas", f: { ...base, total_tx_ever: 10, income_month: 1000, expense_month: 1500, balance_month: -500 } },
    { name: "sobra e meta", f: { ...base, total_tx_ever: 10, income_month: 2000, expense_month: 1500, balance_month: 500, active_goals: 1, goal_names: ["Viagem"] } },
    { name: "sobra sem meta", f: { ...base, total_tx_ever: 10, income_month: 2000, expense_month: 1500, balance_month: 500 } },
    { name: "meta ativa sem sobra", f: { ...base, total_tx_ever: 10, active_goals: 1, goal_names: ["Reserva"] } },
    { name: "recorrências próximas", f: { ...base, total_tx_ever: 10, upcoming_recurring_7d: 3 } },
    { name: "com cartão", f: { ...base, total_tx_ever: 10, has_credit_card: true } },
    { name: "default", f: { ...base, total_tx_ever: 10 } },
  ];
  for (const s of scenarios) {
    it(`gera payload válido: ${s.name}`, () => {
      const p = pickFallback(s.f);
      const r = InsightSchema.safeParse(p);
      expect(r.success).toBe(true);
      expect(CTA_ROUTE_RX.test(p.cta_route)).toBe(true);
      expect(p.title.trim().length).toBeGreaterThanOrEqual(4);
      expect(p.body.trim().length).toBeGreaterThanOrEqual(10);
    });
  }
});
