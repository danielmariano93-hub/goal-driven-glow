// Automação do celular (`!ja`) com "Ticket" no lugar da conta: vai só para a carteira do Ticket.
import { describe, expect, it, vi } from "vitest";

vi.mock("../../supabase/functions/_shared/agent/parser.ts", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  todaySaoPaulo: () => "2026-11-03",
}));
import { detectBenefitPayment, recordBenefitFastLog } from "../../supabase/functions/_shared/agent/benefitFastLog";

const AUTOMACAO = (ultima: string) => `💳 Registre esse novo gasto que tive

Valor: R$ 108,00
Estabelecimento: Zigpay
Data:1 de nov. de 2026, 01:57
${ultima}`;

describe("detectBenefitPayment — só o meio de pagamento decide", () => {
  it("a automação com 'Ticket' na última linha é do Ticket; com 'Conta Corrente Itaú' não", () => {
    expect(detectBenefitPayment(AUTOMACAO("Ticket"))).toBe(true);
    expect(detectBenefitPayment(AUTOMACAO("Vale Refeição"))).toBe(true);
    expect(detectBenefitPayment(AUTOMACAO("Conta Corrente Itaú"))).toBe(false);
  });
  it("estabelecimento chamado Ticket não desvia o gasto da conta", () => {
    expect(detectBenefitPayment(AUTOMACAO("Conta Corrente Itaú").replace("Zigpay", "Ticket Cinema"))).toBe(false);
    expect(detectBenefitPayment("gastei 40 no Ticket Cinema")).toBe(false);
  });
  it("frase livre de uma linha", () => {
    expect(detectBenefitPayment("gastei 45 no mercado com o ticket")).toBe(true);
    expect(detectBenefitPayment("gastei 45 no mercado no débito")).toBe(false);
  });
});

function fakeSb(opts: { access?: boolean; wallet?: boolean } = {}) {
  const access = opts.access ?? true;
  const wallet = opts.wallet ?? true;
  const entries: Array<Record<string, any>> = [{ id: "r", kind: "balance_reading", amount: 825.33, occurred_on: "2026-11-03", merchant: null, note: null }];
  const inserted: Array<Record<string, any>> = [];
  const from = (table: string) => {
    const f: Array<[string, any]> = [];
    const q: any = {
      select: () => q, order: () => q, limit: () => q,
      eq: (c: string, v: any) => (f.push([c, v]), q), is: (c: string, v: any) => (f.push([c, v]), q),
      maybeSingle: async () => table === "benefit_wallet_access"
        ? { data: access ? { user_id: "u1" } : null, error: null }
        : { data: wallet ? { id: "w1", monthly_credit: 1227.16, credit_day: 27, carries_over: true } : null, error: null },
      insert: async (row: any) => { entries.push({ id: `n${entries.length}`, ...row }); inserted.push(row); return { error: null }; },
      then: (res: (v: unknown) => unknown) => res({
        data: entries.filter((e) => f.every(([c, v]) => c === "wallet_id" || (e[c] ?? null) === v)), error: null,
      }),
    };
    return q;
  };
  return { sb: { from } as never, inserted };
}

describe("recordBenefitFastLog", () => {
  it("registra só no Ticket, com valor, estabelecimento, data e hora da mensagem", async () => {
    const { sb, inserted } = fakeSb();
    const out = await recordBenefitFastLog(sb, { user_id: "u1", cleanText: AUTOMACAO("Ticket") });
    expect(out.recorded).toBe(true);
    expect(inserted).toEqual([{ wallet_id: "w1", user_id: "u1", kind: "spend", amount: 108, occurred_on: "2026-11-01", merchant: "Zigpay", note: "01:57", source: "whatsapp" }]);
    expect(out.reply).toContain("R$");
    expect(out.reply).toContain("Zigpay");
    expect(out.reply).toContain("01/11");
  });
  it("a mesma mensagem duas vezes não conta duas vezes", async () => {
    const { sb, inserted } = fakeSb();
    await recordBenefitFastLog(sb, { user_id: "u1", cleanText: AUTOMACAO("Ticket") });
    const again = await recordBenefitFastLog(sb, { user_id: "u1", cleanText: AUTOMACAO("Ticket") });
    expect(again.recorded).toBe(false);
    expect(again.reply).toContain("já estava registrado");
    expect(inserted).toHaveLength(1);
  });
  it("sem acesso ou sem carteira, avisa e não registra em outro lugar", async () => {
    for (const o of [{ access: false }, { wallet: false }]) {
      const { sb, inserted } = fakeSb(o);
      const out = await recordBenefitFastLog(sb, { user_id: "u1", cleanText: AUTOMACAO("Ticket") });
      expect(out.recorded).toBe(false);
      expect(inserted).toHaveLength(0);
    }
  });
  it("sem valor, pergunta em vez de inventar", async () => {
    const { sb, inserted } = fakeSb();
    const out = await recordBenefitFastLog(sb, { user_id: "u1", cleanText: "Estabelecimento: Zigpay\nTicket" });
    expect(out.reply_kind).toBe("question");
    expect(inserted).toHaveLength(0);
  });
});

import { classifyBenefitMessage } from "../../supabase/functions/_shared/agent/benefitFastLog";

describe("classifyBenefitMessage — texto livre sobre o Ticket (sem !ja)", () => {
  it("gasto, crédito e saldo", () => {
    expect(classifyBenefitMessage("gastei 45 no mercado com o ticket")).toBe("spend");
    expect(classifyBenefitMessage("paguei 32,90 no almoço no ticket")).toBe("spend");
    expect(classifyBenefitMessage("caiu o ticket 900")).toBe("credit");
    expect(classifyBenefitMessage("entrou 1.227,16 de ticket")).toBe("credit");
    expect(classifyBenefitMessage("ticket 412,40")).toBe("reading");
    expect(classifyBenefitMessage("saldo do ticket 412,40")).toBe("reading");
    expect(classifyBenefitMessage("meu ticket está com 412,40")).toBe("reading");
  });
  it("pergunta, hipótese e conversa nunca registram", () => {
    for (const t of ["quanto tenho de ticket?", "e se eu gastar 40 no ticket?", "se eu gastar 40 no ticket até quando dura", "qual o saldo do ticket", "ticket médio de 45"]) {
      expect(classifyBenefitMessage(t), t).toBeNull();
    }
  });
  it("sem Ticket, ou sem valor, não é do Ticket", () => {
    expect(classifyBenefitMessage("gastei 45 no mercado")).toBeNull();
    expect(classifyBenefitMessage("gastei no mercado com o ticket")).toBeNull();
    expect(classifyBenefitMessage("gastei 40 no Ticket Cinema")).toBeNull();
  });
});
