import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { closingDateOf, invoicePoints, smoothPath, summarizeInvoiceItems } from "@/lib/cardInvoice";

const src = readFileSync("src/pages/Cartoes.tsx", "utf8");

describe("aba Cartões: estrutura da referência e só o que é certeza", () => {
  it("tem gráfico de meses, título, resumo, aviso, opinião e lançamentos com filtros", () => {
    for (const t of ["CardInvoicePanel", "smoothPath", "Resumo da fatura", "Produtos e serviços", "Compartilhe a sua opinião", "Lançamentos", "Filtros", "Melhor data de compra", "Vencimento", "Saldo positivo", "Compras recentes só aparecem aqui"]) {
      expect(src).toContain(t);
    }
  });
  it("sem estimativas, sem histórico duplicado e sem o '% quitado' que dava 0% em fatura paga", () => {
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
    expect(s).toEqual({ credits: -8330.2, purchases: 9515.61, services: 0, adjustments: -4829.47, total: -3644.06 });
  });
  it("juros e tarifas vão para 'produtos e serviços'", () => {
    expect(summarizeInvoiceItems([{ item_kind: "fee", amount: 10 }, { item_kind: "interest", amount: 5.5 }]).services).toBe(15.5);
  });
});

describe("datas e curva", () => {
  it("fechamento: vence 01/12 e fecha dia 24 → 24/11; vence dia 10 e fecha dia 3 → mesmo mês", () => {
    expect(closingDateOf("2026-12-01", 24, 1)).toBe("2026-11-24");
    expect(closingDateOf("2026-11-01", 24, 1)).toBe("2026-10-24");
    expect(closingDateOf("2026-11-10", 3, 10)).toBe("2026-11-03");
  });
  it("pontos: valor maior fica mais alto; zero na base", () => {
    const pts = invoicePoints([0, 1000, 500], { tileW: 96, gap: 8, top: 40, bottom: 100 });
    expect(pts[0]).toEqual({ x: 48, y: 100 });
    expect(pts[1].y).toBe(40);
    expect(pts[2].y).toBe(70);
    expect(smoothPath(pts).startsWith("M 48 100 C")).toBe(true);
  });
});
