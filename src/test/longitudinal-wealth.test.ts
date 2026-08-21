import { describe, expect, it } from "vitest";
import { computeLongitudinal } from "@/lib/engine/longitudinal";
import { computeWealthOpportunity } from "@/lib/engine/wealthOpportunity";
import type { TransactionRow } from "@/lib/engine/facts";

const FLEX = "cat-flex";
const STRUCT = "cat-struct";
const names: Record<string, string> = { [FLEX]: "Lazer", [STRUCT]: "Moradia" };

let seq = 0;
function tx(partial: Partial<TransactionRow>): TransactionRow {
  seq += 1;
  return {
    id: `t${seq}`,
    user_id: "u1",
    account_id: "a1",
    category_id: null,
    type: "expense",
    status: "confirmed",
    amount: 0,
    occurred_at: "2026-01-10",
    description: "x",
    ...partial,
  } as unknown as TransactionRow;
}

/** Série de 12 meses: renda estável e consumo flexível que sobe na metade. */
function series(flexByMonth: number[], income = 5000): TransactionRow[] {
  const rows: TransactionRow[] = [];
  flexByMonth.forEach((flex, i) => {
    const month = String(i + 1).padStart(2, "0");
    rows.push(tx({ type: "income", amount: income, occurred_at: `2026-${month}-05`, category_id: null }));
    rows.push(tx({ type: "expense", amount: flex, occurred_at: `2026-${month}-12`, category_id: FLEX }));
    rows.push(tx({ type: "expense", amount: 1500, occurred_at: `2026-${month}-15`, category_id: STRUCT }));
  });
  return rows;
}

const period = { from: "2026-01-01", to: "2026-12-31" };

describe("longitudinal_intelligence.v1", () => {
  it("monta a série mensal separando flexível de estrutural", () => {
    const env = computeLongitudinal({
      txs: series([800, 800, 800, 800, 800, 800, 800, 800, 800, 800, 800, 800]),
      period,
      categoryNames: names,
    });
    expect(env.facts.months_analyzed).toBe(12);
    const jan = env.facts.months[0];
    expect(jan.income).toBe(5000);
    expect(jan.flexible_expense).toBe(800);
    expect(jan.structural_expense).toBe(1500);
    expect(jan.net).toBe(2700);
    expect(env.facts.behavior_trend.direction).toBe("estavel");
  });

  it("detecta o ponto de virada quando o consumo flexível salta", () => {
    const env = computeLongitudinal({
      txs: series([600, 620, 590, 610, 600, 605, 1800, 1850, 1790, 1820, 1810, 1830]),
      period,
      categoryNames: names,
    });
    const cp = env.facts.change_point;
    expect(cp).not.toBeNull();
    expect(cp!.month).toBe("2026-07");
    expect(cp!.direction).toBe("piorando");
    expect(env.facts.behavior_trend.direction).toBe("piorando");
  });

  it("não chama de melhora comportamental o que é renda maior", () => {
    const rows: TransactionRow[] = [];
    for (let i = 0; i < 12; i++) {
      const month = String(i + 1).padStart(2, "0");
      rows.push(tx({ type: "income", amount: i < 6 ? 5000 : 12000, occurred_at: `2026-${month}-05` }));
      rows.push(tx({ type: "expense", amount: i < 6 ? 1000 : 2200, occurred_at: `2026-${month}-12`, category_id: FLEX }));
    }
    const env = computeLongitudinal({ txs: rows, period, categoryNames: names });
    expect(env.facts.result_trend.direction).toBe("melhorando");
    expect(env.facts.result_driven_by_income).toBe(true);
  });

  it("ignora transferências internas e pagamento de fatura", () => {
    const rows = [
      ...series([700, 700, 700, 700, 700, 700, 700, 700, 700, 700, 700, 700]),
      tx({ type: "transfer", amount: 3000, occurred_at: "2026-03-10", transfer_group_id: "g1" }),
      tx({ type: "expense", amount: 4000, occurred_at: "2026-03-11", settles_card_id: "c1", category_id: FLEX }),
    ];
    const env = computeLongitudinal({ txs: rows, period, categoryNames: names });
    expect(env.facts.months[2].flexible_expense).toBe(700);
    expect(env.facts.months[2].net).toBe(2800);
  });
});

describe("wealth_opportunity.v1", () => {
  const longitudinal = computeLongitudinal({
    txs: series([600, 600, 600, 600, 600, 600, 2000, 2000, 2000, 2000, 2000, 2000]),
    period,
    categoryNames: names,
  }).facts;

  it("mede o excesso apenas acima da baseline pessoal", () => {
    const env = computeWealthOpportunity({ longitudinal, actualNetWorth: 10_000, period });
    // mediana da série = 1300; só os 6 meses de 2000 geram excesso (700 cada).
    expect(env.facts.recoverable_excess).toBe(4200);
    expect(env.facts.recoverable_monthly).toBe(350);
    expect(env.facts.actual_net_worth).toBe(10_000);
  });

  it("não promete acúmulo quando o consumo ficou na própria média", () => {
    const flat = computeLongitudinal({
      txs: series([900, 900, 900, 900, 900, 900, 900, 900, 900, 900, 900, 900]),
      period,
      categoryNames: names,
    }).facts;
    const env = computeWealthOpportunity({ longitudinal: flat, actualNetWorth: 5_000, period });
    expect(env.facts.recoverable_excess).toBe(0);
    expect(env.facts.opportunity_gap).toBe(0);
    for (const s of env.facts.scenarios) expect(s.total_saved).toBe(0);
  });

  it("capitaliza por aporte quando há rendimento explícito", () => {
    const sem = computeWealthOpportunity({ longitudinal, actualNetWorth: 0, period });
    const com = computeWealthOpportunity({ longitudinal, actualNetWorth: 0, period, annualYieldPct: 12 });
    const semReal = sem.facts.scenarios.find((s) => s.key === "realista")!;
    const comReal = com.facts.scenarios.find((s) => s.key === "realista")!;
    expect(semReal.total_saved).toBe(175 * 12);
    expect(comReal.total_saved).toBeGreaterThan(semReal.total_saved);
  });

  it("limita a capacidade sustentável pela sobra real menos compromissos", () => {
    const env = computeWealthOpportunity({
      longitudinal,
      actualNetWorth: 0,
      period,
      monthlyCommitments: 2_900,
    });
    expect(env.facts.sustainable_monthly_saving).toBeLessThanOrEqual(175);
    const travado = computeWealthOpportunity({
      longitudinal,
      actualNetWorth: 0,
      period,
      monthlyCommitments: 99_999,
    });
    expect(travado.facts.sustainable_monthly_saving).toBe(0);
  });
});
