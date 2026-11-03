// Open Finance de 03/11: 27 linhas "para revisar" eram, em grande parte, coisas já lançadas.
// Os cenários abaixo usam os valores reais do caso (rolê em lote, Pix de 2 parcelas, salário líquido, banco um dia depois).
import { describe, expect, it } from "vitest";
import { classifyBatch, findReceiptGroup, type DedupeInputItem, type ExistingTx } from "../../supabase/functions/_shared/import/dedupe";

let n = 0;
const tx = (o: Partial<ExistingTx> & { amount: number; occurred_at: string; type: string }): ExistingTx => ({ id: `t${++n}`, ...o });
const receipt = (amount: number, occurred_at: string) =>
  tx({ type: "income", amount, occurred_at, description: "Recebimento · Réveillon RJ", movement_kind: "external_transfer_in", split_transaction_role: "reimbursement" });
const bank = (o: Partial<DedupeInputItem> & { amount: number; type: string; occurred_at: string }): DedupeInputItem => ({ ordinal: ++n, ...o });

describe("Pix recebido que paga várias parcelas de rolê", () => {
  const settleAll = [151.04, 151.04, 151.04, 151.04, 151.05, 151.04].map((a) => receipt(a, "2026-10-27"));
  it("Pix de R$ 906,25 = 6 parcelas baixadas em lote (nome do pagador diferente do participante não importa)", () => {
    const [v] = classifyBatch([bank({ type: "income", amount: 906.25, occurred_at: "2026-10-27", description: "Pix recebido WELTON MENEZES DE ARAUJO", movement_kind: "external_transfer_in" })], settleAll);
    expect(v.status).toBe("probable_duplicate");
    expect(v.reason_code).toBe("reembolso_do_role_soma:n=6");
  });
  it("Pix de R$ 302,10 = 2 parcelas (centavo de arredondamento)", () => {
    const existing = [receipt(151.04, "2026-11-02"), receipt(151.05, "2026-11-02"), receipt(291.33, "2026-11-02")];
    const [v] = classifyBatch([bank({ type: "income", amount: 302.1, occurred_at: "2026-11-02", movement_kind: "external_transfer_in" })], existing);
    expect(v.status).toBe("probable_duplicate");
    expect(v.reason_code).toMatch(/^reembolso_do_role_soma:n=2/);
  });
  it("cada recebimento só absorve UM Pix: o segundo Pix igual fica como novo", () => {
    const items = [1, 2].map(() => bank({ type: "income", amount: 906.25, occurred_at: "2026-10-27", movement_kind: "external_transfer_in" }));
    const verdicts = classifyBatch(items, settleAll);
    expect(verdicts.map((v) => v.status)).toEqual(["probable_duplicate", "new"]);
  });
  it("valor que não fecha com nenhuma soma NÃO é casado (Roger: R$ 502 e R$ 50 contra baixas de R$ 442,38)", () => {
    const existing = [receipt(291.33, "2026-11-02"), receipt(151.05, "2026-11-02")];
    const out = classifyBatch([
      bank({ type: "income", amount: 502, occurred_at: "2026-11-01", movement_kind: "external_transfer_in" }),
      bank({ type: "income", amount: 50, occurred_at: "2026-11-01", movement_kind: "external_transfer_in" }),
    ], existing);
    expect(out.map((v) => v.status)).toEqual(["new", "new"]);
  });
  it("não junta recebimentos de fora da janela de dias nem sem o papel de rolê", () => {
    expect(classifyBatch([bank({ type: "income", amount: 302.1, occurred_at: "2026-11-02", movement_kind: "external_transfer_in" })],
      [receipt(151.05, "2026-10-20"), receipt(151.05, "2026-10-20")])[0].status).toBe("new");
    const plain = [151.05, 151.05].map((a) => tx({ type: "income", amount: a, occurred_at: "2026-11-02", movement_kind: "external_transfer_in" }));
    expect(classifyBatch([bank({ type: "income", amount: 302.1, occurred_at: "2026-11-02", movement_kind: "external_transfer_in" })], plain)[0].status).toBe("new");
  });
  it("findReceiptGroup: escolhe o menor grupo", () => {
    const g = findReceiptGroup([receipt(100, "d"), receipt(100, "d"), receipt(50, "d"), receipt(50, "d")], 200);
    expect(g?.length).toBe(2);
  });
});

describe("salário líquido de folha", () => {
  const gross = tx({ type: "income", amount: 8015.78, occurred_at: "2026-10-27", description: "Salário", movement_kind: "transaction" });
  const previdencia = tx({ type: "expense", amount: 334.88, occurred_at: "2026-10-27", description: "Aporte Previdência Privada (folha)", movement_kind: "investment_application" });
  it("R$ 7.681,54 no banco = bruto R$ 8.015,78 − aporte R$ 334,88 (dif. R$ 0,64)", () => {
    const [v] = classifyBatch([bank({ type: "income", amount: 7681.54, occurred_at: "2026-10-27", description: "Salário ITAU UNIBANCO S.A.", movement_kind: "external_transfer_in" })], [gross, previdencia]);
    expect(v.status).toBe("probable_duplicate");
    expect(v.reason_code).toBe("liquido_de_folha:dif=0.64");
  });
  it("sem o desconto em folha lançado, não inventa o casamento", () => {
    const [v] = classifyBatch([bank({ type: "income", amount: 7681.54, occurred_at: "2026-10-27", movement_kind: "external_transfer_in" })], [gross]);
    expect(v.status).toBe("new");
  });
});

describe("mesmo valor, banco um dia depois e com outro nome", () => {
  it("aluguel R$ 3.808,02 (boleto em 31/10 x 'Aluguel' em 30/10) vai para revisão como possível duplicata", () => {
    const [v] = classifyBatch([bank({ type: "expense", amount: 3808.02, occurred_at: "2026-10-31", description: "Pagamento de boleto L S PRADO INTERMED" })],
      [tx({ type: "expense", amount: 3808.02, occurred_at: "2026-10-30", description: "Aluguel", movement_kind: "transaction" })]);
    expect(v.status).toBe("probable_duplicate");
    expect(v.reason_code).toBe("janela_1d+valor_descricao_diferente");
  });
  it("abaixo de R$ 20 ou com 2+ dias de diferença continua novo (evita falso alarme)", () => {
    expect(classifyBatch([bank({ type: "expense", amount: 5.5, occurred_at: "2026-10-31", description: "99" })],
      [tx({ type: "expense", amount: 5.5, occurred_at: "2026-10-30", description: "Autopass" })])[0].status).toBe("new");
    expect(classifyBatch([bank({ type: "expense", amount: 49.95, occurred_at: "2026-11-01", description: "Pix" })],
      [tx({ type: "expense", amount: 49.95, occurred_at: "2026-10-30", description: "mercado livre" })])[0].status).toBe("new");
  });
});
