import { describe, expect, it } from "vitest";
import {
  auditInvoiceCoverage,
  coverageMessage,
  parseInvoiceText,
} from "../../supabase/functions/_shared/documents/invoiceParser";

// Fixture anonimizada com a mesma estrutura da fatura Itaú final 4739
// (vencimento 03/08/2026) que expôs o defeito de cobertura.
const ITAU_INVOICE = `
Itaú Unibanco
Fatura do cartão final 4739
Vencimento 03/08/2026
Fechamento 25/07/2026

Total da fatura anterior 3.529,34
Pagamentos efetuados -4.099,34
Saldo financiado -570,00
Lançamentos atuais 5.209,73
Total desta fatura 4.639,73

Pagamentos efetuados
22/06 PAGAMENTO PIX 3.529,34
22/07 Pagamento via conta 300,00
23/07 Pagamento via conta 50,00
24/07 Pagamento via conta 220,00

Compras nacionais
Total das compras nacionais 3.355,00
23/06 AmazonPrimeBR 19,90
24/06 iFood 132,40
25/06 RD Saude Drogasil 87,30
26/06 Outback Steakhouse 245,80
27/06 Localiza Aluguel 410,00
28/06 Supermercado Bom Preco 640,00
29/06 Posto Ipiranga 300,00
30/06 Farmacia Popular 120,00
01/07 Padaria Central 45,60
02/07 Apple.com/Bill 34,90
03/07 Uber Trip 28,40
04/07 Netflix.com 55,90
05/07 Escola Infantil 890,00
06/07 Pet Shop Amigo 96,30
07/07 Livraria Cultura 55,00
08/07 EST COMPRA CANCELADA 1,46-
09/07 Cinema Multiplex 74,00
10/07 Estacionamento Centro 120,96

Compras internacionais
Total das compras internacionais 1.792,02
11/07 Amazon US 402,10
12/07 Booking.com 690,52
13/07 Steam Games 199,40
14/07 Airbnb Payments 500,00

Encargos e IOF
15/07 Repasse de IOF 62,71

Compras parceladas - próximas faturas
16/07 Notebook Loja XPTO PARC 02/10 350,00
`;

describe("fatura Itaú — cobertura e conciliação", () => {
  const parsed = parseInvoiceText(ITAU_INVOICE);

  it("detecta a fatura e lê o resumo oficial", () => {
    expect(parsed.detected).toBe(true);
    expect(parsed.summary).toMatchObject({
      total: 4639.73,
      previous_balance: 3529.34,
      payments_total: 4099.34,
      financed_balance: 570,
      current_charges_total: 5209.73,
      domestic_total: 3355,
      international_total: 1792.02,
      due_date: "2026-08-03",
      closing_date: "2026-07-25",
      card_last4: "4739",
      bank: "Itaú",
    });
  });

  it("lê os quatro pagamentos do ciclo", () => {
    const payments = parsed.lines.filter((l) => l.section === "payments");
    expect(payments).toHaveLength(4);
    expect(payments.reduce((a, l) => a + l.amount, 0)).toBeCloseTo(4099.34, 2);
    expect(payments[0]).toMatchObject({ date: "2026-06-22", amount: 3529.34, kind: "payment" });
  });

  it("não perde linhas pequenas (Amazon Prime e IOF)", () => {
    const descriptions = parsed.lines.map((l) => l.description);
    expect(descriptions).toContain("AmazonPrimeBR");
    const iof = parsed.lines.find((l) => /IOF/i.test(l.description));
    expect(iof).toMatchObject({ amount: 62.71, section: "taxes", kind: "fee" });
  });

  it("separa parcelas de próximas faturas dos lançamentos do ciclo", () => {
    const future = parsed.lines.filter((l) => l.section === "future_installments");
    expect(future).toHaveLength(1);
    expect(future[0].amount).toBeCloseTo(350, 2);
  });

  it("fecha a conciliação com diferença zero", () => {
    const coverage = auditInvoiceCoverage(parsed.summary, parsed.lines);
    const bySection = Object.fromEntries(coverage.sections.map((s) => [s.section, s]));
    expect(bySection.payments.extracted_total).toBeCloseTo(4099.34, 2);
    expect(bySection.domestic.extracted_total).toBeCloseTo(3355, 2);
    expect(bySection.international.extracted_total).toBeCloseTo(1792.02, 2);
    expect(coverage.calculated_total).toBeCloseTo(4639.73, 2);
    expect(coverage.difference).toBeCloseTo(0, 2);
    expect(coverage.equation_ok).toBe(true);
    expect(coverage.gap_section).toBeNull();
    expect(coverageMessage(coverage)).toBeNull();
  });

  it("aponta a seção e o valor faltante quando o extrator perde linhas", () => {
    const incomplete = parsed.lines.filter((l) => l.description !== "AmazonPrimeBR");
    const coverage = auditInvoiceCoverage(parsed.summary, incomplete);
    expect(coverage.gap_section).toBe("domestic");
    expect(coverage.gap_amount).toBeCloseTo(19.9, 2);
    expect(coverageMessage(coverage)).toContain("Compras nacionais");
  });

  it("aponta pagamentos ausentes — o defeito original de R$ 4.099,34", () => {
    const semPagamentos = parsed.lines.filter((l) => l.section !== "payments");
    const coverage = auditInvoiceCoverage(parsed.summary, semPagamentos);
    expect(coverage.gap_section).toBe("payments");
    expect(coverage.gap_amount).toBeCloseTo(4099.34, 2);
    expect(coverage.equation_ok).toBe(false);
    expect(coverage.difference).toBeCloseTo(-4099.34, 2);
  });
});

describe("variações de fatura", () => {
  it("antecipação maior que a fatura anterior gera saldo financiado negativo", () => {
    const parsed = parseInvoiceText(`
Vencimento 10/09/2026
Total da fatura anterior 500,00
Pagamentos efetuados -800,00
Lançamentos atuais 300,00
Total desta fatura 0,00
Pagamentos efetuados
05/08 Pagamento via conta 800,00
Compras nacionais
06/08 Mercado 300,00
`);
    const coverage = auditInvoiceCoverage(parsed.summary, parsed.lines);
    expect(coverage.calculated_total).toBeCloseTo(0, 2);
    expect(coverage.equation_ok).toBe(true);
  });

  it("fatura sem saldo anterior concilia só com os lançamentos", () => {
    const parsed = parseInvoiceText(`
Vencimento 10/09/2026
Lançamentos atuais 150,00
Total desta fatura 150,00
Compras nacionais
06/08 Mercado 100,00
07/08 Farmácia 50,00
`);
    const coverage = auditInvoiceCoverage(parsed.summary, parsed.lines);
    expect(coverage.calculated_total).toBeCloseTo(150, 2);
    expect(coverage.equation_ok).toBe(true);
  });

  it("PDF sem camada de texto não é detectado como fatura", () => {
    expect(parseInvoiceText("").detected).toBe(false);
    expect(parseInvoiceText("imagem sem texto").detected).toBe(false);
  });
});
