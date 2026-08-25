// Nome da categoria nas metas por categoria: o snapshot precisa resolver
// categorias GLOBAIS (`user_id IS NULL`) além das do usuário. A regressão real
// era a query do snapshot filtrar só por user_id, deixando `categoryName`
// vazio para Alimentação/Lazer/Transporte.
import { describe, expect, it } from "vitest";
import { evaluateCategoryGoal, type CategorySpendingGoalRow } from "@/lib/engine/metrics";

const today = new Date("2026-08-25T12:00:00");

function goalFor(category_id: string): CategorySpendingGoalRow {
  return {
    id: "g1",
    user_id: "u1",
    category_id,
    mode: "fixed_limit",
    reduction_pct: null,
    fixed_limit: 500,
    baseline_kind: "custom",
    baseline_value: 500,
    computed_limit: 500,
    frequency: "monthly",
    start_date: "2026-08-01",
    end_date: "2026-08-31",
    status: "active",
    period_type: "this_month",
  } as CategorySpendingGoalRow;
}

describe("meta por categoria — rótulo da categoria", () => {
  it("expõe o nome quando o mapa de categorias resolve o id (categoria global)", () => {
    const map: Record<string, string> = { "cat-global": "Alimentação" };
    const ev = evaluateCategoryGoal(goalFor("cat-global"), [], today, map["cat-global"]);
    expect(ev.categoryName).toBe("Alimentação");
  });

  it("não inventa nome quando o id não existe — a UI usa rótulo neutro", () => {
    const ev = evaluateCategoryGoal(goalFor("cat-fantasma"), [], today, undefined);
    expect(ev.categoryName).toBeUndefined();
  });

  it("mapa com globais + do usuário resolve os dois", () => {
    const map: Record<string, string> = { "cat-global": "Lazer", "cat-user": "Padaria da Ana" };
    expect(evaluateCategoryGoal(goalFor("cat-global"), [], today, map["cat-global"]).categoryName).toBe("Lazer");
    expect(evaluateCategoryGoal(goalFor("cat-user"), [], today, map["cat-user"]).categoryName).toBe("Padaria da Ana");
  });
});
