import { describe, it, expect } from "vitest";
import { renderMessageTemplate, type MessagePersona } from "../../supabase/functions/_shared/agent/messageTemplates";

// Espelha o helper usado dentro da edge function split-reminders-dispatch-v2
// (`messageFor`). Contrato atual: a cobrança fala de UMA parcela e do SALDO
// real dela; o contexto do rolê (total e nº de pessoas) só aparece no convite.
function formatBRL(v: number): string {
  return `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
}

function render(kind: string, opts: {
  participant_name?: string;
  owner_name?: string;
  title?: string;
  remaining: number;
  participantTotal?: number;
  participantsCount: number;
  totalAmount: number;
  due_date?: string | null;
  paidOnInstallment?: number;
  participantRemaining?: number;
  installmentNumber?: number;
  totalInstallments?: number;
  pix_key?: string;
  link_sentence?: string;
  persona?: MessagePersona;
}) {
  const amount = formatBRL(opts.remaining);
  const showContext = opts.participantsCount > 0 && opts.totalAmount > 0;
  const splitContextSentence = showContext
    ? ` (total do rolê: ${formatBRL(opts.totalAmount)}, dividido entre ${opts.participantsCount} ${opts.participantsCount === 1 ? "pessoa" : "pessoas"})`
    : "";
  const installments = opts.totalInstallments ?? 1;
  const paid = opts.paidOnInstallment ?? 0;
  const participantRemaining = opts.participantRemaining ?? opts.remaining;
  return renderMessageTemplate(kind, opts.persona ?? null, {
    participant_name: opts.participant_name ?? "tudo bem",
    owner_name: opts.owner_name ?? "A pessoa responsável pelo rolê",
    title: opts.title ?? "seu rolê",
    amount,
    total_amount: formatBRL(opts.totalAmount),
    participant_total: formatBRL(opts.participantTotal ?? opts.remaining),
    participants_count: String(opts.participantsCount),
    split_context_sentence: splitContextSentence,
    installment_label: installments > 1
      ? `${opts.installmentNumber ?? 1}ª parcela de ${installments}`
      : "parte do rolê",
    installments_sentence: installments > 1 ? `, em *${installments}x*` : "",
    first_due_sentence: opts.due_date ? ` A primeira parcela vence em *${opts.due_date}*.` : "",
    partial_sentence: paid > 0
      ? `\n\n💰 *Pagamento parcial:* já foram pagos *${formatBRL(paid)}*. Restam *${amount}*.`
      : "",
    remaining_sentence: participantRemaining > opts.remaining
      ? `\n\nTotal ainda a receber de você: *${formatBRL(participantRemaining)}*.`
      : "",
    due_date: opts.due_date ?? "",
    due_sentence: opts.due_date ? ` O combinado é pagar até *${opts.due_date}*.` : "",
    pix_key: opts.pix_key ?? "",
    pix_sentence: opts.pix_key ? `\n\nPix: ${opts.pix_key}` : "",
    link_sentence: opts.link_sentence ?? "",
  });
}

describe("Mensagem da Divisão do Rolê — parcela e contexto", () => {
  it("convite: total do rolê, pessoas e a parte da pessoa", () => {
    const msg = render("invite", {
      participant_name: "Ana",
      owner_name: "Bruno",
      title: "Churrasco",
      remaining: 60,
      participantsCount: 2,
      totalAmount: 120,
    });
    expect(msg).toContain("Bruno incluiu você");
    expect(msg).toContain("Churrasco");
    expect(msg).toContain("total do rolê: R$ 120,00");
    expect(msg).toContain("dividido entre 2 pessoas");
    expect(msg).toContain("R$ 60,00");
  });

  it("convite parcelado avisa o número de parcelas e o primeiro vencimento", () => {
    const msg = render("invite", {
      remaining: 300,
      participantTotal: 300,
      participantsCount: 3,
      totalAmount: 900,
      totalInstallments: 3,
      due_date: "10/10/2026",
    });
    expect(msg).toContain("em *3x*");
    expect(msg).toContain("A primeira parcela vence em *10/10/2026*");
  });

  it("convite usa singular quando há uma pessoa", () => {
    const msg = render("invite", {
      remaining: 30,
      participantsCount: 1,
      totalAmount: 30,
      title: "Farmácia",
    });
    expect(msg).toContain("dividido entre 1 pessoa");
    expect(msg).not.toContain("1 pessoas");
  });

  it("cobrança fala da parcela e do saldo, nunca do valor cheio", () => {
    const msg = render("reminder", {
      participant_name: "Carla",
      title: "Viagem",
      remaining: 45,
      paidOnInstallment: 30,
      participantRemaining: 195,
      installmentNumber: 2,
      totalInstallments: 3,
      participantsCount: 5,
      totalAmount: 375,
    });
    expect(msg).toContain("2ª parcela de 3");
    expect(msg).toContain("R$ 45,00");
    expect(msg).toContain("já foram pagos *R$ 30,00*");
    expect(msg).toContain("Total ainda a receber de você: *R$ 195,00*");
    expect(msg).not.toContain("dividido entre");
  });

  it("vencimento próximo mostra a data da parcela", () => {
    const msg = render("due_soon", {
      remaining: 100,
      installmentNumber: 1,
      totalInstallments: 3,
      participantsCount: 3,
      totalAmount: 300,
      due_date: "31/07/2026",
    });
    expect(msg).toContain("vence em *31/07/2026*");
    expect(msg).toContain("1ª parcela de 3");
  });

  it("atraso é empático, específico e traz o Pix", () => {
    const msg = render("overdue", {
      remaining: 50,
      participantsCount: 4,
      totalAmount: 200,
      due_date: "01/07/2026",
      pix_key: "user@meunino.com.br",
    });
    expect(msg).toContain("ainda consta como pendente");
    expect(msg).toContain("01/07/2026");
    expect(msg).toContain("Pix: user@meunino.com.br");
  });

  it("mensagens terminais não repetem o contexto do rolê", () => {
    const paid = render("payment_confirmation", {
      remaining: 0,
      participantsCount: 3,
      totalAmount: 300,
      title: "Jantar",
    });
    expect(paid).toContain("Pagamento registrado");
    expect(paid).not.toContain("dividido entre");

    const done = render("completed", {
      remaining: 0,
      participantsCount: 3,
      totalAmount: 300,
      title: "Jantar",
    });
    expect(done).toContain("Rolê fechado");
    expect(done).not.toContain("dividido entre");
  });

  it("omite o contexto quando não há total nem pessoas (defensivo)", () => {
    const msg = render("invite", {
      remaining: 0,
      participantsCount: 0,
      totalAmount: 0,
      title: "vazio",
    });
    expect(msg).not.toContain("dividido entre");
    expect(msg).not.toContain("total do rolê");
  });

  it("template configurado no admin continua valendo", () => {
    const persona: MessagePersona = {
      contexts: {
        split_invite: {
          template: "Rolê: {{title}} — {{amount}}{{split_context_sentence}}",
        },
      },
    };
    const msg = render("invite", {
      remaining: 10,
      participantsCount: 2,
      totalAmount: 20,
      title: "Café",
      persona,
    });
    expect(msg.startsWith("Rolê: Café — R$ 10,00")).toBe(true);
    expect(msg).toContain("dividido entre 2 pessoas");
  });
});
