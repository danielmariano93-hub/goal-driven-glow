import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  addMonthsIso,
  auditInvoiceCoverage,
  parseInvoiceText,
} from "../../supabase/functions/_shared/documents/invoiceParser";

// Fatura Itaú real anonimizada (out/2026): cartão reemitido (final 0098), fatura
// NEGATIVA (saldo credor), estorno + reparcelamento Airbnb, antecipação de parcelas,
// duas compras idênticas no mesmo dia e "Repasse de IOF" sem data.
const TEXT = readFileSync("src/test/fixtures/itau-fatura-credito-0098.txt", "utf8");

describe("fatura Itaú com saldo credor", () => {
  const parsed = parseInvoiceText(TEXT);

  it("preserva o sinal do total e lê os rótulos oficiais", () => {
    expect(parsed.detected).toBe(true);
    expect(parsed.summary.total).toBe(-3644.06);
    expect(parsed.summary.previous_balance).toBe(1464.68);
    expect(parsed.summary.payments_total).toBe(9688.64);
    expect(parsed.summary.current_charges_total).toBe(4579.9);
    expect(parsed.summary.domestic_total).toBe(4309.7);
    expect(parsed.summary.international_total).toBe(261.06);
  });

  it("lê o final do cartão mascarado (4179.XXXX.XXXX.0098)", () => {
    expect(parsed.summary.card_last4).toBe("0098");
  });

  it("fechamento é o do ciclo (24/10), não a previsão do próximo (24/11)", () => {
    expect(parsed.summary.due_date).toBe("2026-11-01");
    expect(parsed.summary.closing_date).toBe("2026-10-24");
  });

  it("competência é o mês do fechamento, não o do vencimento", () => {
    expect(parsed.summary.competence).toBe("2026-10-01");
  });

  it("mantém as duas compras idênticas e lê o repasse de IOF como taxa", () => {
    const souk = parsed.lines.filter((l) => /souk4u/i.test(l.description));
    expect(souk).toHaveLength(2);
    const iof = parsed.lines.filter((l) => l.section === "taxes");
    expect(iof).toEqual([
      expect.objectContaining({ amount: 9.14, kind: "fee", date: "2026-10-24" }),
    ]);
  });

  it("a conta fecha: anterior − pagamentos + lançamentos = total (negativo)", () => {
    const audit = auditInvoiceCoverage(parsed.summary, parsed.lines);
    expect(audit.gap_section).toBeNull();
    expect(audit.calculated_total).toBe(-3644.06);
    expect(audit.equation_ok).toBe(true);
    const bySection = Object.fromEntries(audit.sections.map((s) => [s.section, s]));
    expect(bySection.domestic.extracted_total).toBe(4309.7);
    expect(bySection.international.extracted_total).toBe(261.06);
    expect(bySection.other.extracted_total).toBe(4579.9);
  });

  it("parcelas de próximas faturas ficam fora do total", () => {
    const future = parsed.lines.filter((l) => l.section === "future_installments");
    expect(future).toHaveLength(20);
    expect(Math.round(future.reduce((s, l) => s + l.amount, 0) * 100) / 100).toBe(2481.2);
  });
});

describe("addMonthsIso", () => {
  it("preserva o dia e limita ao fim do mês", () => {
    expect(addMonthsIso("2026-11-24", -1)).toBe("2026-10-24");
    expect(addMonthsIso("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonthsIso("2026-01-15", -1)).toBe("2025-12-15");
  });
});
