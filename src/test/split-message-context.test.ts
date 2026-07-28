import { describe, it, expect } from "vitest";
import { renderMessageTemplate, type MessagePersona } from "../../supabase/functions/_shared/agent/messageTemplates";

// Reproduces the helper used inside the split-reminders-dispatch edge function
// (see supabase/functions/split-reminders-dispatch/index.ts::messageFor).
// Duplicated here as a pure function so the render pipeline is testable in
// Vitest without lifting the Deno-only edge function.
function formatBRL(v: number): string {
  return `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`;
}

function render(kind: string, opts: {
  participant_name?: string;
  owner_name?: string;
  title?: string;
  remaining: number;
  participantsCount: number;
  totalAmount: number;
  due_date?: string | null;
  pix_key?: string;
  link_sentence?: string;
  persona?: MessagePersona;
}) {
  const amount = formatBRL(opts.remaining);
  const showContext = opts.participantsCount > 0 && opts.totalAmount > 0;
  const splitContextSentence = showContext
    ? ` (total do rolê: ${formatBRL(opts.totalAmount)}, dividido entre ${opts.participantsCount} ${opts.participantsCount === 1 ? "pessoa" : "pessoas"})`
    : "";
  return renderMessageTemplate(kind, opts.persona ?? null, {
    participant_name: opts.participant_name ?? "tudo bem",
    owner_name: opts.owner_name ?? "A pessoa responsável pelo rolê",
    title: opts.title ?? "seu rolê",
    amount,
    total_amount: formatBRL(opts.totalAmount),
    participants_count: String(opts.participantsCount),
    split_context_sentence: splitContextSentence,
    due_date: opts.due_date ?? "",
    due_sentence: opts.due_date ? ` O combinado é pagar até ${opts.due_date}.` : "",
    pix_key: opts.pix_key ?? "",
    pix_sentence: opts.pix_key ? ` Pix: ${opts.pix_key}.` : "",
    link_sentence: opts.link_sentence ?? "",
  });
}

describe("Split reminder message — context sentence", () => {
  it("invite: includes total do rolê and participants plural with N=2", () => {
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

  it("invite: uses singular when participantsCount is 1", () => {
    const msg = render("invite", {
      remaining: 30,
      participantsCount: 1,
      totalAmount: 30,
      title: "Farmácia",
    });
    expect(msg).toContain("dividido entre 1 pessoa");
    expect(msg).not.toContain("1 pessoas");
  });

  it("reminder N=5 with partial payment shows remaining, not total per person", () => {
    const msg = render("reminder", {
      participant_name: "Carla",
      title: "Viagem",
      remaining: 45,           // paid 30 of 75 due
      participantsCount: 5,
      totalAmount: 375,
    });
    expect(msg).toContain("faltam R$ 45,00");
    expect(msg).toContain("dividido entre 5 pessoas");
    expect(msg).toContain("total do rolê: R$ 375,00");
  });

  it("due_soon includes due sentence and split context", () => {
    const msg = render("due_soon", {
      remaining: 100,
      participantsCount: 3,
      totalAmount: 300,
      due_date: "31/07/2026",
    });
    expect(msg).toContain("vence em breve");
    expect(msg).toContain("31/07/2026");
    expect(msg).toContain("dividido entre 3 pessoas");
  });

  it("overdue is empathetic and keeps context", () => {
    const msg = render("overdue", {
      remaining: 50,
      participantsCount: 4,
      totalAmount: 200,
      pix_key: "user@meunino.com.br",
    });
    expect(msg).toContain("ainda aparece em aberto");
    expect(msg).toContain("dividido entre 4 pessoas");
    expect(msg).toContain("Pix: user@meunino.com.br");
  });

  it("payment_confirmation and completed never include context sentence", () => {
    const paid = render("payment_confirmation", {
      remaining: 0,
      participantsCount: 3,
      totalAmount: 300,
      title: "Jantar",
    });
    expect(paid).toContain("Tudo certo");
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

  it("omits context sentence when participants or total are missing (defensive)", () => {
    const msg = render("invite", {
      remaining: 0,
      participantsCount: 0,
      totalAmount: 0,
      title: "vazio",
    });
    expect(msg).not.toContain("dividido entre");
    expect(msg).not.toContain("total do rolê");
  });

  it("admin-provided template with context placeholder is honoured", () => {
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
