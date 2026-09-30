import { describe, expect, it } from "vitest";
import { planFromAdvice, planFromCommand } from "../../supabase/functions/_shared/agent/core/SpendingGoalTools";
import { adviseGoals, type SpendingGoalContext } from "../../supabase/functions/_shared/spendingGoals/runtime";
import { buildSpendingLedger, type SpendingLedgerTx } from "@/lib/engine/spendingGoals";
import { buildMerchantResolver } from "@/lib/engine/merchant";
import { toolForAction } from "../../supabase/functions/_shared/agent/core/ActionIR";
import { confirmationExecutor } from "../../supabase/functions/_shared/agent/core/PendingConfirmations";
import { buildReceipt } from "../../supabase/functions/_shared/agent/core/ReceiptBuilder";

const TRANSPORTE = "cat-transporte";
const ASSINATURAS = "cat-assinaturas";
const ALIMENTACAO = "cat-alimentacao";
const LAZER = "cat-lazer";

let seq = 0;
const tx = (occurred_at: string, amount: number, merchant_name: string, category_id: string): SpendingLedgerTx => ({
  id: `t${++seq}`, account_id: "acc", category_id, type: "expense", status: "confirmed", amount, occurred_at,
  description: merchant_name, merchant_name, transfer_group_id: null, movement_kind: "transaction",
} as SpendingLedgerTx);

function rows(): SpendingLedgerTx[] {
  const out: SpendingLedgerTx[] = [];
  ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].forEach((m, i) => {
    for (let d = 1; d <= 10; d += 1) out.push(tx(`${m}-${String(d * 2).padStart(2, "0")}`, 30 + i * 3, d % 2 ? "ON UBER TRIP H03/01" : "PAY 99 TE", TRANSPORTE));
    out.push(tx(`${m}-10`, 150, "PIX QRS AUTOPASS S.21/01", TRANSPORTE));
    out.push(tx(`${m}-12`, 120, "LOVABLELOVABLE.DEVUS", ASSINATURAS));
    out.push(tx(`${m}-15`, 45, "Netflix", ASSINATURAS));
    for (let d = 1; d <= 4; d += 1) out.push(tx(`${m}-${String(d * 6).padStart(2, "0")}`, 60 + i * 5, d % 2 ? "PAY -IFD B 28/02" : "99Food", ALIMENTACAO));
    for (let d = 1; d <= 5; d += 1) out.push(tx(`${m}-${String(d * 5).padStart(2, "0")}`, 80 + i * 10, "Bar do Zé", LAZER));
  });
  return out;
}

function sg(goals: unknown[] = []): SpendingGoalContext {
  const resolver = buildMerchantResolver();
  const r = rows();
  return {
    as_of: "2026-09-15", rows: r as never, entries: buildSpendingLedger(r, resolver), resolver,
    categories: [
      { id: TRANSPORTE, name: "Transporte" }, { id: ASSINATURAS, name: "Assinaturas" },
      { id: ALIMENTACAO, name: "Alimentação" }, { id: LAZER, name: "Lazer" },
    ],
    goals: goals as never, targets: [],
  };
}

describe("Nino cria metas de gasto por comando", () => {
  it("'Dentro de Transporte, reduza Uber e 99 pela metade' vira meta + submeta agrupada", () => {
    const ctx = sg();
    const out = planFromCommand(ctx, adviseGoals(ctx), { category: "Transporte", merchants: "Uber, 99", percent: "50" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const goal = out.goals[0];
    expect(goal.category_name).toBe("Transporte");
    expect(goal.create?.computed_limit).toBeGreaterThan(0);
    const target = goal.targets[0];
    expect(target.merchant_keys.sort()).toEqual(["99", "uber"]);
    expect(target.limit_kind).toBe("percent_reduction");
    expect(target.computed_limit).toBeCloseTo(target.baseline_amount / 2, 1);
    expect(out.summary).toContain("Submeta Uber + 99: reduzir 50%");
    expect(out.summary).toContain("também conta na meta da categoria");
  });

  it("'Não quero mais cobranças da Lovable' descobre a categoria e zera", () => {
    const ctx = sg();
    const out = planFromCommand(ctx, adviseGoals(ctx), { merchants: "Lovable", limit_kind: "zero" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.goals[0].category_name).toBe("Assinaturas");
    expect(out.goals[0].targets[0]).toMatchObject({ merchant_keys: ["lovable"], limit_kind: "zero", computed_limit: 0 });
    expect(out.summary).toContain("gasto zero");
  });

  it("'Quero limitar meus gastos com delivery' agrupa iFood e 99 Food", () => {
    const ctx = sg();
    const out = planFromCommand(ctx, adviseGoals(ctx), { merchants: "delivery" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.goals[0].targets[0].merchant_keys.sort()).toEqual(["99 food", "ifood"]);
    expect(out.goals[0].targets[0].limit_kind).toBe("percent_reduction");
  });

  it("estabelecimento sem histórico vira pergunta, não invenção", () => {
    const ctx = sg();
    const out = planFromCommand(ctx, adviseGoals(ctx), { category: "Lazer", merchants: "Casa Inexistente XYZ" });
    expect(out.ok).toBe(false);
  });

  it("limite da categoria com meta existente atualiza o teto", () => {
    const ctx = sg([{ id: "g1", category_id: LAZER, status: "active", period_type: "monthly_recurring", computed_limit: 900, start_date: "2026-08-01" }]);
    const out = planFromCommand(ctx, adviseGoals(ctx), { category: "Lazer", category_limit: "800" });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.goals[0].goal_id).toBe("g1");
    expect(out.goals[0].create).toMatchObject({ computed_limit: 800, replace_limit: true });
  });
});

describe("Nino analisa o histórico e propõe metas", () => {
  it("explica referência, maior/menor mês, quem explica, economia e pede confirmação", () => {
    const ctx = sg();
    const out = planFromAdvice(ctx, adviseGoals(ctx));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.summary).toContain("Analisei 6 meses de despesa real");
    expect(out.summary).toMatch(/Maior mês: \w+/);
    expect(out.summary).toContain("Quem mais explica:");
    expect(out.summary).toContain("Posso criar assim?");
    expect(out.goals.length).toBeGreaterThan(0);
    expect(out.goals.every((g) => g.create === null || g.create.computed_limit > 0)).toBe(true);
  });
});

describe("contrato da escrita", () => {
  it("ação, executor e recibo estão ligados", () => {
    expect(toolForAction("spending_goal.plan")).toBe("lifecycle_spending_goal_plan_draft");
    expect(confirmationExecutor("spending_goal_plan")).toBe("agent_execute_spending_goal_plan_confirmation_v1");
    expect(buildReceipt("spending_goal_plan", { receipt_text: "Metas de gasto salvas: Transporte." })).toBe("Metas de gasto salvas: Transporte. ✅");
  });
});
