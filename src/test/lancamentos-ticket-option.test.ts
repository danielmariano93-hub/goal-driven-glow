import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync("src/pages/Lancamentos.tsx", "utf8");
const ticketPage = readFileSync("src/pages/TicketAlimentacao.tsx", "utf8");

describe("Anotar: Ticket como forma de pagamento", () => {
  it("'De onde saiu?' oferece Ticket quando o usuário tem a carteira, só para gasto da rotina", () => {
    expect(src).toContain('const ticketOn = !!ticket && !initial && allowsCard;');
    expect(src).toContain('setPaymentMethod("ticket")');
    expect(src).toContain("{ticketOn ?");
  });
  it("gasto no Ticket vai só para a carteira do Ticket (benefit_entries), sem criar lançamento", () => {
    expect(src).toContain('kind: "spend", amount: v.amount');
    const i = src.indexOf("if (isTicket && ticket) {");
    const j = src.indexOf("const parsed = transactionSchema.safeParse", i);
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, j)).toContain("return;");
  });
  it("com Ticket escolhido, conta, cartão, parcelas, categoria e status somem", () => {
    expect(src).toContain("{isTicket ? null : (type === \"income\"");
    expect(src).toContain("classifiable && !isTicket");
    expect(src).toContain("{isTicket ? null : <div>");
  });
  it("a tela do Ticket tem botões com rótulo para registrar gasto, saldo e crédito", () => {
    expect(ticketPage).toContain("Registrar gasto");
    expect(ticketPage).toContain('openSheet("reading")');
    expect(ticketPage).toContain('openSheet("credit")');
  });
});
