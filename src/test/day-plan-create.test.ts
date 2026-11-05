import { describe, expect, it } from "vitest";
import {
  goalRoomPerOccurrence, measurePlanSpend, nextOccurrence, occurrencesLeft, planSpanDays, suggestTarget, typicalForWeekday,
} from "@/lib/behavioral/dayPlanCreate";
import { resolvePlans, type DayPlanRow } from "@/lib/behavioral/dayPlan";

const tx = (day: string, amount: number, category = "lazer") => ({
  id: `${day}-${amount}`, occurred_at: `${day}T15:00:00Z`, category_id: category, type: "expense", status: "confirmed", amount, movement_kind: "transaction",
});
// 05/11/2026 é quinta-feira. Sextas anteriores: 30/10, 23/10, 16/10, 09/10, 02/10, 25/09, 18/09, 11/09.
const FRIDAYS = ["2026-10-30", "2026-10-23", "2026-10-16", "2026-10-09", "2026-10-02", "2026-09-25", "2026-09-18", "2026-09-11"];
const history = FRIDAYS.map((d) => tx(d, 272));
const TODAY = "2026-11-05";

describe("sugestão do teto do plano (day_plan_create.v1)", () => {
  it("corte grande pedido pela meta vira degrau no meio do caminho (caso real: padrão 272, meta pede 160 → 216)", () => {
    const s = suggestTarget({ typical: 272, goalRoom: 160 });
    expect(s.kind).toBe("goal_step");
    expect(s.target).toBe(216);
    expect(Math.round(s.cutPct * 100)).toBe(21);
  });
  it("corte de até 25% vai direto ao que a meta permite; se o padrão já cabe, mantém", () => {
    expect(suggestTarget({ typical: 200, goalRoom: 160 })).toMatchObject({ kind: "goal_direct", target: 160 });
    expect(suggestTarget({ typical: 200, goalRoom: 300 })).toMatchObject({ kind: "goal_fits", target: 200, cutPct: 0 });
  });
  it("sem meta: 10% abaixo do padrão; sem histórico: não inventa número", () => {
    expect(suggestTarget({ typical: 200, goalRoom: null })).toMatchObject({ kind: "average_cut", target: 180 });
    expect(suggestTarget({ typical: 0, goalRoom: null })).toMatchObject({ kind: "no_history", target: 0 });
  });
});

describe("datas e período do plano", () => {
  it("sexta cobre o fim de semana; os outros dias cobrem só o dia", () => {
    expect(planSpanDays(5)).toBe(3);
    expect(planSpanDays(3)).toBe(1);
  });
  it("próxima ocorrência do dia, hoje inclusive", () => {
    expect(nextOccurrence(TODAY, 5)).toBe("2026-11-06");
    expect(nextOccurrence(TODAY, 4)).toBe("2026-11-05");
    expect(nextOccurrence(TODAY, 3)).toBe("2026-11-11");
  });
  it("conta as ocorrências que restam no período", () => {
    expect(occurrencesLeft(TODAY, "2026-11-30", 5)).toBe(4);
  });
});

describe("padrão do dia e o que a meta permite", () => {
  it("padrão da sexta = média por fim de semana nas últimas 8 semanas (sex a dom)", () => {
    const withWeekend = [...history, tx("2026-10-31", 28), tx("2026-11-01", 0)];
    expect(typicalForWeekday(history as never, "lazer", 5, TODAY)).toBe(272);
    expect(typicalForWeekday(withWeekend as never, "lazer", 5, TODAY)).toBe(275.5);
  });
  it("outro dia da semana olha só aquele dia", () => {
    const wed = [tx("2026-11-04", 80), tx("2026-10-28", 40)];
    expect(typicalForWeekday(wed as never, "lazer", 3, TODAY, 2)).toBe(60);
  });
  it("parcela 2+ de compra antiga não conta como gasto do dia", () => {
    const later = { ...tx("2026-10-30", 500), credit_card_id: "c1", installments_total: 6, installment_number: 3 };
    expect(typicalForWeekday([later] as never, "lazer", 5, TODAY)).toBe(0);
  });
  it("o que a meta permite: o que sobra do teto, sem o gasto dos outros dias, dividido pelas sextas que restam", () => {
    const room = goalRoomPerOccurrence({ txs: history as never, categoryId: "lazer", weekday: 5, today: TODAY, periodEnd: "2026-11-30", remainingAmount: 640 });
    expect(room).toBe(160);
    expect(goalRoomPerOccurrence({ txs: history as never, categoryId: "lazer", weekday: 5, today: "2026-11-30", periodEnd: "2026-11-30", remainingAmount: 640 })).toBeNull();
  });
});

describe("medição do plano pelo app", () => {
  it("sexta mede sex a dom; só depois que o fim de semana termina", () => {
    const txs = [tx("2026-10-09", 120), tx("2026-10-10", 30), tx("2026-10-11", 19.58), tx("2026-10-12", 500)];
    expect(measurePlanSpend(txs as never, "lazer", "2026-10-09", "2026-10-12")).toBe(169.58);
    expect(measurePlanSpend(txs as never, "lazer", "2026-10-09", "2026-10-11")).toBeNull();
  });
  it("quarta mede só a quarta", () => {
    expect(measurePlanSpend([tx("2026-11-04", 90), tx("2026-11-05", 10)] as never, "lazer", "2026-11-04", "2026-11-05")).toBe(90);
  });
  it("resolvePlans fecha no app o plano aceito e terminado; o ainda em curso e o já fechado ficam como estão", () => {
    const base: DayPlanRow = { friday: "2026-11-04", category: "Lazer", status: "accepted", target_amount: 100, expected_amount: 200, realized_amount: null, accepted_at: "2026-11-03T10:00:00Z" };
    const ctx = { today: "2026-11-05", txs: [tx("2026-11-04", 90)] as never, categoryIdByName: { Lazer: "lazer" } };
    const [done] = resolvePlans([base], ctx);
    expect(done).toMatchObject({ status: "kept", realized_amount: 90, client_measured: true });
    const [over] = resolvePlans([{ ...base, target_amount: 50 }], ctx);
    expect(over).toMatchObject({ status: "missed", realized_amount: 90 });
    const [running] = resolvePlans([{ ...base, friday: "2026-11-05" }], ctx);
    expect(running.status).toBe("accepted");
    const [closed] = resolvePlans([{ ...base, status: "kept", realized_amount: 77 }], ctx);
    expect(closed.realized_amount).toBe(77);
  });
});
