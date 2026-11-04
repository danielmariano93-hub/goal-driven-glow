import { describe, expect, it } from "vitest";
import { applyHomeProjection, buildReportDashboard, type DashEntry } from "@/lib/engine/reportDashboard";

// `month_projection.v2`: o total até aqui não se multiplica por inteiro. Caso real (3/11): R$ 1.627,77 em 3 dias, dos quais
// R$ 1.183,82 eram parcelas e compras de faturas anteriores (uma vez por mês) — a projeção antiga dava R$ 16.277,70.
const e = (date: string, amount: number, category: string, extra: Partial<DashEntry> = {}): DashEntry => ({
  date, kind: "expense", amount, category_id: `c-${category}`, category, merchant_key: category, merchant: category, ...extra,
} as DashEntry);
const history = [
  e("2026-08-05", 1000, "Moradia"), e("2026-09-05", 1000, "Moradia"), e("2026-10-05", 1000, "Moradia"),
  ...["08", "09", "10"].flatMap((m) => Array.from({ length: 10 }, (_, i) => e(`2026-${m}-${String(3 + i * 3).padStart(2, "0")}`, 60, "Alimentação"))),
];
const run = (list: DashEntry[], today: string) => buildReportDashboard(list, { today, start: `${today.slice(0, 7)}-01`, end: today, compare: "none" });

describe("projeção do mês nos Relatórios", () => {
  it("caso real: parcelas de fatura anterior entram uma vez, não ×10", () => {
    const entries = [
      ...history,
      e("2026-11-01", 443.95, "Serviços"),
      e("2026-11-01", 545.13, "Serviços", { chart_date: "2026-09-30", chart_carried: true }),
      e("2026-11-01", 508.79, "Serviços", { chart_date: "2026-07-30", chart_carried: true }),
      e("2026-11-01", 129.9, "Serviços", { chart_date: "2026-10-27" }),
    ];
    const d = run(entries, "2026-11-03");
    expect(d.totals.expense).toBeCloseTo(1627.77, 2);
    expect(d.projection!.fixedKnown).toBeCloseTo(1183.82, 2);
    expect(d.projection!.early).toBe(true);
    // fixo conhecido + (Serviços: gasto já feito, sem histórico) + o que falta da média de Moradia e Alimentação
    expect(d.projection!.expense).toBeLessThan(5000);
    expect(d.projection!.expense).toBeGreaterThan(d.totals.expense);
  });
  it("aluguel pago no dia 1 não é multiplicado por 30", () => {
    const d = run([...history, e("2026-11-01", 1000, "Moradia"), e("2026-11-02", 60, "Alimentação")], "2026-11-09");
    // Moradia: 1000 já pago (média 1000, nada a somar); Alimentação: pace só com gasto em ≥50% dos dias
    expect(d.projection!.expense).toBeLessThan(1000 + 60 * 30);
    expect(d.projection!.expense).toBeGreaterThanOrEqual(1060);
  });
  it("consumo contínuo (gasto em ≥ 50% dos dias, depois de 7 dias) projeta pelo ritmo", () => {
    const daily = Array.from({ length: 10 }, (_, i) => e(`2026-11-${String(1 + i).padStart(2, "0")}`, 50, "Alimentação"));
    const d = run(daily, "2026-11-10");
    expect(d.projection!.early).toBe(false);
    expect(d.projection!.expense).toBeCloseTo(50 * 30, 0); // 500 em 10 dias → 1.500 em 30
  });
  it("antes de 7 dias, só o histórico: não existe 'ritmo' de 3 dias", () => {
    const d = run([...history, e("2026-11-01", 400, "Alimentação")], "2026-11-03");
    expect(d.projection!.early).toBe(true);
    // Alimentação: 400 já gastos + o que falta da média (600/mês) × dias restantes/30 — nunca 400 ÷ 3 × 30
    expect(d.projection!.expense).toBeLessThan(400 / 3 * 30);
  });
  it("o texto é o mesmo de sempre; antes de 7 dias avisa que usou o histórico (sem 'ainda é cedo' no título)", () => {
    const d = run([...history, e("2026-11-01", 400, "Alimentação")], "2026-11-03");
    const h = d.highlights.find((x) => x.id === "projection")!;
    expect(h.title).toMatch(/^No ritmo atual, o mês fecha em R\$/);
    expect(h.body).toMatch(/Base pequena: só 3 dias do mês, então usei o seu histórico\./);
    const later = run(Array.from({ length: 10 }, (_, i) => e(`2026-11-${String(1 + i).padStart(2, "0")}`, 50, "Alimentação")), "2026-11-10");
    expect(later.highlights.find((x) => x.id === "projection")!.body).not.toMatch(/Base pequena/);
  });
});

describe("projeção dos Relatórios = projeção da Home", () => {
  const home = { total: 8200.54, composition: { realized: 288.78, variable: 3861, commitments: 3920.86, cardDue: 129.9, confidence: "low" } };
  it("troca pelo número da Home e explica a composição", () => {
    const d = applyHomeProjection(run([...history, e("2026-11-01", 400, "Alimentação")], "2026-11-03"), home);
    expect(d.projection!.expense).toBe(8200.54);
    expect(d.projection!.source).toBe("home");
    const h = d.highlights.filter((x) => x.id === "projection");
    expect(h).toHaveLength(1);
    expect(h[0]!.title).toMatch(/^Previsão do mês: R\$\s?8\.200,54 de gasto$/);
    expect(h[0]!.body).toMatch(/Já gasto R\$\s?288,78 \+ ritmo previsto R\$\s?3\.861,00 \+ compromissos e fatura R\$\s?4\.050,76 \(a mesma previsão da Home\)\./);
  });
  it("com filtro ativo ou sem projeção, não mexe", () => {
    const sem = buildReportDashboard([e("2026-10-05", 10, "Moradia")], { today: "2026-10-02", start: "2026-10-01", end: "2026-10-02", compare: "none" });
    expect(sem.projection).toBeNull();
    expect(applyHomeProjection(sem, home)).toBe(sem);
  });
});
