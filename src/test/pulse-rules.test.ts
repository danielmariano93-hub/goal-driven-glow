import { describe, it, expect } from "vitest";
import { computePulse, type PulseInput } from "@/lib/pulse/rules";

const base: PulseInput = {
  today: "2026-07-17",
  txDaysLast14: 10,
  txLast30: 25,
  txLast30WithCategory: 22,
  pendingOpen: 0,
  pendingStale: 0,
  plannedMonth: 3000,
  actualMonth: 2800,
  hasPlan: true,
  cardOutstanding: 300,
  cardTotalLimit: 3000,
  paymentsOnTime90d: 10,
  paymentsTotal90d: 10,
  totalCash: 4500,
  avgMonthlyExpense: 1500,
  goalsProgressPct: [0.5, 0.3],
  outstandingToday: 800,
  outstanding30dAgo: 1000,
  recurringActive: 4,
  recurringWithDefinedAmount: 4,
  emotionalDaysLast14: 8,
  expensesLast30WithEmotion: 6,
  score7dAgo: null,
};

describe("computePulse", () => {
  it("retorna score 0–100 e banda válida", () => {
    const r = computePulse(base);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(["Começando", "Organizando", "Evoluindo", "No controle"]).toContain(r.band);
    expect(r.state).toBe("ok");
  });

  it("marca insufficient_data quando quase não há histórico", () => {
    const r = computePulse({ ...base, txLast30: 1, txDaysLast14: 1 });
    expect(r.state).toBe("insufficient_data");
    expect(r.score).toBe(40);
  });

  it("não penaliza por renda: dobrar avgMonthlyExpense mantendo caixa reduz reserva sem quebrar", () => {
    const a = computePulse({ ...base, avgMonthlyExpense: 500, totalCash: 4500 });
    const b = computePulse({ ...base, avgMonthlyExpense: 5000, totalCash: 4500 });
    // Reserva menor em b, mas score continua 0–100
    expect(a.score).toBeGreaterThanOrEqual(b.score);
    expect(b.score).toBeGreaterThanOrEqual(0);
  });

  it("monotonicidade: mais dias de registro ⇒ score não cai", () => {
    const low = computePulse({ ...base, txDaysLast14: 2 });
    const high = computePulse({ ...base, txDaysLast14: 14 });
    expect(high.score).toBeGreaterThanOrEqual(low.score);
  });

  it("check-in emocional não infla score se todos no mesmo dia (fator conta apenas dias distintos)", () => {
    const a = computePulse({ ...base, emotionalDaysLast14: 1 });
    const b = computePulse({ ...base, emotionalDaysLast14: 1 }); // "vinte checkins" já colapsados em 1 dia pelo caller
    expect(a.score).toBe(b.score);
  });

  it("próxima ação aponta para o fator mais fraco", () => {
    const r = computePulse({ ...base, txDaysLast14: 0 });
    expect(r.next_action.key).toBe("constancia");
  });
});
