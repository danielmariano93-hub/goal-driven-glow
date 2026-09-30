// Antes de gastar (`nino_purchase_plan.v1`) — caso real de 30/09: R$ 6.600 em
// Transporte no cartão com compra em 01/10 aparecia como "Cabe no seu mês"
// porque o simulador só olhava setembro (que acabava hoje) e a compra pesa em
// outubro. Aqui a compra é julgada no mês em que pesa.
import { describe, expect, it } from "vitest";
import { computePurchasePlan } from "../../supabase/functions/_shared/insights/executive/purchasePlan";
import type { LedgerEntry } from "../../supabase/functions/_shared/insights/executive/engine";

let seq = 0;
const e = (date: string, amount: number, category: string, merchant: string | null, kind: "expense" | "income" = "expense"): LedgerEntry => ({
  id: String(++seq), date, kind, amount, category_id: `cat-${category}`, category, merchant_key: merchant?.toLowerCase() ?? null, merchant,
});

// Padrão parecido com o real: renda irregular, gasto típico ~R$ 16 mil,
// aluguel fixo de R$ 3.740, Transporte ~R$ 1,7 mil por mês.
function ledger(): LedgerEntry[] {
  const rows: LedgerEntry[] = [];
  const months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  const incomes = [14000, 18200, 10700, 34500, 7700, 8500, 24400];
  months.forEach((m, i) => {
    rows.push(e(`${m}-05`, incomes[i], "Salário", null, "income"));
    rows.push(e(`${m}-30`, 3740, "Moradia", "LS Prado"));
    rows.push(e(`${m}-10`, 44.9, "Assinaturas", "Netflix"));
    // Uber e lazer: várias cobranças de valor variado (gasto variável, não fixo).
    [400, 250, 380, 300, 370].forEach((v, k) => rows.push(e(`${m}-${String(3 + k * 5).padStart(2, "0")}`, v, "Transporte", "Uber")));
    [4000, 2500, 4000].forEach((v, k) => rows.push(e(`${m}-${String(8 + k * 7).padStart(2, "0")}`, v, "Lazer", `Lazer ${i}-${k}`)));
  });
  return rows;
}

const base = (months: Array<{ month: string; amount: number }>, limits?: Record<string, number | null>) => computePurchasePlan({
  as_of: "2026-09-30",
  entries: ledger(),
  future_installments: [{ month: "2026-10", amount: 4735.46 }, { month: "2026-11", amount: 2078.15 }],
  purchase: { amount: 6600, category_id: "cat-Transporte", category_name: "Transporte", months, category_limits: limits },
});

describe("compra futura é julgada no mês em que pesa", () => {
  it("R$ 6.600 no cartão, fatura de outubro: não cabe (antes dizia 'Cabe no seu mês')", () => {
    const plan = base([{ month: "2026-10", amount: 6600 }]);
    expect(plan.months).toHaveLength(1);
    const oct = plan.months[0];
    expect(oct.label).toBe("Outubro");
    expect(oct.income).toBe(12350); // mediana dos 6 meses fechados (10.700 e 14.000)
    expect(oct.outflow).toBeCloseTo(15984.9, 1); // gasto típico, já com aluguel
    expect(oct.margin_before).toBeLessThan(0);
    expect(oct.margin_after).toBeCloseTo(oct.margin_before - 6600, 2);
    expect(plan.verdict).toBe("worsens_deficit");
    expect(plan.headline).toBe("Não cabe: outubro já tende a fechar no negativo");
    expect(plan.explanation).toContain("já com aluguel, contas e parcelas de sempre");
  });

  it("aluguel e assinaturas entram como compromissos fixos detectados pelo histórico", () => {
    const plan = base([{ month: "2026-10", amount: 6600 }]);
    expect(plan.fixed_commitments.map((f) => f.label)).toEqual(expect.arrayContaining(["LS Prado", "Netflix"]));
    expect(plan.fixed_commitments.find((f) => f.label === "LS Prado")?.amount).toBe(3740);
  });

  it("categoria: típico do mês + compra contra o limite do mês da compra", () => {
    const plan = base([{ month: "2026-10", amount: 6600 }], { "2026-10": 1222.86 });
    const cat = plan.months[0].category!;
    expect(cat.typical).toBe(1700);
    expect(cat.after).toBe(8300);
    expect(cat.exceeds_limit).toBe(true);
    expect(cat.text).toBe("Transporte em outubro: seu gasto típico (R$ 1.700,00) mais esta compra dá R$ 8.300,00, R$ 7.077,14 acima do limite de R$ 1.222,86.");
  });

  it("sem meta, compara com o normal da categoria", () => {
    const cat = base([{ month: "2026-10", amount: 6600 }]).months[0].category!;
    expect(cat.text).toContain("4,9 vezes o seu normal (R$ 1.700,00)");
  });

  it("parcelado: cada parcela no mês da sua fatura, com o pior mês decidindo", () => {
    const plan = base([
      { month: "2026-10", amount: 1100 }, { month: "2026-11", amount: 1100 }, { month: "2026-12", amount: 1100 },
      { month: "2027-01", amount: 1100 }, { month: "2027-02", amount: 1100 }, { month: "2027-03", amount: 1100 },
    ]);
    expect(plan.months.map((m) => m.month)).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02", "2027-03"]);
    expect(plan.months.every((m) => m.purchase === 1100)).toBe(true);
  });

  it("renda irregular: mostra o cenário do mês mais fraco", () => {
    const plan = base([{ month: "2026-10", amount: 6600 }]);
    expect(plan.notes.join(" ")).toMatch(/Num mês fraco como o seu pior dos últimos 6 \(R\$ 7,7 mil\), outubro fecharia R\$ [\d,]+ mil no negativo\./);
  });
});

describe("quando cabe, diz que cabe", () => {
  it("compra pequena com sobra real", () => {
    const rows = ledger().map((row) => (row.kind === "income" ? { ...row, amount: 25000 } : row));
    const plan = computePurchasePlan({
      as_of: "2026-09-30", entries: rows,
      purchase: { amount: 300, category_id: "cat-Transporte", category_name: "Transporte", months: [{ month: "2026-10", amount: 300 }] },
    });
    expect(plan.verdict).toBe("fits");
    expect(plan.headline).toBe("Cabe no seu orçamento de outubro");
    expect(plan.months[0].summary).toMatch(/^Outubro: sobram R\$ [\d,]+ mil depois da compra\.$/);
  });

  it("sem renda registrada não afirma nada", () => {
    const rows = ledger().filter((row) => row.kind !== "income");
    const plan = computePurchasePlan({
      as_of: "2026-09-30", entries: rows,
      purchase: { amount: 300, category_id: null, category_name: "Outros", months: [{ month: "2026-10", amount: 300 }] },
    });
    expect(plan.verdict).toBe("unknown");
    expect(plan.headline).toBe("Preciso da sua renda para dizer se cabe");
  });
});

import { categoryLimitsFor, purchaseMonths } from "@/lib/nino/purchasePlan";

describe("app: meses afetados e limite de meta por mês", () => {
  it("cartão: 1ª parcela na fatura do ciclo, as demais nos meses seguintes; à vista no mês da compra", () => {
    expect(purchaseMonths({ method: "card", plannedDate: "2026-10-01", cardCompetence: "2026-10", installments: 3, installmentAmount: 2200, amount: 6600 }))
      .toEqual([{ month: "2026-10", amount: 2200 }, { month: "2026-11", amount: 2200 }, { month: "2026-12", amount: 2200 }]);
    expect(purchaseMonths({ method: "card", plannedDate: "2026-12-20", cardCompetence: "2027-01", installments: 2, installmentAmount: 50, amount: 100 }))
      .toEqual([{ month: "2027-01", amount: 50 }, { month: "2027-02", amount: 50 }]);
    expect(purchaseMonths({ method: "cash", plannedDate: "2026-10-01", cardCompetence: null, installments: 1, installmentAmount: 6600, amount: 6600 }))
      .toEqual([{ month: "2026-10", amount: 6600 }]);
  });

  it("meta recorrente vale todo mês; meta de período só dentro dele (o estouro de setembro não vira culpa da compra de outubro)", () => {
    const recurring = { targetAmount: 1222.86, periodType: "monthly_recurring", period: { start: "2026-09-01", end: "2026-09-30" }, goal: { start_date: "2026-09-01" } };
    expect(categoryLimitsFor(["2026-10", "2026-11"], recurring)).toEqual({ "2026-10": 1222.86, "2026-11": 1222.86 });
    const septemberOnly = { ...recurring, periodType: "this_month" };
    expect(categoryLimitsFor(["2026-10"], septemberOnly)).toEqual({ "2026-10": null });
    expect(categoryLimitsFor(["2026-10"], null)).toEqual({ "2026-10": null });
  });
});
