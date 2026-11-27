import { describe, expect, it } from "vitest";
import { computeBenefitState, project, ticketCycles, type BenefitEntry, type BenefitState } from "@/lib/engine/benefitWallet";
import {
  dailyKpis, deltaMoney, filterStatement, merchantKey, merchantRanking, performance, statementTotals, ticketFoodRows,
  totalsIn, weekdayAverages, weekdayPeak, type FoodRow, type StatementRow,
} from "@/lib/engine/ticketAnalytics";

const row = (date: string, amount: number, source: FoodRow["source"] = "ticket", merchant: string | null = "Loja"): FoodRow => ({ id: `${date}-${amount}-${source}`, date, amount, source, merchant });
const e = (id: string, occurred_on: string, amount: number, kind: BenefitEntry["kind"] = "spend"): BenefitEntry => ({ id, kind, amount, occurred_on });

describe("Quando você mais gasta: média por ocorrência", () => {
  it("segundas com 100, 0, 50 e 0 → média 37,50, total 150, n=4 (dias sem compra contam como zero)", () => {
    // segundas: 02/11, 09/11, 16/11, 23/11/2026
    const w = weekdayAverages([row("2026-11-02", 100), row("2026-11-16", 50)], "ticket", "2026-11-02", "2026-11-29");
    expect(w.by_weekday[0]).toMatchObject({ total: 150, occurrences: 4, avg: 37.5 });
  });
  it("segunda desconhecida (fora da janela conhecida) não entra como zero: n=3", () => {
    const w = weekdayAverages([row("2026-11-16", 50), row("2026-11-23", 100)], "ticket", "2026-11-09", "2026-11-29");
    expect(w.by_weekday[0]).toMatchObject({ total: 150, occurrences: 3, avg: 50 });
  });
  it("filtro de fonte recalcula: Ticket, Bolso e Total", () => {
    const rows = [row("2026-11-02", 40), row("2026-11-02", 10, "own")];
    expect(weekdayAverages(rows, "ticket", "2026-11-02", "2026-11-02").by_weekday[0].avg).toBe(40);
    expect(weekdayAverages(rows, "own", "2026-11-02", "2026-11-02").by_weekday[0].avg).toBe(10);
    expect(weekdayAverages(rows, "total", "2026-11-02", "2026-11-02").by_weekday[0].avg).toBe(50);
  });
  it("insight do período só com 4 ocorrências de cada dia", () => {
    expect(weekdayPeak(weekdayAverages([row("2026-11-04", 80)], "ticket", "2026-11-02", "2026-11-15"))).toBeNull();
    const four = weekdayAverages([row("2026-11-04", 80), row("2026-11-11", 80), row("2026-11-18", 80), row("2026-11-25", 80), row("2026-11-02", 20)], "ticket", "2026-11-02", "2026-11-29");
    expect(weekdayPeak(four)).toMatchObject({ weekday: 2, avg: 80 });
  });
});

describe("Ticket ou bolso e desempenho", () => {
  it("T=1.237,45, B=725,97 → total 1.963,42 e cobertura 63,03% (o handoff truncou para 63,02)", () => {
    const t = totalsIn([row("2026-11-01", 1237.45), row("2026-11-01", 725.97, "own")], "2026-10-27", "2026-11-26");
    expect(t).toMatchObject({ ticket: 1237.45, own: 725.97, total: 1963.42, coverage_pct: 63.03 });
  });
  it("base zero e sem dados: sem infinito nem NaN", () => {
    expect(totalsIn([], "2026-11-01", "2026-11-05").coverage_pct).toBeNull();
    expect(deltaMoney(10, 0)).toEqual({ abs: 10, pct: null, kind: "new" });
    expect(deltaMoney(0, 0)).toEqual({ abs: 0, pct: null, kind: "none" });
    expect(deltaMoney(5, null)).toBeNull();
  });
  const w = { credit_day: 27 };
  const entries = [e("x", "2026-09-01", 26), e("c1", "2026-09-25", 1281, "credit"), e("a", "2026-10-01", 100), e("c2", "2026-10-27", 1227, "credit"), e("b", "2026-10-28", 50), e("c", "2026-11-05", 70)];
  const cycles = ticketCycles(w, entries, "2026-11-06");
  const rows = ticketFoodRows(entries);
  it("ciclo aberto compara com os mesmos dias decorridos do anterior", () => {
    const p = performance(cycles, cycles.length - 1, rows, "2026-11-06", false)!;
    expect(p.window).toEqual({ from: "2026-10-27", to: "2026-11-05", days: 10 });
    expect(p.previous).toMatchObject({ from: "2026-09-25", to: "2026-10-04", ticket: 100, same_days: true });
  });
  it("ciclo incompleto fica fora da comparação automática", () => {
    expect(cycles[0].incomplete).toBe(true);
    expect(performance(cycles, 1, rows, "2026-11-06", false)!.unavailable_reason).toBe("previous_incomplete");
  });
  it("recarga não é consumo", () => {
    expect(totalsIn(rows, "2026-09-01", "2026-11-30").ticket).toBe(246);
  });
});

describe("Onde você mais gasta", () => {
  const rows = [row("2026-11-02", 280, "ticket", "Restaurante A"), row("2026-11-03", 140, "own", "RESTAURANTE A"), row("2026-11-04", 95, "ticket", "Restaurante B"), row("2026-11-05", 190, "own", "Restaurante B"), row("2026-10-05", 50, "own", "Restaurante B")];
  it("soma das fontes reconcilia e a ordenação muda com o filtro", () => {
    const all = merchantRanking(rows, { from: "2026-11-01", to: "2026-11-30" }, { from: "2026-10-01", to: "2026-10-31" });
    expect(all.map((m) => [m.label, m.ticket, m.own, m.total])).toEqual([["Restaurante A", 280, 140, 420], ["Restaurante B", 95, 190, 285]]);
    expect(all.reduce((a, m) => a + m.total, 0)).toBe(705);
    expect(all[1]).toMatchObject({ prev_total: 50, count: 2 });
    expect(merchantRanking(rows, { from: "2026-11-01", to: "2026-11-30" }, null, "own")[0].label).toBe("Restaurante B");
  });
  it("sem estabelecimento vira 'Não identificado'", () => {
    expect(merchantRanking([row("2026-11-02", 10, "own", null)], { from: "2026-11-01", to: "2026-11-30" }, null)[0].label).toBe("Não identificado");
  });
});

describe("Resumo: limite, margem, autonomia e projeção", () => {
  it("saldo 1.234,32, 30 dias, ritmo 32,36 → limite 41,14, margem 8,78, autonomia 38,14 e sobra 263,52; a 45/dia falta 115,68", () => {
    const state = { rate: { per_day: 32.36 }, day_start_balance: 1234.32, cycle: { days_left: 30 } } as unknown as BenefitState;
    expect(dailyKpis(state)).toMatchObject({ limit: 41.14, margin: 8.78, autonomy_days: 38.14, uncovered_days: 0 });
    expect(project(1234.32, 30, 32.36, "2026-11-27").leftover).toBe(263.52);
    expect(project(1234.32, 30, 45, "2026-11-27").shortfall).toBe(115.68);
  });
  it("estado real não quebra sem leitura", () => {
    const s = computeBenefitState({ id: "w", name: "T", monthly_credit: 1000, credit_day: 27, carries_over: true }, [], "2026-11-27");
    expect(dailyKpis(s)).toMatchObject({ rate: null, limit: null, autonomy_days: null });
  });
});

describe("Extrato", () => {
  const rows: StatementRow[] = [
    { id: "1", date: "2026-11-04", source: "ticket", kind: "purchase", merchant: "Hirota Food", amount: 14.46, editable: true },
    { id: "2", date: "2026-11-04", source: "own", kind: "purchase", merchant: "iFood", amount: 40, editable: false },
    { id: "3", date: "2026-10-27", source: "ticket", kind: "credit", merchant: null, amount: 1227.16, editable: true },
    { id: "4", date: "2026-11-11", source: "ticket", kind: "purchase", merchant: "Hirota Food", amount: 11.48, editable: true },
  ];
  it("filtros de quarta + fonte + estabelecimento; totais não somam recarga no consumo", () => {
    expect(filterStatement(rows, { weekday: 2, source: "ticket" }).map((r) => r.id)).toEqual(["4", "1"]);
    expect(filterStatement(rows, { merchantKey: merchantKey("HIROTA FOOD") }).map((r) => r.id)).toEqual(["4", "1"]);
    expect(filterStatement(rows, { search: "ifóod" }).map((r) => r.id)).toEqual(["2"]);
    expect(statementTotals(rows)).toEqual({ consumption: 65.94, purchases: 3, credits_total: 1227.16, credits: 1 });
  });
});
