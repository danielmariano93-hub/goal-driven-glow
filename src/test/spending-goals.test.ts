import { describe, expect, it } from "vitest";
import {
  analyzeSpendingHistory,
  buildSpendingLedger,
  evaluateGoalBreakdown,
  merchantTargetLimit,
  summarizeClosedCycle,
  weekendAllowance,
  type MerchantTargetRow,
  type SpendingLedgerTx,
} from "@/lib/engine/spendingGoals";

const TRANSPORTE = "cat-transporte";
const ASSINATURAS = "cat-assinaturas";
const MORADIA = "cat-moradia";

let seq = 0;
function tx(partial: Partial<SpendingLedgerTx> & { occurred_at: string; amount: number }): SpendingLedgerTx {
  seq += 1;
  return {
    id: partial.id ?? `t${seq}`,
    account_id: "acc",
    category_id: TRANSPORTE,
    type: "expense",
    status: "confirmed",
    description: null,
    transfer_group_id: null,
    movement_kind: "transaction",
    ...partial,
  } as SpendingLedgerTx;
}

/** Seis meses de histórico: Uber frequente, 99 frequente, Autopass fixo, Lovable fixo, aluguel fixo. */
function history(): SpendingLedgerTx[] {
  const rows: SpendingLedgerTx[] = [];
  const months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  months.forEach((m, i) => {
    for (let d = 1; d <= 8; d += 1) rows.push(tx({ occurred_at: `${m}-${String(d * 3).padStart(2, "0")}`, amount: 40 + i * 2, merchant_name: d % 2 ? "UBER *TRIP HELP.UBER.COM" : "Uber" }));
    for (let d = 1; d <= 4; d += 1) rows.push(tx({ occurred_at: `${m}-${String(d * 5).padStart(2, "0")}`, amount: 30, merchant_name: "PAY 99 TE" }));
    rows.push(tx({ occurred_at: `${m}-10`, amount: 150, merchant_name: "AUTOPASS" }));
    rows.push(tx({ occurred_at: `${m}-12`, amount: 120, merchant_name: "LOVABLE LABS", category_id: ASSINATURAS }));
    rows.push(tx({ occurred_at: `${m}-05`, amount: 3700, merchant_name: "LS PRADO", category_id: MORADIA }));
  });
  return rows;
}

describe("spending goals — livro canônico", () => {
  it("agrupa variações do extrato na mesma identidade e respeita competência e estornos", () => {
    const original = tx({ id: "uber-1", occurred_at: "2026-09-02", amount: 50, merchant_name: "UBER *TRIP HELP.UBER.COM" });
    const rows = [
      original,
      tx({ occurred_at: "2026-09-03", amount: 30, merchant_name: "Uber" }),
      // Estorno sem categoria: herda categoria e estabelecimento da despesa original.
      tx({ occurred_at: "2026-09-04", amount: 20, type: "income", movement_kind: "refund", refund_of_transaction_id: "uber-1", category_id: null, description: "ESTORNO" }),
      // Cartão: pertence à fatura de outubro.
      tx({ occurred_at: "2026-09-28", amount: 70, merchant_name: "Uber", credit_card_id: "card", payment_method: "credit_card", competence_date: "2026-10-10" }),
      // Transferência e pagamento de fatura nunca entram.
      tx({ occurred_at: "2026-09-05", amount: 999, type: "transfer", merchant_name: "Uber" }),
      tx({ occurred_at: "2026-09-05", amount: 888, merchant_name: "Uber", settles_card_id: "card" }),
    ];
    const ledger = buildSpendingLedger(rows);
    const sept = ledger.filter((e) => e.month === "2026-09");
    expect(new Set(sept.map((e) => e.merchant_key))).toEqual(new Set(["uber"]));
    expect(sept.reduce((a, e) => a + e.amount, 0)).toBe(60);
    expect(sept.find((e) => e.amount < 0)?.category_id).toBe(TRANSPORTE);
    expect(ledger.find((e) => e.month === "2026-10")?.amount).toBe(70);
  });

  it("une as variações reais do extrato (prefixo de maquininha, data colada, nome truncado)", () => {
    const names: Array<[string, string]> = [
      ["PAY AUTOP 0801", "autopass"], ["PIX QRS AUTOPASS S.21/01", "autopass"], ["Autopass s.a*atm Tmob", "autopass"],
      ["LOVABLELOVABLE.DEVUS", "lovable"], ["LOVABLELOVABLE.DEV", "lovable"], ["Lovable", "lovable"],
      ["PAY -IFD B 28/02", "ifood"], ["PIX QRS IFOOD.COM A30/01", "ifood"], ["ON IFD BR 18/02", "ifood"],
      ["LOCALIZA RAC A", "localiza"], ["LocalizaBelo H", "localiza"], ["PIX QRS LOCALIZA RE09/02", "localiza"],
      ["PAY DL Ub 1201", "uber"], ["ON UBER TRIP H03/01", "uber"], ["PIX QRS UBER DO BRA02/01", "uber"],
      ["PAY NETFL 01/02", "netflix"], ["RD SAUDE ONLINESAO PAUL", "rd saúde"], ["PIX QRS RD SAUDE", "rd saúde"],
      ["PAY VENDI 1101", "vendify"], ["ELCSS VENDIFY 1501", "vendify"],
      ["PAY HIROT 2101", "hirota food express"], ["Hirota Food Express", "hirota food express"],
    ];
    const ledger = buildSpendingLedger(names.map(([name], i) => tx({ id: `n${i}`, occurred_at: "2026-09-10", amount: 10, merchant_name: name })));
    names.forEach(([name, key], i) => expect([name, ledger.find((e) => e.id === `n${i}`)?.merchant_key]).toEqual([name, key]));
  });

  it("intermediador sozinho não vira estabelecimento", () => {
    const ledger = buildSpendingLedger([tx({ id: "x", occurred_at: "2026-09-10", amount: 10, merchant_name: "PIX AUT EBANX" })]);
    expect(ledger[0].merchant_key.startsWith("raw:")).toBe(true);
  });

  it("calcula o limite da submeta pelo tipo", () => {
    expect(merchantTargetLimit("percent_reduction", { reductionPct: 50, baseline: 400 })).toBe(200);
    expect(merchantTargetLimit("amount", { amount: 250 })).toBe(250);
    expect(merchantTargetLimit("zero", {})).toBe(0);
    expect(merchantTargetLimit("track", {})).toBeNull();
  });
});

describe("spending goals — acompanhamento mês a mês", () => {
  const targets: MerchantTargetRow[] = [
    { id: "apps", goal_id: "g1", label: "Uber + 99", merchant_keys: ["uber", "99"], limit_kind: "percent_reduction", reduction_pct: 50, baseline_amount: 460, computed_limit: 230, status: "active" },
    // A mesma chave numa segunda submeta não é contada duas vezes.
    { id: "dup", goal_id: "g1", label: "Só Uber", merchant_keys: ["uber"], limit_kind: "track", status: "active" },
    { id: "auto", goal_id: "g1", label: "Autopass", merchant_keys: ["autopass"], limit_kind: "track", status: "active" },
  ];
  const rows = [
    ...history(),
    tx({ occurred_at: "2026-09-02", amount: 90, merchant_name: "Uber" }),
    tx({ occurred_at: "2026-09-06", amount: 80, merchant_name: "Uber" }),
    tx({ occurred_at: "2026-09-08", amount: 60, merchant_name: "PAY 99 TE" }),
    tx({ occurred_at: "2026-09-10", amount: 150, merchant_name: "AUTOPASS" }),
    tx({ occurred_at: "2026-09-11", amount: 45, merchant_name: "Estacionamento Centro" }),
  ];
  const entries = buildSpendingLedger(rows);
  const breakdown = evaluateGoalBreakdown({
    goal: { id: "g1", category_id: TRANSPORTE, limit: 700 },
    period: { start: "2026-09-01", end: "2026-09-30" },
    today: "2026-09-12",
    targets,
    entries,
  });

  it("detalha submetas, Outros e contribuição sem somar em dobro", () => {
    const apps = breakdown.targets.find((t) => t.id === "apps")!;
    expect(apps.actual).toBe(230);
    expect(apps.limit).toBe(230);
    expect(apps.status).toBe("at_risk");
    expect(breakdown.targets.find((t) => t.id === "dup")!.actual).toBe(0);
    expect(breakdown.others.actual).toBe(45);
    const total = breakdown.targets.reduce((a, t) => a + t.actual, 0) + breakdown.others.actual;
    expect(total).toBe(425);
    expect(breakdown.main_driver?.label).toBe("Uber + 99");
    expect(breakdown.main_driver?.reason).toBe("over_target");
  });

  it("compara consumo com o tempo transcorrido", () => {
    expect(breakdown.elapsed_share).toBeCloseTo(0.4, 1);
    expect(breakdown.consumed_share).toBeCloseTo(425 / 700, 2);
    expect(breakdown.pace).toBe("ahead");
  });

  it("fixo projeta pela cobrança, não pelo ritmo", () => {
    const auto = breakdown.targets.find((t) => t.id === "auto")!;
    expect(auto.projected).toBe(150);
    expect(auto.status).toBe("monitoring");
  });

  it("submeta zero acusa nova cobrança", () => {
    const zero = evaluateGoalBreakdown({
      goal: { id: "g2", category_id: ASSINATURAS, limit: 100 },
      period: { start: "2026-09-01", end: "2026-09-30" },
      today: "2026-09-13",
      targets: [{ id: "lov", goal_id: "g2", label: "Lovable", merchant_keys: ["lovable"], limit_kind: "zero", computed_limit: 0, status: "active" }],
      entries: buildSpendingLedger([...history(), tx({ occurred_at: "2026-09-12", amount: 120, merchant_name: "LOVABLE LABS", category_id: ASSINATURAS })]),
    });
    expect(zero.targets[0].status).toBe("zero_violated");
    expect(zero.targets[0].message).toContain("assinatura ainda ativa");
  });
});

describe("spending goals — análise do histórico", () => {
  const advice = analyzeSpendingHistory({
    entries: buildSpendingLedger(history()),
    categories: [{ id: TRANSPORTE, name: "Transporte" }, { id: ASSINATURAS, name: "Assinaturas" }, { id: MORADIA, name: "Moradia" }],
    today: "2026-09-15",
  });

  it("propõe limite abaixo da referência e agrupa apps semelhantes", () => {
    const transporte = advice.categories.find((c) => c.category_id === TRANSPORTE)!;
    expect(transporte.discretionary).toBe(true);
    expect(transporte.recommended_limit).toBeLessThan(transporte.reference);
    expect(transporte.recommended_limit).toBeGreaterThanOrEqual(transporte.fixed_floor);
    expect(transporte.impact.m12).toBeCloseTo(transporte.potential_monthly * 12, 2);
    const group = transporte.suggested_targets.find((t) => t.merchant_keys.includes("uber"))!;
    expect(group.merchant_keys.sort()).toEqual(["99", "uber"]);
    expect(group.limit_kind).toBe("percent_reduction");
    expect(transporte.merchants.find((m) => m.key === "autopass")?.behavior).toBe("fixed");
    expect(transporte.max && transporte.min).toBeTruthy();
  });

  it("não sugere corte em obrigação e marca assinatura fixa para revisão", () => {
    const moradia = advice.categories.find((c) => c.category_id === MORADIA)!;
    expect(moradia.discretionary).toBe(false);
    expect(moradia.potential_monthly).toBe(0);
    expect(moradia.suggested_targets).toHaveLength(0);
    const assinaturas = advice.categories.find((c) => c.category_id === ASSINATURAS)!;
    expect(assinaturas.merchants[0].review).toBe(true);
    expect(assinaturas.suggested_targets[0]?.rationale).toContain("zerar");
  });

  it("identifica mês atípico sem deixar ele inflar a referência", () => {
    const rows = [...history(), tx({ occurred_at: "2026-08-20", amount: 5000, merchant_name: "LOCADORA X" })];
    const out = analyzeSpendingHistory({ entries: buildSpendingLedger(rows), categories: [{ id: TRANSPORTE, name: "Transporte" }], today: "2026-09-15" });
    const t = out.categories[0];
    expect(t.atypical.map((a) => a.month)).toContain("2026-08");
    expect(t.reference).toBeLessThan(1000);
  });
});

describe("spending goals — comunicação", () => {
  it("reserva mais para o fim de semana quando ele costuma pesar mais", () => {
    const rows: SpendingLedgerTx[] = [];
    // Julho a setembro: sábados caros, dias úteis baratos.
    for (let d = new Date("2026-07-01T12:00:00Z"); d <= new Date("2026-09-15T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const dow = d.getUTCDay();
      rows.push(tx({ occurred_at: iso, amount: dow === 6 ? 120 : dow === 0 || dow === 5 ? 60 : 10, category_id: "lazer", merchant_name: "Bar" }));
    }
    const out = weekendAllowance({
      entries: buildSpendingLedger(rows), categoryId: "lazer", today: "2026-09-16",
      period: { start: "2026-09-01", end: "2026-09-30" }, remainingBudget: 600,
    })!;
    expect(out.weekend_days).toEqual(["2026-09-18", "2026-09-19", "2026-09-20"]);
    expect(out.allowance).toBeGreaterThan(600 * 3 / 14);
    expect(out.allowance).toBeLessThan(600);
  });

  it("fechamento mensal aponta a economia e quem mais contribuiu", () => {
    const rows = [
      ...history(),
      tx({ occurred_at: "2026-09-02", amount: 60, merchant_name: "Uber" }),
      tx({ occurred_at: "2026-09-10", amount: 150, merchant_name: "AUTOPASS" }),
    ];
    const summary = summarizeClosedCycle({
      goal: { id: "g1", category_id: TRANSPORTE, limit: 700, baseline: 760, name: "Transporte" },
      month: "2026-09",
      targets: [{ id: "apps", goal_id: "g1", label: "Uber + 99", merchant_keys: ["uber", "99"], limit_kind: "amount", computed_limit: 230, baseline_amount: 460, status: "active" }],
      entries: buildSpendingLedger(rows),
    });
    expect(summary.met).toBe(true);
    expect(summary.savings).toBe(550);
    expect(summary.best_target?.label).toBe("Uber + 99");
    expect(summary.text).toContain("foi cumprida");
  });
});
