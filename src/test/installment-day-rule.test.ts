import { describe, expect, it } from "vitest";
import { behavioralDayAmount, computeBehavioralExpense, computeDayLevelExpense, isLaterInstallment, type TransactionRow } from "@/lib/engine/facts";
import { computeDailyAverage } from "@/lib/engine/dailyAverage";
import { computeRhythm, type RhythmTx } from "@/lib/engine/spendingRhythm";
import { computeDailySpend } from "../../supabase/functions/_shared/analytics/timeseries";
import { computeForecast } from "../../supabase/functions/_shared/analytics/forecast";
import { loadNudgeTransactions } from "../../supabase/functions/_shared/proactive/profileLoaders";

// `installment_day_rule.v1` — cada parcela guarda occurred_at = dia da compra. Compra de R$ 3.000 em 6x no dia 05:
// 6 linhas de R$ 500 no dia 05. Para indicador de dia/ritmo/projeção vale a 1ª parcela (R$ 500); as demais entram pela fatura.
let n = 0;
const tx = (over: Partial<TransactionRow> = {}): TransactionRow => ({
  id: `t${++n}`, account_id: "a", category_id: "c", type: "expense", status: "confirmed", amount: 100, occurred_at: "2026-11-05",
  description: "x", merchant_name: "x", transfer_group_id: null, movement_kind: "transaction", payment_method: "account", ...over,
} as TransactionRow);
const parcelas = Array.from({ length: 6 }, (_, i) => tx({
  amount: 500, payment_method: "credit_card", credit_card_id: "cc", installment_number: i + 1, installments_total: 6, purchase_group_id: "g",
  competence_date: `2026-${String(11 + i > 12 ? 11 + i - 12 : 11 + i).padStart(2, "0")}-01`,
}));
const vista = tx({ amount: 80, occurred_at: "2026-11-06" });
const all = [...parcelas, vista];
const range = { start: "2026-11-01", end: "2026-11-30" };

describe("parcela 2+ não é gasto de nenhum dia", () => {
  it("reconhece só parcela 2+ de cartão parcelado", () => {
    expect(parcelas.map(isLaterInstallment)).toEqual([false, true, true, true, true, true]);
    expect(isLaterInstallment(vista)).toBe(false);
    expect(isLaterInstallment(tx({ payment_method: "credit_card", installment_number: 1, installments_total: 1 }))).toBe(false);
    expect(isLaterInstallment(tx({ payment_method: "account", installment_number: 3, installments_total: 6 }))).toBe(false);
  });
  it("estorno de parcela nunca é zerado", () => {
    const refund = tx({ type: "income", movement_kind: "refund", amount: 500, payment_method: "credit_card", credit_card_id: "cc", installment_number: 2, installments_total: 6 });
    expect(behavioralDayAmount(refund, "expense")).toBe(-500);
  });
  it("gasto do dia/do mês: 1ª parcela + à vista (R$ 580), não a compra inteira (R$ 3.080)", () => {
    expect(computeDayLevelExpense(all, range)).toBe(580);
    expect(computeBehavioralExpense(all, range)).toBe(3080); // conciliação caixa × resultado segue na regra de compra inteira
  });
  it("média diária usa a regra", () => {
    expect(computeDailyAverage(all, { start: "2026-11-01", end: "2026-11-10" }).total).toBe(580);
  });
  it("ritmo (típico) usa a regra", () => {
    const r = computeRhythm(all as unknown as RhythmTx[], { start: "2026-11-01", end: "2026-11-10" }, { categoryNameById: {} });
    expect(r.totalGross).toBe(580);
  });
  it("série diária: o dia da compra mostra a 1ª parcela", () => {
    const d = computeDailySpend({ txs: all, from: "2026-11-01", to: "2026-11-10" });
    expect(d.total).toBe(580);
    expect(d.daily[4]).toBe(500);
  });
  it("previsão do agente: realizado do mês não inclui parcelas futuras", () => {
    const f = computeForecast({ txs: all, today: "2026-11-10" } as never);
    expect(f.drivers.mtd_expense).toBeCloseTo(580, 2);
  });
});

describe("mensagens proativas: fim de semana e dia da semana", () => {
  it("o carregador das previsões descarta parcela 2+ (compra parcelada no sábado não vira R$ 3.000 de fim de semana)", async () => {
    const rows = [
      ...parcelas.map((p) => ({ occurred_at: "2026-11-07", amount: p.amount, category_id: "lazer", movement_kind: "transaction", payment_method: "credit_card", credit_card_id: "cc", installment_number: p.installment_number, installments_total: 6 })),
      { occurred_at: "2026-11-07", amount: 40, category_id: "lazer", movement_kind: "transaction", payment_method: "account", credit_card_id: null, installment_number: null, installments_total: null },
    ];
    const sb: any = {
      from: (table: string) => ({
        select: () => {
          const out: any = { eq: () => out, gte: () => out, lt: () => out, or: () => out, order: () => out, limit: () => out };
          out.then = (ok: (v: unknown) => unknown) => ok(table === "categories" ? { data: [{ id: "lazer", name: "Lazer" }] } : { data: rows });
          return out;
        },
      }),
    };
    const out = await loadNudgeTransactions(sb, "u", "2026-11-10");
    expect(out.map((r) => r.amount)).toEqual([500, 40]);
  });
});
