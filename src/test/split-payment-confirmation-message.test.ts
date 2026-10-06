import { describe, expect, it } from "vitest";
import {
  buildPaymentConfirmationParts,
  type CanonicalReceivable,
} from "../../supabase/functions/_shared/split/installmentSchedule";
import { renderMessageTemplate } from "../../supabase/functions/_shared/agent/messageTemplates";

const nb = (s: string) => s.replace(/ /g, " ");
const row = (n: number, total: number, amount: number, due: string, paid = 0): CanonicalReceivable => ({
  installment_id: `i${n}`, installment_number: n, total_installments: total, amount,
  paid_amount: paid, balance_due: Math.max(0, amount - paid), due_date: due,
  settlement_status: paid >= amount ? "paid" : paid > 0 ? "partial" : "pending",
});

function render(rows: CanonicalReceivable[], paidId: string) {
  const parts = buildPaymentConfirmationParts(rows, paidId, { title: "Divisão Carro RJ", ownerName: "Daniel" })!;
  return nb(renderMessageTemplate("payment_confirmation", null, {
    participant_name: "Thales",
    confirmation_headline: parts.headline,
    confirmation_schedule_block: parts.scheduleBlock,
    confirmation_closing: parts.closing,
  }));
}

describe("confirmação de pagamento do rolê", () => {
  it("caso real: 1ª de 2 parcelas paga — mostra a agenda e o que falta", () => {
    const text = render([row(1, 2, 116.12, "2026-10-07", 116.12), row(2, 2, 116.12, "2026-11-07")], "i1");
    expect(text).toContain("✅ *Pagamento recebido!*");
    expect(text).toContain("Oi, Thales!");
    expect(text).toContain("*1ª parcela (R$ 116,12)*");
    expect(text).toContain("com Daniel");
    expect(text).toContain("✅ 1/2 — R$ 116,12 — paga");
    expect(text).toContain("⏳ 2/2 — R$ 116,12 — vence em *07/11/2026*");
    expect(text).toContain("Falta *R$ 116,12* no total; a próxima parcela vence em *07/11/2026*.");
  });

  it("não promete lembrete nem fala de atraso", () => {
    const text = render([row(1, 2, 100, "2026-09-01", 100), row(2, 2, 100, "2026-10-01")], "i1");
    expect(text).not.toMatch(/lembr|atras/i);
  });

  it("pagamento parcial de uma parcela", () => {
    const text = render([row(1, 3, 100, "2026-10-07", 40), row(2, 3, 100, "2026-11-07"), row(3, 3, 100, "2026-12-07")], "i1");
    expect(text).toContain("já foram pagos *R$ 40,00* e restam *R$ 60,00*");
    expect(text).toContain("⏳ 1/3 — R$ 100,00 — restam *R$ 60,00*, vence em *07/10/2026*");
    expect(text).toContain("Falta *R$ 260,00* no total");
  });

  it("última parcela: fecha a divisão", () => {
    const text = render([row(1, 2, 50, "2026-10-07", 50), row(2, 2, 50, "2026-11-07", 50)], "i2");
    expect(text).toContain("Essa foi a última parcela");
    expect(text).not.toContain("Falta");
  });

  it("parcela única paga", () => {
    const text = render([row(1, 1, 80, "2026-10-07", 80)], "i1");
    expect(text).toContain("pagamento da sua parte (*R$ 80,00*)");
    expect(text).toContain("Você está em dia");
    expect(text).not.toContain("Como está sua divisão");
  });

  it("sem parcelas conhecidas, devolve null (o dispatcher usa o texto simples)", () => {
    expect(buildPaymentConfirmationParts([], "i1", { title: "x", ownerName: "y" })).toBeNull();
    expect(buildPaymentConfirmationParts([row(1, 2, 10, "2026-10-07")], "outra", { title: "x", ownerName: "y" })).toBeNull();
  });

  it("o dispatcher carrega a agenda também para a confirmação", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("supabase/functions/split-reminders-dispatch-v2/index.ts", "utf8");
    expect(src).toContain('kind === "invite" || kind === "payment_confirmation"');
    expect(src).toContain("buildPaymentConfirmationParts");
  });
});
