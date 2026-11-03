import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NON_CONSUMPTION_CATEGORY_SOURCE, isConsumptionCategoryName } from "@/lib/engine/facts";

const sql = readFileSync("supabase/migrations/20261103210000_pix_categorized_consumption_robust.sql", "utf8");
const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("Pix categorizado conta como gasto (pix_consumption.v2)", () => {
  it("a promoção roda DEPOIS dos outros gatilhos que mexem em movement_kind (importação de documento reescreve)", () => {
    expect(code).toMatch(/create trigger trg_zz_promote_categorized_transfer\s+before insert or update of category_id on public\.transactions/);
    // ordem alfabética dos BEFORE INSERT: tem de vir depois de quem reescreve movement_kind na importação
    expect("trg_zz_promote_categorized_transfer" > "trg_fill_import_transaction_metadata").toBe(true);
    expect("trg_zz_promote_categorized_transfer" > "trg_transactions_validate_posted_at").toBe(true);
    expect(code).toMatch(/drop trigger if exists transactions_01_promote_categorized_transfer/);
  });
  it("só promove categoria de consumo e desfaz quando a categoria deixa de ser de consumo", () => {
    expect(code).toMatch(/public\.category_is_consumption\(new\.category_id\)/);
    expect(code).toMatch(/new\.movement_kind := 'transaction';\s+new\.promoted_from_transfer := true;/);
    expect(code).toMatch(/new\.movement_kind := 'external_transfer_out';\s+new\.promoted_from_transfer := false;/);
    // editar só o tipo do movimento nunca é desfeito: o gatilho só dispara na categoria
    expect(code).toMatch(/before insert or update of category_id/);
  });
  it("a migração não altera lançamentos de ninguém (o ajuste dos dados do dono é à parte)", () => {
    expect(code).not.toMatch(/^\s*update\s+public\.transactions/im);
  });
  it("SQL e TypeScript usam a mesma lista de categorias fora do consumo", () => {
    expect(sql).toContain(NON_CONSUMPTION_CATEGORY_SOURCE.replace(/^\(/, "'(").replace(/\)$/, ")'"));
  });
  it("categorias reais: consumo livre conta; dívida, divisão, fatura, aplicação e transferência não", () => {
    for (const [name, slug] of [["Lazer", "lazer"], ["Transporte", "transporte"], ["Alimentação", "alimentacao"], ["Moradia", "moradia"], ["Dízimo", "dizimo-088920"], ["Presentes", "presentes"], ["Outros", "outros"]]) {
      expect(isConsumptionCategoryName(name, slug), name).toBe(true);
    }
    for (const [name, slug] of [["Dívidas e empréstimos", "dividas-e-emprestimos-088920"], ["Divisão do Rolê", "divisao-do-role-088920"], ["Fatura Cartão", "fatura-cartao-088920"], ["Pagamento de Fatura", "pagamento-de-fatura-9055e4"], ["Aplicações", "aplicacoes-e-resgates"], ["Transferências", "transferencias"], ["Reembolso", "reembolso"]]) {
      expect(isConsumptionCategoryName(name, slug), name).toBe(false);
    }
  });
});
