import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSettlementConfirmationParts } from "../../supabase/functions/_shared/split/installmentSchedule";

const sql = readFileSync("supabase/migrations/20261028140000_split_settle_participant.sql", "utf8");
const row = (n: number, paid: boolean) => ({
  installment_id: `i${n}`, installment_number: n, total_installments: 3, amount: 100,
  paid_amount: paid ? 100 : 0, balance_due: paid ? 0 : 100, due_date: `2026-1${n}-05`,
  settlement_status: paid ? "paid" : "open", state: paid ? "paid" : "open",
}) as any;

describe("quitação antecipada do integrante", () => {
  it("baixa só para o dono, sem avisar a cada parcela e com lote desfazível", () => {
    expect(sql).toMatch(/split_settle_participant/);
    expect(sql).toMatch(/owner_user_id = uid/);
    expect(sql).toMatch(/p_notify boolean default true/);
    expect(sql).toMatch(/, false\);/);
    expect(sql).toMatch(/batch_id = pay\.batch_id/);
    expect(sql).toMatch(/revoke all on function public\.split_settle_participant/);
  });
  it("manda uma única confirmação de quitação, sem completed para os demais", () => {
    const enqueues = sql.match(/split_enqueue_installment_message\(/g) ?? [];
    expect(enqueues.length).toBe(2); // 1 no add (só se p_notify) + 1 na quitação
    expect(sql).toMatch(/v_all_paid AND p_notify/);
  });
  it("mensagem agradece, lista só as parcelas dele e diz que não há mais nada a pagar", () => {
    const m = buildSettlementConfirmationParts([row(1, true), row(2, true), row(3, true)], { title: "Réveillon", ownerName: "Daniel" })!;
    expect(m.headline).toMatch(/antecipado/);
    expect(m.headline).toMatch(/R\$\s?300,00/);
    expect(m.scheduleBlock).toMatch(/1\/3/);
    expect(m.closing).toMatch(/não precisa pagar mais nada/);
    expect(m.headline + m.scheduleBlock + m.closing).not.toMatch(/cart[ãa]o|d[ií]vida|conta|tia/i);
  });
  it("não usa a variante se ainda houver saldo", () => {
    expect(buildSettlementConfirmationParts([row(1, true), row(2, false)], { title: "x", ownerName: "y" })).toBeNull();
  });
});
