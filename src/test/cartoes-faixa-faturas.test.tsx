import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { summarizeInvoiceItems } from "@/lib/cardInvoice";

const src = readFileSync("src/pages/Cartoes.tsx", "utf8");

describe("aba Cartões: estrutura da referência e só o que é certeza", () => {
  it("painel com meses, título da fatura, resumo e lançamentos", () => {
    for (const t of ["CardInvoicePanel", "Resumo da fatura", "Lançamentos", "Melhor data de compra", "Vencimento", "Saldo positivo"]) {
      expect(src).toContain(t);
    }
  });
  it("sem estimativas e sem o histórico duplicado nem o '% quitado' que dava 0% em fatura paga", () => {
    expect(src).not.toContain("Próxima fatura");
    expect(src).not.toContain("Estimativa reconstruída");
    expect(src).not.toContain("quitado");
    expect(src).not.toContain("Histórico de faturas");
    expect(src).toContain("installments={[]}");
  });
});

describe("resumo da fatura de outubro/26 (itens reais)", () => {
  it("fecha exatamente com o total da fatura (saldo credor de 3.644,06)", () => {
    const s = summarizeInvoiceItems([
      { item_kind: "installment", amount: 8788.43 }, { item_kind: "purchase", amount: 727.18 },
      { item_kind: "payment", amount: -8223.96 }, { item_kind: "refund", amount: -106.24 },
      { item_kind: "adjustment", amount: -4829.47 },
    ]);
    expect(s).toEqual({ credits: -8330.2, purchases: 9515.61, other: -4829.47, total: -3644.06 });
  });
});
