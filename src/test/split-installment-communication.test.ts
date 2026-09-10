import { describe, expect, it } from "vitest";
import {
  buildEqualInstallmentDrafts,
  buildInstallmentSchedule,
  formatCivilBR,
  installmentSentence,
  summarizeSchedule,
  type CanonicalReceivable,
} from "../../supabase/functions/_shared/split/installmentSchedule";
import { renderMessageTemplate } from "../../supabase/functions/_shared/agent/messageTemplates";
import { detectParticipantIntent } from "../../supabase/functions/_shared/split/participantPipeline";

function row(p: Partial<CanonicalReceivable> & { installment_number: number; amount: number }): CanonicalReceivable {
  return {
    installment_id: `i${p.installment_number}`,
    total_installments: 3,
    paid_amount: 0,
    balance_due: p.amount,
    due_date: null,
    settlement_status: "pending",
    ...p,
  } as CanonicalReceivable;
}

// Caso real de produção (shared_expense 457c02e5…): parte de R$ 280,00 em 3x.
const REAL: CanonicalReceivable[] = [
  row({ installment_number: 1, amount: 93.34, due_date: "2026-09-30" }),
  row({ installment_number: 2, amount: 93.33, due_date: "2026-10-30" }),
  row({ installment_number: 3, amount: 93.33, due_date: "2026-11-30" }),
];

function invite(schedule: CanonicalReceivable[], participantTotal: number) {
  const lines = buildInstallmentSchedule(schedule);
  const installments = schedule.length;
  const due = formatCivilBR(schedule[0]?.due_date);
  return renderMessageTemplate("invite", null, {
    participant_name: "Teste",
    owner_name: "Daniel",
    title: "Teste",
    participant_total: `R$ ${participantTotal.toFixed(2).replace(".", ",")}`,
    split_context_sentence: "",
    installments_sentence: installments > 1 ? `, em *${installments}x*` : "",
    first_due_sentence: installments > 1
      ? ` A primeira parcela vence em *${due}*.`
      : ` O vencimento é em *${due}*.`,
    installment_schedule: lines,
    installment_schedule_block: lines ? `\n\n${lines}` : "",
    pix_sentence: "",
    link_sentence: "",
  });
}

describe("Divisão do Rolê — comunicação do parcelamento", () => {
  it("A: convite 3x traz cada parcela com valor e vencimento exatos", () => {
    const msg = invite(REAL, 280);
    expect(msg).toContain("em *3x*");
    expect(msg).toContain("*1/3 — R$ 93,34* · vence em *30/09/2026*");
    expect(msg).toContain("*2/3 — R$ 93,33* · vence em *30/10/2026*");
    expect(msg).toContain("*3/3 — R$ 93,33* · vence em *30/11/2026*");
    expect(msg).toContain("R$ 280,00");
  });

  it("B: parcelas personalizadas aparecem literalmente", () => {
    const custom = [
      row({ installment_number: 1, amount: 100, due_date: "2026-10-10" }),
      row({ installment_number: 2, amount: 70, due_date: "2026-11-20" }),
      row({ installment_number: 3, amount: 110, due_date: "2027-01-05" }),
    ];
    const msg = invite(custom, 280);
    expect(msg).toContain("*1/3 — R$ 100,00* · vence em *10/10/2026*");
    expect(msg).toContain("*2/3 — R$ 70,00* · vence em *20/11/2026*");
    expect(msg).toContain("*3/3 — R$ 110,00* · vence em *05/01/2027*");
  });

  it("C: à vista não usa linguagem de parcelamento", () => {
    const single = [row({ installment_number: 1, amount: 280, total_installments: 1, due_date: "2026-09-30" })];
    const msg = invite(single, 280);
    expect(msg).toContain("O vencimento é em *30/09/2026*");
    expect(msg).not.toContain("x*");
    expect(msg).not.toContain("1/1");
    expect(msg).not.toContain("primeira parcela");
  });

  it("D: agenda com estado lista todas as parcelas", () => {
    const rows = [
      { ...REAL[0]!, paid_amount: 93.34, balance_due: 0, settlement_status: "paid" },
      { ...REAL[1]!, paid_amount: 40, balance_due: 53.33, settlement_status: "partial" },
      REAL[2]!,
    ];
    const schedule = buildInstallmentSchedule(rows, { withState: true });
    expect(schedule.split("\n")).toHaveLength(3);
    expect(schedule).toContain("· paga");
    expect(schedule).toContain("parcial, restam *R$ 53,33*");
  });

  it("E: próxima parcela em aberto ignora as pagas", () => {
    const rows = [{ ...REAL[0]!, paid_amount: 93.34, balance_due: 0, settlement_status: "paid" }, REAL[1]!, REAL[2]!];
    const next = summarizeSchedule(rows).next;
    expect(next?.installment_number).toBe(2);
    expect(installmentSentence(next!)).toBe("2/3 de R$ 93,33, com vencimento em 30/10/2026");
  });

  it("F: parcela paga não entra no saldo em aberto", () => {
    const rows = [{ ...REAL[0]!, paid_amount: 93.34, balance_due: 0, settlement_status: "paid" }, REAL[1]!, REAL[2]!];
    expect(summarizeSchedule(rows).pending_total).toBe(186.66);
  });

  it("G: pagamento parcial responde só o saldo restante", () => {
    const rows = [{ ...REAL[0]!, paid_amount: 40, balance_due: 53.34, settlement_status: "partial" }, REAL[1]!, REAL[2]!];
    expect(summarizeSchedule(rows).pending_total).toBe(240);
  });

  it("H: lembrete individual não repete a agenda", () => {
    const msg = renderMessageTemplate("reminder", null, {
      participant_name: "Teste",
      owner_name: "Daniel",
      title: "Teste",
      installment_label: "2ª parcela de 3",
      amount: "R$ 93,33",
      due_sentence: " O combinado é pagar até *30/10/2026*.",
      partial_sentence: "",
      remaining_sentence: "",
      pix_sentence: "",
      link_sentence: "",
    });
    expect(msg).toContain("2ª parcela de 3");
    expect(msg).not.toContain("1/3");
    expect(msg).not.toContain("3/3");
  });

  it("I: datas civis não deslocam o dia e parcelas iguais fecham o total", () => {
    const drafts = buildEqualInstallmentDrafts(280, 3, "2026-08-31");
    expect(drafts.map((d) => d.amount)).toEqual([93.34, 93.33, 93.33]);
    expect(drafts.map((d) => d.due_date)).toEqual(["2026-08-31", "2026-09-30", "2026-10-31"]);
    expect(formatCivilBR("2026-09-30")).toBe("30/09/2026");
  });

  it("participante: perguntas de parcela, próxima e mês são reconhecidas", () => {
    expect(detectParticipantIntent("quais parcelas?", false)).toBe("asking_schedule");
    expect(detectParticipantIntent("qual a próxima?", false)).toBe("asking_next");
    expect(detectParticipantIntent("quanto pago esse mês?", false)).toBe("asking_month");
    expect(detectParticipantIntent("quanto falta?", false)).toBe("asking_amount");
    expect(detectParticipantIntent("qual a chave pix?", false)).toBe("asking_pix");
    expect(detectParticipantIntent("já paguei", false)).toBe("payment_reported");
  });
});
