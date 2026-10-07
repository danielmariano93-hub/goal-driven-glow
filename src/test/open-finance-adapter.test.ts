import { describe, expect, it } from "vitest";
import {
  adaptPluggyTransactions,
  maskedAccountName,
  type PluggyTransaction,
} from "../../supabase/functions/_shared/openfinance/pluggyAdapter";
import { readFileSync } from "node:fs";

const tx = (over: Partial<PluggyTransaction>): PluggyTransaction => ({
  id: "t1", description: "Mercado Bom Preco", amount: -42.5, date: "2026-10-05T03:00:00.000Z",
  type: "DEBIT", status: "POSTED", ...over,
});
const bank = { accountType: "BANK" as const };
const card = { accountType: "CREDIT" as const };

describe("adaptador Pluggy → import_item.v2", () => {
  it("compra no débito: despesa positiva, identidade forte, data civil", () => {
    const { items } = adaptPluggyTransactions([tx({})], bank);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "expense", movement_kind: "transaction", amount: 42.5, occurred_at: "2026-10-05",
      posted_at: "2026-10-05", posted_at_source: "statement", external_id: "pluggy:t1", bank_reference: "pluggy:t1",
      payment_method: "account", confidence: 0.9, issues: [],
    });
  });

  it("salário: receita normal", () => {
    const { items } = adaptPluggyTransactions([tx({ id: "s", description: "Salario Empresa X", amount: 5000, type: "CREDIT" })], bank);
    expect(items[0]).toMatchObject({ type: "income", movement_kind: "transaction", amount: 5000 });
  });

  it("pagamento de fatura NÃO é gasto", () => {
    const { items } = adaptPluggyTransactions([tx({ id: "f", description: "Pagamento de fatura Nubank", amount: -1800 })], bank);
    expect(items[0].movement_kind).toBe("card_payment");
  });

  it("no cartão, o crédito de pagamento também é pagamento de fatura", () => {
    const { items } = adaptPluggyTransactions([tx({ id: "p", description: "Pagamento recebido", amount: 1800, type: "CREDIT" })], card);
    expect(items[0].movement_kind).toBe("card_payment");
  });

  it("no cartão, crédito sem natureza conhecida vai para revisão", () => {
    const { items } = adaptPluggyTransactions([tx({ id: "x", description: "Credito diverso", amount: 30, type: "CREDIT" })], card);
    expect(items[0]).toMatchObject({ movement_kind: "refund", confidence: 0.6, issues: ["credito_no_cartao_sem_natureza"] });
  });

  it("compra parcelada no cartão: parcelas e data da compra", () => {
    const { items } = adaptPluggyTransactions([tx({
      id: "c", description: "Loja Tal 3/10", amount: -120, date: "2026-10-20T03:00:00.000Z",
      creditCardMetadata: { installmentNumber: 3, totalInstallments: 10, purchaseDate: "2026-08-20T03:00:00.000Z" },
    })], card);
    expect(items[0]).toMatchObject({
      payment_method: "credit_card", installment_number: 3, installments_total: 10,
      purchase_date: "2026-08-20", occurred_at: "2026-08-20", posted_at: "2026-10-20",
    });
  });

  it("parcelas incoerentes são ignoradas, não inventadas", () => {
    const { items } = adaptPluggyTransactions([tx({ creditCardMetadata: { installmentNumber: 9, totalInstallments: 3 } })], card);
    expect(items[0].installments_total).toBeNull();
  });

  it("Pix e transferências: confiança baixa, destino a confirmar", () => {
    const out = adaptPluggyTransactions([
      tx({ id: "a", description: "Pix enviado Maria", amount: -80 }),
      tx({ id: "b", description: "Pix recebido Joao", amount: 80, type: "CREDIT" }),
    ], bank).items;
    expect(out[0]).toMatchObject({ movement_kind: "external_transfer_out", confidence: 0.6, issues: ["transferencia_confirmar_destino"] });
    expect(out[1].movement_kind).toBe("external_transfer_in");
  });

  it("investimentos", () => {
    const out = adaptPluggyTransactions([
      tx({ id: "i1", description: "Aplicacao CDB", amount: -1000 }),
      tx({ id: "i2", description: "Resgate CDB", amount: 1000, type: "CREDIT" }),
      tx({ id: "i3", description: "Rendimento poupanca", amount: 12, type: "CREDIT" }),
    ], bank).items;
    expect(out.map((i) => i.movement_kind)).toEqual(["investment_application", "investment_redemption", "investment_yield"]);
  });

  it("pendentes não entram; inválidos são contados", () => {
    const r = adaptPluggyTransactions([
      tx({ id: "p", status: "PENDING" }),
      tx({ id: "", description: "sem id" }),
      tx({ id: "z", amount: 0 }),
      tx({ id: "d", date: null }),
      tx({ id: "k", type: "OTHER" }),
      tx({ id: "ok" }),
    ], bank);
    expect(r.items).toHaveLength(1);
    expect(r.skipped).toEqual({ pending: 1, invalid: 4 });
  });

  it("usa o nome do estabelecimento quando existe e preserva o texto bruto", () => {
    const { items } = adaptPluggyTransactions([tx({ description: "COMPRA 1234 PADARIA", merchant: { name: "Padaria Estrela" } })], bank);
    expect(items[0]).toMatchObject({ description: "Padaria Estrela", merchant: "Padaria Estrela", raw_description: "COMPRA 1234 PADARIA" });
  });

  it("ordinais são sequenciais mesmo com itens descartados", () => {
    const { items } = adaptPluggyTransactions([tx({ id: "a" }), tx({ id: "x", status: "PENDING" }), tx({ id: "b" })], bank);
    expect(items.map((i) => i.ordinal)).toEqual([0, 1]);
  });

  it("nome de conta mascarado", () => {
    expect(maskedAccountName("Conta Corrente", "12345-6")).toBe("Conta Corrente ••3456");
    expect(maskedAccountName(null, null)).toBe("Conta");
  });

  it("o cliente não registra corpo de resposta nem credenciais em log", () => {
    const src = readFileSync("supabase/functions/_shared/openfinance/pluggyClient.ts", "utf8");
    expect(src).not.toMatch(/console\.(log|error|warn)/);
  });
});

import { paginateTransactionsV2 } from "../../supabase/functions/_shared/openfinance/pluggyClient";

describe("Pluggy /v2/transactions — paginação por cursor", () => {
  it("segue `next` até null e junta as páginas, com o período no primeiro pedido", async () => {
    const calls: string[] = [];
    const pages: Record<string, unknown> = {
      first: { results: [{ id: "1" }, { id: "2" }], next: "?accountId=acc&after=C1" },
      second: { results: [{ id: "3" }], next: null },
    };
    const out = await paginateTransactionsV2(async (path) => {
      calls.push(path);
      return calls.length === 1 ? pages.first : pages.second;
    }, "acc", "2026-07-01", "2026-10-07");
    expect(out.map((t) => t.id)).toEqual(["1", "2", "3"]);
    expect(calls[0]).toBe("/v2/transactions?accountId=acc&dateFrom=2026-07-01&dateTo=2026-10-07");
    expect(calls[1]).toBe("/v2/transactions?accountId=acc&after=C1");
  });

  it("ignora `next` que não seja uma query string (nunca segue URL externa)", async () => {
    let n = 0;
    const out = await paginateTransactionsV2(async () => {
      n++;
      return { results: [{ id: String(n) }], next: "https://evil.example/steal" };
    }, "acc", "2026-07-01", "2026-10-07");
    expect(n).toBe(1);
    expect(out).toHaveLength(1);
  });

  it("para em página vazia (evita laço) e tolera resposta sem results", async () => {
    let n = 0;
    expect(await paginateTransactionsV2(async () => { n++; return { results: [], next: "?x=1" }; }, "a", "2026-01-01", "2026-02-01")).toEqual([]);
    expect(n).toBe(1);
    expect(await paginateTransactionsV2(async () => ({}), "a", "2026-01-01", "2026-02-01")).toEqual([]);
  });
});
