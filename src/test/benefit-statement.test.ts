import { describe, expect, it } from "vitest";
import { inferStatementDate, markKnownEntries, parseBenefitStatement } from "@/lib/engine/benefitStatement";
import type { BenefitEntry } from "@/lib/engine/benefitWallet";

const TODAY = "2026-11-03";

// Linhas como o modelo as devolve para os prints reais do extrato (DD/MM, HH:MM).
const MODEL_OUTPUT = {
  k: "extrato",
  i: [
    ["gasto", "02/11", "12:58", 38.88, "CASA DO PASTEL SIMOES LTDA"],
    ["gasto", "30/10", "21:05", 11.97, "SOUK4U"],
    ["gasto", "30/10", "12:53", 26.0, "ESQUINA BARAO"],
    ["gasto", "29/10", "13:18", 11.48, "HIROTA FOOD EXPRESS ITAU JABAQUARA"],
    ["gasto", "27/10", "12:40", 34.51, "HORIZONTE"],
    ["credito", "27/10", "00:26", "1.227,16", null],
  ],
};

describe("leitura do extrato do Ticket — validação determinística", () => {
  it("converte as linhas do print em candidatos com ano inferido", () => {
    const { items, discarded } = parseBenefitStatement(MODEL_OUTPUT, TODAY);
    expect(discarded).toBe(0);
    expect(items).toHaveLength(6);
    expect(items[0]).toEqual({ kind: "spend", amount: 38.88, occurred_on: "2026-11-02", time: "12:58", merchant: "CASA DO PASTEL SIMOES LTDA" });
    expect(items[5]).toEqual({ kind: "credit", amount: 1227.16, occurred_on: "2026-10-27", time: "00:26", merchant: null });
  });

  it("ano: dezembro lido em janeiro é do ano anterior; data futura e inexistente são descartadas", () => {
    expect(inferStatementDate(28, 12, "2027-01-05")).toBe("2026-12-28");
    expect(inferStatementDate(5, 11, TODAY)).toBe("2025-11-05"); // 05/11 ainda não chegou este ano
    // ...mas um extrato de Ticket não vai tão longe: a linha é descartada em vez de virar lançamento antigo.
    expect(parseBenefitStatement({ i: [["gasto", "05/11", null, 10, "X"]] }, TODAY)).toEqual({ items: [], discarded: 1 });
    expect(inferStatementDate(31, 2, TODAY)).toBeNull();
    expect(inferStatementDate(10, 13, TODAY)).toBeNull();
  });

  it("descarta valor zero/negativo, tipo desconhecido, linha torta e conta a mesma linha lida duas vezes uma só", () => {
    const out = parseBenefitStatement({ i: [
      ["gasto", "02/11", "12:58", -5, "X"], ["gasto", "02/11", null, 0, "X"], ["estorno", "02/11", null, 5, "X"],
      "texto solto", ["gasto", "02/11", null, 9.9, "PADARIA"], ["gasto", "02/11", null, 9.9, "padaria"],
    ] }, TODAY);
    expect(out.items).toHaveLength(1);
    expect(out.discarded).toBe(4);
  });

  it("não quebra com resposta fora do formato", () => {
    for (const raw of [null, {}, { i: "x" }, { k: "outro", i: [] }]) {
      expect(parseBenefitStatement(raw, TODAY)).toEqual({ items: [], discarded: 0 });
    }
  });
});

describe("markKnownEntries — não lança duas vezes o que já está no Ticket", () => {
  let n = 0;
  const e = (kind: BenefitEntry["kind"], amount: number, occurred_on: string, merchant: string | null, note: string | null = null) =>
    ({ id: `e${++n}`, kind, amount, occurred_on, merchant, note });

  it("reconhece o que já foi lançado (mesmo tipo, dia, valor e estabelecimento, sem ligar para caixa alta)", () => {
    const { items } = parseBenefitStatement(MODEL_OUTPUT, TODAY);
    const existing = [
      e("spend", 38.88, "2026-11-02", "Casa do Pastel Simoes Ltda", "12:58"),
      e("credit", 1227.16, "2026-10-27", null),
      e("balance_reading", 825.33, "2026-11-03", null),
    ];
    const marked = markKnownEntries(items, existing);
    expect(marked.map((c) => c.already_recorded)).toEqual([true, false, false, false, false, true]);
  });

  it("hora diferente na mesma data e valor é outra compra", () => {
    const { items } = parseBenefitStatement({ i: [["gasto", "29/10", "08:11", 16.46, "HIROTA"]] }, TODAY);
    expect(markKnownEntries(items, [e("spend", 16.46, "2026-10-29", "HIROTA", "13:18")])[0].already_recorded).toBe(false);
  });

  it("um lançamento existente absorve só uma linha do print (duas compras iguais são duas)", () => {
    const { items } = parseBenefitStatement({ i: [["gasto", "29/10", null, 11.48, "HIROTA"], ["gasto", "29/10", "13:18", 11.48, "HIROTA"]] }, TODAY);
    const marked = markKnownEntries(items, [e("spend", 11.48, "2026-10-29", "HIROTA")]);
    expect(marked.filter((c) => c.already_recorded)).toHaveLength(1);
  });
});
