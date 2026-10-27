import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  donationDueDate, donationMonthsRange, donationMonthTarget, evaluateDonationMonth, type DonationGoalLike, type DonationTxLike,
} from "@/lib/engine/donationGoal";

const SALARY = "cat-salario";
const DIZIMO = "cat-dizimo";
const goal: DonationGoalLike = {
  id: "g1", name: "Dizimo", kind: "donation", status: "active", created_at: "2026-10-27T20:48:04Z",
  donation_mode: "income_percent", donation_percent: 10, donation_income_scope: "selected_categories",
  donation_income_category_ids: [SALARY], donation_due_day: 27, donation_end_date: "2026-12-28", donation_category_id: DIZIMO,
};
const tx = (over: Partial<DonationTxLike> & { id: string }): DonationTxLike => ({
  type: "expense", status: "confirmed", amount: 0, occurred_at: "2026-10-27", category_id: null, movement_kind: "transaction", ...over,
});

describe("alvo do mês", () => {
  const income = [tx({ id: "i1", type: "income", amount: 7690, occurred_at: "2026-10-05", category_id: SALARY })];
  it("percentual sobre a renda das categorias escolhidas", () => {
    expect(donationMonthTarget(goal, "2026-10", income, "2026-10-27")).toBe(769);
  });
  it("renda de categoria não escolhida não entra", () => {
    expect(donationMonthTarget(goal, "2026-10", [...income, tx({ id: "i2", type: "income", amount: 1000, occurred_at: "2026-10-06", category_id: "outra" })], "2026-10-27")).toBe(769);
  });
  it("alvo fixo no vencimento: renda que entra depois do dia 27 não muda o alvo", () => {
    const late = [...income, tx({ id: "i3", type: "income", amount: 5000, occurred_at: "2026-10-30", category_id: SALARY })];
    expect(donationMonthTarget(goal, "2026-10", late, "2026-10-31")).toBe(769);
  });
  it("antes do vencimento conta só o que já entrou até hoje", () => {
    const later = [...income, tx({ id: "i4", type: "income", amount: 1000, occurred_at: "2026-10-20", category_id: SALARY })];
    expect(donationMonthTarget(goal, "2026-10", later, "2026-10-15")).toBe(769);
    expect(donationMonthTarget(goal, "2026-10", later, "2026-10-25")).toBe(869);
  });
  it("valor fixo", () => {
    expect(donationMonthTarget({ ...goal, donation_mode: "fixed", monthly_target: 300 }, "2026-10", [], "2026-10-10")).toBe(300);
  });
  it("vencimento limitado ao dia 28", () => {
    expect(donationDueDate({ ...goal, donation_due_day: 31 }, "2026-02")).toBe("2026-02-28");
  });
});

describe("realizado do mês", () => {
  const income = [tx({ id: "i1", type: "income", amount: 7690, occurred_at: "2026-10-05", category_id: SALARY })];
  it("despesa na categoria da meta conta sozinha: o R$ 769 do dízimo fecha o mês", () => {
    const m = evaluateDonationMonth(goal, "2026-10", [...income, tx({ id: "d1", amount: 769, category_id: DIZIMO })], "2026-10-27");
    expect(m.done).toBe(769);
    expect(m.target).toBe(769);
    expect(m.status).toBe("done");
    expect(m.remaining).toBe(0);
    expect(m.matched).toEqual([{ id: "d1", amount: 769, occurred_at: "2026-10-27", via: "category" }]);
  });
  it("lançamento vinculado à mão conta mesmo fora da categoria", () => {
    const m = evaluateDonationMonth({ ...goal, donation_category_id: null }, "2026-10",
      [...income, tx({ id: "d2", amount: 400, category_id: "outros", donation_goal_id: "g1" })], "2026-10-27");
    expect(m.done).toBe(400);
    expect(m.status).toBe("partial");
    expect(m.remaining).toBe(369);
    expect(m.matched[0].via).toBe("link");
  });
  it("categoria e vínculo no mesmo lançamento não contam em dobro", () => {
    const m = evaluateDonationMonth(goal, "2026-10", [...income, tx({ id: "d3", amount: 100, category_id: DIZIMO, donation_goal_id: "g1" })], "2026-10-27");
    expect(m.done).toBe(100);
    expect(m.matched).toHaveLength(1);
  });
  it("acima do combinado conta como cumprido", () => {
    expect(evaluateDonationMonth(goal, "2026-10", [...income, tx({ id: "d4", amount: 900, category_id: DIZIMO })], "2026-10-27").status).toBe("exceeded");
  });
  it("sem lançamento, o mês fica pendente; outro mês não entra", () => {
    expect(evaluateDonationMonth(goal, "2026-10", [...income, tx({ id: "d5", amount: 769, category_id: DIZIMO, occurred_at: "2026-09-27" })], "2026-10-27").status).toBe("pending");
  });
  it("planejado, estorno e transferência não contam", () => {
    const m = evaluateDonationMonth(goal, "2026-10", [
      ...income,
      tx({ id: "p1", amount: 500, category_id: DIZIMO, status: "planned" }),
      tx({ id: "p2", amount: 500, category_id: DIZIMO, movement_kind: "refund" }),
      tx({ id: "p3", amount: 500, category_id: DIZIMO, type: "transfer" }),
    ], "2026-10-27");
    expect(m.done).toBe(0);
  });
  it("lançamento vinculado a outra meta não conta nesta", () => {
    expect(evaluateDonationMonth({ ...goal, donation_category_id: null }, "2026-10", [...income, tx({ id: "o1", amount: 50, donation_goal_id: "outra" })], "2026-10-27").done).toBe(0);
  });
});

describe("meses da meta", () => {
  it("do mês atual para trás, respeitando criação e fim", () => {
    expect(donationMonthsRange(goal, "2026-10-27")).toEqual(["2026-10"]);
    expect(donationMonthsRange({ ...goal, created_at: "2026-08-01T00:00:00Z" }, "2026-10-27")).toEqual(["2026-10", "2026-09", "2026-08"]);
    expect(donationMonthsRange({ ...goal, created_at: "2026-08-01T00:00:00Z", donation_end_date: "2026-09-28" }, "2026-10-27")).toEqual(["2026-09", "2026-08"]);
  });
});

describe("projeção de caixa (compromisso do mês)", () => {
  it("metrics usa o motor da meta de doação e só projeta o que falta", () => {
    const src = readFileSync("src/lib/engine/metrics.ts", "utf8");
    expect(src).toContain("evaluateDonationMonth(g, currentYM");
    expect(src).toContain("current.remaining");
  });
});

describe("banco", () => {
  const sql = readFileSync("supabase/migrations/20261028160000_donation_goal_link.sql", "utf8");
  it("vínculo só com meta de doação do próprio usuário", () => {
    expect(sql).toMatch(/g\.user_id = new\.user_id and g\.kind = 'donation'/);
    expect(sql).toContain("donation_goal_id uuid references public.goals(id) on delete set null");
    expect(sql).toContain("donation_category_id uuid references public.categories(id) on delete set null");
  });
});
