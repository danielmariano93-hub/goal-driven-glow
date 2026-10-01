import { describe, expect, it } from "vitest";
import {
  computeEmotionSpendAssociation, DEFAULT_EMOTION_SPEND_WINDOW, expenseInstant, pairExpensesToCheckins, timedExpensesFromRows,
} from "@/lib/engine/emotionSpendPairing";
import type { EmotionalCheckinRow } from "@/lib/engine/behaviorDimensions";

const H = 3_600_000;
const T0 = Date.parse("2026-09-01T12:00:00Z");
const NOW = T0 + 60 * 24 * H;
const at = (hours: number) => new Date(T0 + hours * H).toISOString();
const checkin = (id: string, hours: number, mood = 3, urge: number | null = null): EmotionalCheckinRow =>
  ({ id, occurred_at: at(hours), mood, spending_urge_score: urge });
const seed = { id: "seed", at: at(-100), amount: 1 }; // primeiro gasto observado, bem antes

describe("emotion_spend_pairing.v2 — janela de horário", () => {
  it("usa a janela padrão de 3h antes a 12h depois", () => {
    expect(DEFAULT_EMOTION_SPEND_WINDOW).toEqual({ beforeHours: 3, afterHours: 12 });
  });

  it("inclui as bordas exatas e exclui o que fica fora", () => {
    const pairs = pairExpensesToCheckins([checkin("c", 0)], [
      seed,
      { id: "edge-before", at: at(-3), amount: 10 },
      { id: "edge-after", at: at(12), amount: 20 },
      { id: "out-before", at: at(-3.01), amount: 99 },
      { id: "out-after", at: at(12.01), amount: 99 },
    ], { now: NOW });
    expect(pairs[0].spend).toBe(30);
    expect(pairs[0].txIds.sort()).toEqual(["edge-after", "edge-before"]);
  });

  it("associa cada gasto a no máximo um check-in (o mais próximo) e não duplica", () => {
    const pairs = pairExpensesToCheckins([checkin("a", 0), checkin("b", 6)], [
      seed,
      { id: "t1", at: at(1), amount: 100 },  // a=1h, b=5h → a
      { id: "t2", at: at(5), amount: 50 },   // a=5h, b=1h → b
    ], { now: NOW });
    const byId = Object.fromEntries(pairs.map((p) => [p.checkin.id, p]));
    expect(byId.a.txIds).toEqual(["t1"]);
    expect(byId.b.txIds).toEqual(["t2"]);
    const all = pairs.flatMap((p) => p.txIds);
    expect(new Set(all).size).toBe(all.length);
  });

  it("no empate prefere o check-in anterior ao gasto", () => {
    const pairs = pairExpensesToCheckins([checkin("before", 0), checkin("after", 4)], [seed, { id: "mid", at: at(2), amount: 40 }], { now: NOW });
    expect(pairs.find((p) => p.checkin.id === "before")!.txIds).toEqual(["mid"]);
    expect(pairs.find((p) => p.checkin.id === "after")!.txIds).toEqual([]);
  });

  it("ignora gasto duplicado (mesmo id) e check-in repetido", () => {
    const pairs = pairExpensesToCheckins([checkin("a", 0), checkin("a", 0)], [seed, { id: "x", at: at(1), amount: 10 }, { id: "x", at: at(1), amount: 10 }], { now: NOW });
    expect(pairs).toHaveLength(1);
    expect(pairs[0].spend).toBe(10);
  });

  it("não usa check-in com janela ainda aberta nem anterior ao primeiro gasto observado", () => {
    const pairs = pairExpensesToCheckins([checkin("open", 0), checkin("old", -500)], [{ id: "t", at: at(1), amount: 10 }, seed], { now: T0 + 2 * H });
    expect(pairs).toHaveLength(0);
  });

  it("check-in sem gasto na janela conta como observação de gasto zero", () => {
    const pairs = pairExpensesToCheckins([checkin("quiet", 0)], [seed], { now: NOW });
    expect(pairs[0]).toMatchObject({ spend: 0, txIds: [] });
  });

  it("só afirma associação com amostra mínima e nunca soma o mesmo gasto duas vezes", () => {
    const checkins: EmotionalCheckinRow[] = [];
    const expenses = [seed];
    for (let i = 0; i < 5; i++) {
      checkins.push(checkin(`s${i}`, i * 48, 1, 9));      // sensíveis
      expenses.push({ id: `es${i}`, at: at(i * 48 + 1), amount: 200 });
      checkins.push(checkin(`c${i}`, i * 48 + 24, 5, 1)); // tranquilos
      expenses.push({ id: `ec${i}`, at: at(i * 48 + 25), amount: 100 });
    }
    const assoc = computeEmotionSpendAssociation(checkins, expenses, { now: NOW });
    expect(assoc.sufficient).toBe(true);
    expect(assoc.vulnerableAverage).toBe(200);
    expect(assoc.comparisonAverage).toBe(100);
    expect(assoc.upliftPct).toBe(100);
    expect(assoc.pairedTransactions).toBe(10);
    const few = computeEmotionSpendAssociation(checkins.slice(0, 4), expenses, { now: NOW });
    expect(few.sufficient).toBe(false);
    expect(few.upliftPct).toBeNull();
  });
});

describe("expenseInstant — horário confiável do gasto", () => {
  it("usa captura automática, depois hora informada, depois hora do registro no mesmo dia", () => {
    expect(expenseInstant({ id: "1", amount: 1, occurred_at: "2026-09-10", local_occurred_at: "2026-09-10T22:15:00-03:00" }))
      .toEqual({ at: "2026-09-11T01:15:00.000Z", precision: "exact" });
    expect(expenseInstant({ id: "2", amount: 1, occurred_at: "2026-09-10", occurred_at_time: "08:30:00" }))
      .toEqual({ at: "2026-09-10T11:30:00.000Z", precision: "exact" });
    expect(expenseInstant({ id: "3", amount: 1, occurred_at: "2026-09-10", origin: "agent", created_at: "2026-09-10T20:00:00Z" }))
      .toEqual({ at: "2026-09-10T20:00:00.000Z", precision: "entry_time" });
  });

  it("descarta extrato bancário e registro retroativo (sem horário real)", () => {
    expect(expenseInstant({ id: "4", amount: 1, occurred_at: "2026-09-10", origin: "import", created_at: "2026-09-10T20:00:00Z" })).toBeNull();
    expect(expenseInstant({ id: "5", amount: 1, occurred_at: "2026-09-08", origin: "manual", created_at: "2026-09-10T20:00:00Z" })).toBeNull();
    expect(timedExpensesFromRows([{ id: "6", amount: 1, occurred_at: "2026-09-08", origin: "recurring" }])).toEqual([]);
  });
});
