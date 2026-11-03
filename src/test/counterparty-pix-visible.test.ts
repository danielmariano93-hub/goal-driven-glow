import { describe, expect, it } from "vitest";
import { parseCounterpartyGroups, visibleCounterpartyGroups } from "@/lib/categories/counterparties";

const rows = [
  { counterparty_key: "lucas", label: "Pix enviado Lucas", transaction_type: "expense", transactions: 1, total: 100, last_date: "2026-09-28" },
  { counterparty_key: "joao vitor silva", label: "Pix enviado João Vitor Silva dos", transaction_type: "expense", transactions: 1, total: 50, last_date: "2026-10-03" },
  { counterparty_key: "luccas arruda", label: "Pix enviado LUCCAS ARRUDA PO", transaction_type: "expense", transactions: 1, total: 2.22, last_date: "2026-10-15" },
  { counterparty_key: "padaria", label: "Padaria do Zé", transaction_type: "expense", transactions: 1, total: 20, last_date: "2026-10-16" },
  { counterparty_key: "uber", label: "UBER DO BRASIL", transaction_type: "expense", transactions: 7, total: 300, last_date: "2026-10-30" },
];

describe("'a classificar': Pix para pessoa nunca fica invisível", () => {
  const shown = visibleCounterpartyGroups(parseCounterpartyGroups(rows)).map((g) => g.counterparty_key);
  it("mostra Pix isolado (os 3 Pix sem categoria do caso real, R$ 152,22)", () => {
    expect(shown).toEqual(expect.arrayContaining(["lucas", "joao vitor silva", "luccas arruda"]));
  });
  it("continua mostrando favorecido com 2+ lançamentos", () => {
    expect(shown).toContain("uber");
  });
  it("estabelecimento isolado não vira lista (segue pela sugestão do próprio lançamento)", () => {
    expect(shown).not.toContain("padaria");
  });
  it("o nome continua 'Pix para …'", () => {
    expect(parseCounterpartyGroups(rows)[0]!.display_name).toBe("Pix para Lucas");
  });
});
