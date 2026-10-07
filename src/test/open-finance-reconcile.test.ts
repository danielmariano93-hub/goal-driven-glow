import { describe, expect, it } from "vitest";
import {
  dedupeAcrossAccounts, planReconciliation, type Provisional,
} from "../../supabase/functions/_shared/openfinance/reconcile";
import type { ImportItem } from "../../supabase/functions/_shared/import/schema";

const bank = (o: Partial<ImportItem> & { ordinal: number; amount: number; occurred_at: string; description: string }): ImportItem => ({
  posted_at: o.occurred_at, posted_at_source: "statement", purchase_date: null, type: "expense", movement_kind: "transaction",
  raw_description: o.description, merchant: null, category_hint: null, account_hint: null, card_hint: null,
  payment_method: "account", installments_total: null, installment_number: null, external_id: `pluggy:${o.ordinal}`,
  bank_reference: `pluggy:${o.ordinal}`, source_document_id: null, source_line_index: null, reverses_external_id: null,
  confidence: 0.9, issues: [], ...o,
} as ImportItem);

const prov = (o: Partial<Provisional> & { id: string; amount: number; occurred_at: string; description: string }): Provisional => ({
  type: "expense", origin: "agent", ...o,
});

const TODAY = "2026-10-07";

describe("conciliação do mês atual — provisório x banco", () => {
  it("casa o gasto lançado por conversa com o do banco: o banco prevalece, sem linha nova", () => {
    const plan = planReconciliation(
      [bank({ ordinal: 1, amount: 39.11, occurred_at: "2026-10-02", description: "99 TECNOLOGIA LTDA", raw_description: "99 TECNOLOGIA LTDA" })],
      [prov({ id: "t1", amount: 39.11, occurred_at: "2026-10-02", description: "99 corrida" })],
      TODAY,
    );
    expect(plan.matches).toHaveLength(1);
    expect(plan.matches[0]).toMatchObject({ level: "alta", amount_delta: 0, day_delta: 0 });
    expect(plan.new_items).toHaveLength(0);
    expect(plan.unmatched_provisional).toHaveLength(0);
  });

  it("valor diferente (gorjeta/centavos) com o mesmo estabelecimento: casa e sinaliza a diferença", () => {
    const plan = planReconciliation(
      [bank({ ordinal: 1, amount: 55, occurred_at: "2026-10-03", description: "RESTAURANTE SABOR", merchant: "Restaurante Sabor" })],
      [prov({ id: "t1", amount: 50, occurred_at: "2026-10-03", description: "Restaurante Sabor" })],
      TODAY,
    );
    expect(plan.matches[0]).toMatchObject({ level: "valor_diferente", amount_delta: 5 });
  });

  it("mesmo valor e estabelecimento diferente, 3 dias depois: só 'dúvida' (não casa sozinho)", () => {
    const plan = planReconciliation(
      [bank({ ordinal: 1, amount: 30, occurred_at: "2026-10-05", description: "LOJA XYZ" })],
      [prov({ id: "t1", amount: 30, occurred_at: "2026-10-02", description: "Padaria" })],
      TODAY,
    );
    expect(plan.matches[0].level).toBe("duvida");
  });

  it("duas compras iguais no mesmo dia continuam sendo duas (cada provisório absorve um)", () => {
    const plan = planReconciliation(
      [
        bank({ ordinal: 1, amount: 10, occurred_at: "2026-10-04", description: "CAFE" }),
        bank({ ordinal: 2, amount: 10, occurred_at: "2026-10-04", description: "CAFE" }),
      ],
      [prov({ id: "t1", amount: 10, occurred_at: "2026-10-04", description: "Café" })],
      TODAY,
    );
    expect(plan.matches).toHaveLength(1);
    expect(plan.new_items).toHaveLength(1);
  });

  it("o que o banco trouxe e não casa com nada entra como novo", () => {
    const plan = planReconciliation([bank({ ordinal: 1, amount: 99, occurred_at: "2026-10-06", description: "FARMACIA" })], [], TODAY);
    expect(plan.new_items).toHaveLength(1);
  });

  it("provisório sem par: aguarda; depois de 5 dias ganha o selo 'não apareceu' — nunca é descartado", () => {
    const plan = planReconciliation([], [
      prov({ id: "novo", amount: 20, occurred_at: "2026-10-06", description: "Almoço" }),
      prov({ id: "velho", amount: 80, occurred_at: "2026-10-01", description: "Dinheiro" }),
    ], TODAY);
    const byId = Object.fromEntries(plan.unmatched_provisional.map((u) => [u.tx.id, u]));
    expect(byId.novo.status).toBe("aguardando");
    expect(byId.velho).toMatchObject({ status: "nao_apareceu", age_days: 6 });
    expect(plan.unmatched_provisional).toHaveLength(2);
  });

  it("tipos diferentes nunca casam (entrada x saída)", () => {
    const plan = planReconciliation(
      [bank({ ordinal: 1, amount: 40, occurred_at: "2026-10-04", description: "PIX", type: "income" })],
      [prov({ id: "t1", amount: 40, occurred_at: "2026-10-04", description: "Pix" })],
      TODAY,
    );
    expect(plan.matches).toHaveLength(0);
  });

  it("fora da janela de 4 dias não casa", () => {
    const plan = planReconciliation(
      [bank({ ordinal: 1, amount: 40, occurred_at: "2026-10-07", description: "LOJA" })],
      [prov({ id: "t1", amount: 40, occurred_at: "2026-10-01", description: "Loja" })],
      TODAY,
    );
    expect(plan.matches).toHaveLength(0);
  });
});

describe("contas do banco com os mesmos movimentos", () => {
  const items = (n: number) => Array.from({ length: n }, (_, i) =>
    bank({ ordinal: i, amount: 10 + i, occurred_at: "2026-10-0" + ((i % 6) + 1), description: `LOJA ${i}` }));

  it("descarta o lote inteiro quando a sobreposição é grande (mesma conta listada duas vezes)", () => {
    const r = dedupeAcrossAccounts([{ id: "a", items: items(10) }, { id: "b", items: items(10) }]);
    expect(r.batches[0].items).toHaveLength(10);
    expect(r.batches[1].items).toHaveLength(0);
    expect(r.overlaps).toEqual([{ kept: "a", dropped: "b", shared: 10 }]);
  });

  it("coincidências pontuais entre contas diferentes são mantidas", () => {
    const a = items(10);
    const b = [...items(1), ...Array.from({ length: 9 }, (_, i) => bank({ ordinal: 100 + i, amount: 500 + i, occurred_at: "2026-10-03", description: `OUTRA ${i}` }))];
    const r = dedupeAcrossAccounts([{ id: "a", items: a }, { id: "b", items: b }]);
    expect(r.batches[1].items).toHaveLength(10);
    expect(r.overlaps).toEqual([]);
  });
});
