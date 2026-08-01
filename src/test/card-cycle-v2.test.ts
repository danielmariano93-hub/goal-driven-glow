import { describe, expect, it } from "vitest";
import {
  computeCardExposure,
  cycleFor,
  openCycleOf,
  previousCycleOf,
} from "../lib/engine/cardExposure";

// Fixture real do Daniel: Cartão Itaú, closing_day=25, due_day=1.
const ITAU = { id: "card-itau", closing_day: 25, due_day: 1 };

describe("card_cycle.v2 — ciclo real por fechamento", () => {
  it("compra em 24/07 pertence ao ciclo que fecha em 25/07 e vence em 01/08", () => {
    const c = cycleFor(ITAU, "2026-07-24");
    expect(c.period_start).toBe("2026-06-26");
    expect(c.period_end).toBe("2026-07-25");
    expect(c.closing_date).toBe("2026-07-25");
    expect(c.due_date).toBe("2026-08-01");
    expect(c.competence).toBe("2026-08");
    expect(c.fallback).toBe(false);
  });

  it("compra no próprio dia do fechamento (25/07) ainda entra na fatura que fecha", () => {
    expect(cycleFor(ITAU, "2026-07-25").competence).toBe("2026-08");
  });

  it("compra em 26/07 cai no ciclo seguinte (fecha 25/08, vence 01/09)", () => {
    const c = cycleFor(ITAU, "2026-07-26");
    expect(c.period_start).toBe("2026-07-26");
    expect(c.period_end).toBe("2026-08-25");
    expect(c.due_date).toBe("2026-09-01");
    expect(c.competence).toBe("2026-09");
  });

  it("compra em 31/07 cai no mesmo ciclo de 26/07", () => {
    expect(cycleFor(ITAU, "2026-07-31").competence).toBe("2026-09");
  });

  it("respeita meses curtos: fechamento 31 em fevereiro", () => {
    const card = { id: "c", closing_day: 31, due_day: 10 };
    const c = cycleFor(card, "2026-02-15");
    expect(c.period_end).toBe("2026-02-28");
    expect(c.due_date).toBe("2026-03-10");
  });

  it("vencimento posterior ao fechamento no mesmo mês", () => {
    const card = { id: "c", closing_day: 5, due_day: 15 };
    const c = cycleFor(card, "2026-04-03");
    expect(c.closing_date).toBe("2026-04-05");
    expect(c.due_date).toBe("2026-04-15");
    expect(c.competence).toBe("2026-04");
  });

  it("virada de ano preservada", () => {
    const c = cycleFor(ITAU, "2026-12-30");
    expect(c.period_end).toBe("2027-01-25");
    expect(c.due_date).toBe("2027-02-01");
    expect(c.competence).toBe("2027-02");
  });

  it("sem closing_day válido cai no fallback de calendário", () => {
    const c = cycleFor({ id: "c" }, "2026-04-17");
    expect(c.fallback).toBe(true);
    expect(c.period_start).toBe("2026-04-01");
    expect(c.period_end).toBe("2026-04-30");
    expect(c.competence).toBe("2026-04");
  });

  it("ciclo anterior é contíguo, sem sobreposição nem furo", () => {
    const atual = openCycleOf(ITAU, "2026-08-01");
    const anterior = previousCycleOf(ITAU, atual);
    expect(anterior.period_end < atual.period_start).toBe(true);
    const dia = new Date(anterior.period_end + "T00:00:00Z");
    dia.setUTCDate(dia.getUTCDate() + 1);
    expect(dia.toISOString().slice(0, 10)).toBe(atual.period_start);
  });
});

describe("fatura em formação", () => {
  const txs = [
    // dentro do ciclo aberto (26/07 – 25/08)
    { credit_card_id: "card-itau", occurred_at: "2026-07-28", amount: 100, type: "expense", status: "confirmed" },
    { credit_card_id: "card-itau", occurred_at: "2026-08-01", amount: 50, type: "expense", status: "confirmed" },
    // estorno dentro do ciclo abate o parcial
    { credit_card_id: "card-itau", occurred_at: "2026-08-01", amount: 20, type: "income", status: "confirmed" },
    // fora do ciclo aberto (fatura anterior, já fechada)
    { credit_card_id: "card-itau", occurred_at: "2026-07-10", amount: 999, type: "expense", status: "confirmed" },
  ];

  it("soma apenas compras do ciclo em curso, por data da compra", () => {
    const exp = computeCardExposure({
      cardIds: ["card-itau"],
      statements: [],
      installments: [],
      txs: txs as never,
      currentYM: "2026-08",
      cards: [ITAU],
      todayISO: "2026-08-01",
    })["card-itau"];
    expect(exp.openCycle?.period_start).toBe("2026-07-26");
    expect(exp.formingStatement.amount).toBe(130);
    expect(exp.formingStatement.source).toBe("estimated");
    // fatura em formação nunca entra em dívida
    expect(exp.totalCardDebt).toBe(exp.currentStatement.amount);
  });

  it("sem configuração de ciclo, não há fatura em formação (compatibilidade)", () => {
    const exp = computeCardExposure({
      cardIds: ["card-itau"],
      statements: [],
      installments: [],
      txs: txs as never,
      currentYM: "2026-08",
    })["card-itau"];
    expect(exp.openCycle).toBeNull();
    expect(exp.formingStatement.amount).toBe(0);
  });

  it("fatura paga continua com obrigação zero mesmo com ciclo ativo", () => {
    const exp = computeCardExposure({
      cardIds: ["card-itau"],
      statements: [{
        credit_card_id: "card-itau", competence_month: "2026-08-01",
        stated_total: 4636.08, paid_amount: 4636.08, outstanding_amount: 0, status: "paid",
      }],
      installments: [],
      txs: txs as never,
      currentYM: "2026-08",
      cards: [ITAU],
      todayISO: "2026-08-01",
    })["card-itau"];
    expect(exp.currentStatement.amount).toBe(0);
    expect(exp.totalCardDebt).toBe(0);
    expect(exp.formingStatement.amount).toBe(130);
  });
});
