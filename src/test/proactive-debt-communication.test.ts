import { describe, expect, it } from "vitest";
import {
  civilDateBR,
  dueWording,
  isOverdue,
  mapDebtObligationRow,
  shouldAlert,
} from "../../supabase/functions/_shared/proactive/debtObligations.ts";
import { settledObligations, mentionsDebt } from "../../supabase/functions/_shared/proactive/debtReconciliation.ts";
import {
  applyMessageContract,
  renderWhatsappMessage,
} from "../../supabase/functions/_shared/agent/core/MessageContract.ts";

const row = (over: Record<string, unknown> = {}) => mapDebtObligationRow({
  debt_id: "d1",
  name: "Banco Pan",
  installment_amount: 74.54,
  outstanding: 500,
  situation: "em_dia",
  current_cycle_status: "pending",
  current_cycle_due_date: "2026-10-10",
  next_due_date: "2026-10-10",
  days_to_due: 5,
  days_overdue: 0,
  overdue_amount: 0,
  overdue_installments: 0,
  formula_version: "debt_obligation.v1",
  ...over,
});

describe("debt_obligation_truth.v1 — fonte canônica", () => {
  it("A) ciclo pago não gera alerta nenhum", () => {
    const paid = row({ current_cycle_status: "paid", current_cycle_paid_at: "2026-08-22" });
    expect(shouldAlert(paid)).toBe(false);
    expect(isOverdue(paid)).toBe(false);
  });

  it("B) vencimento hoje não é atraso", () => {
    const today = row({ days_to_due: 0 });
    expect(isOverdue(today)).toBe(false);
    expect(shouldAlert(today)).toBe(true);
    expect(dueWording(today.days_until)).toBe("vence hoje");
  });

  it("C) atraso é afirmação da fonte, não dedução", () => {
    const late = row({ situation: "em_atraso", days_overdue: 3, overdue_amount: 74.54 });
    expect(isOverdue(late)).toBe(true);
    expect(late.days_until).toBe(-3);
    expect(dueWording(late.days_until)).toBe("está 3 dias em atraso");
  });

  it("D) linguagem de prazo sem 'dia(s)' cru", () => {
    expect(dueWording(1)).toBe("vence amanhã");
    expect(dueWording(4)).toBe("vence em 4 dias");
    expect(dueWording(null)).toBe("com vencimento a definir");
    expect(civilDateBR("2026-10-10")).toBe("10/10");
  });

  it("E) ciclo pago fora da janela não entra por proximidade", () => {
    expect(shouldAlert(row({ current_cycle_status: "paid", days_to_due: 2 }))).toBe(false);
    expect(shouldAlert(row({ days_to_due: 30 }))).toBe(false);
  });

  it("F) reconciliação seleciona só ciclos pagos e casa id aninhado", () => {
    const settled = settledObligations([
      row({ current_cycle_status: "paid" }),
      row({ debt_id: "d2", situation: "em_atraso", days_overdue: 2 }),
    ]);
    expect(settled.map((o) => o.debt_id)).toEqual(["d1"]);
    expect(mentionsDebt({ debt: { id: "d1" } }, new Set(["d1"]))).toBe(true);
    expect(mentionsDebt({ debt: { id: "dX" } }, new Set(["d1"]))).toBe(false);
  });
});

describe("comm_contract.v1 — composição da mensagem", () => {
  it("G) não repete o mesmo fato no corpo", () => {
    const out = applyMessageContract(
      "A parcela do Banco Pan vence hoje",
      "A parcela do Banco Pan vence hoje.\n\nSão R$ 74,54 no vencimento de hoje.",
    );
    expect(out.body).not.toMatch(/Banco Pan vence hoje\./);
    expect(out.body).toContain("R$ 74,54");
    expect(out.guards.some((g) => g.startsWith("duplicate_fact_removed"))).toBe(true);
  });

  it("H) só uma pergunta por mensagem", () => {
    const out = applyMessageContract("Fatura acelerando", "Quer revisar agora? Prefere ver depois?");
    expect((out.body.match(/\?/g) ?? []).length).toBe(1);
    expect(out.guards.some((g) => g.startsWith("extra_cta_removed"))).toBe(true);
  });

  it("I) marcador técnico nunca chega ao usuário", () => {
    const out = applyMessageContract("{{title}} Dívida", "Valor null da dívida 123e4567-e89b-12d3-a456-426614174000.");
    expect(out.body).not.toMatch(/null|\{\{|[0-9a-f]{8}-/i);
    expect(out.guards).toContain("technical_marker_stripped");
  });

  it("J) WhatsApp tem um único renderizador determinístico", () => {
    const { message } = renderWhatsappMessage(
      "A parcela do Banco Pan vence hoje",
      "São R$ 74,54.\n\nQuer que eu registre o pagamento?",
    );
    expect(message.split("\n\n")[0]).toBe("*A parcela do Banco Pan vence hoje*");
    expect(message).toContain("*Quer que eu registre o pagamento?*");
    expect(message.length).toBeLessThan(1800);
  });
});
