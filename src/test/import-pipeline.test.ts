// Pipeline único de importação em lote: parser + deduplicação.
import { describe, expect, it } from "vitest";
import { parseBatch, sumBatch, parseAmountLoose } from "../../supabase/functions/_shared/import/parseBatch";
import { classifyBatch, type ExistingTx } from "../../supabase/functions/_shared/import/dedupe";
import { resolveNature, parseItemDate } from "../../supabase/functions/_shared/import/schema";
import { formatPreview, formatReport } from "../../supabase/functions/_shared/import/commit";

describe("import/schema", () => {
  it("resolve naturezas financeiras completas", () => {
    expect(resolveNature("despesa", null)).toMatchObject({ kind: "transaction", type: "expense" });
    expect(resolveNature(null, "transferencia_enviada")).toMatchObject({ kind: "internal_transfer", type: "expense" });
    expect(resolveNature(null, "resgate")).toMatchObject({ kind: "investment_redemption", type: "income" });
    expect(resolveNature("despesa", "pagamento_fatura")).toMatchObject({ kind: "card_payment", type: "expense" });
    expect(resolveNature("receita", "estorno")).toMatchObject({ kind: "refund", type: "income" });
  });

  it("lê datas BR e ISO", () => {
    expect(parseItemDate("05/03/2026")).toBe("2026-03-05");
    expect(parseItemDate("2026-03-05T10:00:00Z")).toBe("2026-03-05");
    expect(parseItemDate("5/3/26")).toBe("2026-03-05");
    expect(parseItemDate("banana")).toBeNull();
  });
});

describe("import/parseBatch", () => {
  it("preserva a data individual de cada item do JSON", () => {
    const { items, source } = parseBatch(JSON.stringify({
      lancamentos: [
        { data: "2026-03-01", descricao: "Padaria Sol", valor: "12,50", tipo: "despesa" },
        { data: "2026-03-04", descricao: "Salário", valor: 5000, tipo: "receita" },
        { data: "05/03/2026", descricao: "Aplicação CDB", valor: "1.000,00", movement_kind: "investment_application" },
      ],
    }));
    expect(source).toBe("json");
    expect(items.map((i) => i.occurred_at)).toEqual(["2026-03-01", "2026-03-04", "2026-03-05"]);
    expect(items[1].type).toBe("income");
    expect(items[2].movement_kind).toBe("investment_application");
    expect(items[2].amount).toBe(1000);
  });

  it("mantém campos financeiros ricos por item", () => {
    const { items } = parseBatch(JSON.stringify([
      {
        data: "2026-03-02", data_processamento: "2026-03-03", descricao: "Loja X",
        valor: 90, tipo: "despesa", cartao: "Itaú Black", parcela: 2, parcelas_total: 6,
        categoria: "Compras", external_id: "AUT123", bank_reference: "AUT123",
      },
      { data: "2026-03-02", descricao: "Estorno Loja X", valor: 90, tipo: "despesa", movement_kind: "refund", estorno_de: "AUT123" },
      { data: "2026-03-03", descricao: "Pix para poupança", valor: 200, movimento: "transferencia_enviada" },
    ]));
    expect(items[0]).toMatchObject({
      posted_at: "2026-03-03", card_hint: "Itaú Black", payment_method: "credit_card",
      installment_number: 2, installments_total: 6, category_hint: "Compras", bank_reference: "AUT123",
    });
    expect(items[1]).toMatchObject({ type: "income", movement_kind: "refund", reverses_external_id: "AUT123" });
    expect(items[2]).toMatchObject({ movement_kind: "internal_transfer", type: "expense" });
  });

  it("trata valor negativo como crédito e sinaliza data ausente", () => {
    const { items } = parseBatch(JSON.stringify([
      { descricao: "Ajuste", valor: -30, tipo: "despesa" },
      { data: "2026-03-01", descricao: "Mercado", valor: 10 },
      { data: "2026-03-01", descricao: "Farmácia", valor: 20 },
    ]));
    expect(items[0]).toMatchObject({ type: "income", movement_kind: "refund", amount: 30 });
    expect(items[0].issues).toContain("data_ausente");
  });

  it("lê linhas soltas com data e valor", () => {
    const { items, source } = parseBatch("01/03 Padaria R$ 12,50\n02/03 Uber 23,90\n03/03 Mercado 100");
    expect(source).toBe("lines");
    expect(items).toHaveLength(3);
    expect(items[0].occurred_at?.slice(5)).toBe("03-01");
  });

  it("soma líquida desconta créditos e pagamentos de fatura", () => {
    const { items } = parseBatch(JSON.stringify([
      { data: "2026-03-01", descricao: "Compra", valor: 100, tipo: "despesa" },
      { data: "2026-03-01", descricao: "Estorno", valor: 40, movement_kind: "refund" },
      { data: "2026-03-01", descricao: "Pagamento fatura", valor: 30, movement_kind: "card_payment" },
    ]));
    expect(sumBatch(items)).toBe(30);
  });

  it("parseAmountLoose entende formatos BR", () => {
    expect(parseAmountLoose("1.234,56")).toBe(1234.56);
    expect(parseAmountLoose("R$ 9,90")).toBe(9.9);
    expect(parseAmountLoose("(50,00)")).toBe(-50);
    expect(parseAmountLoose("abc")).toBeNull();
  });
});

describe("import/dedupe", () => {
  const existing: ExistingTx[] = [
    { id: "tx1", type: "expense", amount: 12.5, occurred_at: "2026-03-01", description: "Padaria Sol", raw_description: "PADARIA SOL LTDA" },
    { id: "tx2", type: "expense", amount: 90, occurred_at: "2026-03-05", description: "Loja X", bank_reference: "AUT123" },
    { id: "tx3", type: "expense", amount: 55, occurred_at: "2026-03-07", description: "Posto Ipiranga" },
  ];

  it("marca duplicidade exata por data + valor + comerciante", () => {
    const [verdict] = classifyBatch([{ type: "expense", amount: 12.5, occurred_at: "2026-03-01", description: "Padaria Sol" }], existing);
    expect(verdict).toMatchObject({ status: "exact_duplicate", duplicate_of: "tx1" });
  });

  it("marca duplicidade exata por referência bancária", () => {
    const [verdict] = classifyBatch(
      [{ type: "expense", amount: 90, occurred_at: "2026-03-02", description: "Compra qualquer", bank_reference: "aut123" }],
      existing,
    );
    expect(verdict).toMatchObject({ status: "exact_duplicate", reason_code: "referencia_bancaria", duplicate_of: "tx2" });
  });

  it("marca possível duplicidade dentro da janela de dias", () => {
    const [verdict] = classifyBatch(
      [{ type: "expense", amount: 55, occurred_at: "2026-03-09", description: "POSTO IPIRANGA" }],
      existing,
    );
    expect(verdict.status).toBe("probable_duplicate");
    expect(verdict.duplicate_of).toBe("tx3");
  });

  it("não repete a mesma transação existente para dois itens do lote", () => {
    const verdicts = classifyBatch([
      { type: "expense", amount: 12.5, occurred_at: "2026-03-01", description: "Padaria Sol" },
      { type: "expense", amount: 12.5, occurred_at: "2026-03-01", description: "Padaria Sol" },
    ], existing);
    expect(verdicts[0].status).toBe("exact_duplicate");
    expect(verdicts[1].status).toBe("new");
  });

  it("item fora da janela é novo", () => {
    const [verdict] = classifyBatch([{ type: "expense", amount: 12.5, occurred_at: "2026-03-20", description: "Padaria Sol" }], existing);
    expect(verdict).toMatchObject({ status: "new", duplicate_of: null });
  });

  it("tipo diferente não é duplicidade", () => {
    const [verdict] = classifyBatch([{ type: "income", amount: 12.5, occurred_at: "2026-03-01", description: "Padaria Sol" }], existing);
    expect(verdict.status).toBe("new");
  });
});

describe("import/report", () => {
  it("prévia mostra novos, duplicados e revisão", () => {
    const preview = formatPreview(
      { total: 42, new: 31, exact_duplicate: 8, probable_duplicate: 2, needs_review: 1, invalid: 0 },
      { targetName: "cartão Itaú", netTotal: 1234.5 },
    );
    expect(preview).toContain("Encontrei 42 lançamentos");
    expect(preview).toContain("31 novos");
    expect(preview).toContain("8 já registrados");
    expect(preview).toContain("CONFIRMAR");
  });

  it("relatório final lista totais por natureza", () => {
    const report = formatReport({
      ok: true, imported: 31, skipped: 8, failed: 0, exact_duplicates: 8, probable_duplicates: 2,
      pending_review: 1, invalid: 0, total_expense: 900, total_income: 100, total_transfer: 200,
      total_refund: 50, transaction_ids: [], ignored_item_ids: [],
    }, "cartão Itaú");
    expect(report).toContain("Registrados: 31");
    expect(report).toContain("Transferências");
    expect(report).toContain("Estornos");
  });
});
