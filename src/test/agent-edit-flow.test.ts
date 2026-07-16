// Testes conversacionais/estruturais para a edição de lançamentos pelo agente.
// Não chama LLM; valida contratos da tool draft_transaction_update via
// dinâmica dos campos aceitos e das mensagens amigáveis do formulário.
import { describe, it, expect } from "vitest";

// Espelha o mapeamento de erro do RPC → mensagem amigável em LancamentoDetalhe.
function mapRpcError(code: string | undefined): string {
  switch (code) {
    case "conflict": return "Este lançamento foi alterado em outro lugar. Recarregue e tente de novo.";
    case "not_owned": return "Lançamento não encontrado.";
    case "credit_card_required": return "Escolha um cartão para este lançamento.";
    case "account_required": return "Escolha uma conta para este lançamento.";
    case "invalid_payment_method": return "Método de pagamento inválido.";
    default: return "Não consegui salvar agora. Tente novamente em instantes.";
  }
}

// Espelha as regras de composição do patch no save() do formulário.
type Tx = { description: string | null; category_id: string | null; amount: number; occurred_at: string; notes: string | null; payment_method: "account"|"credit_card"; account_id: string | null; credit_card_id: string | null };
function buildPatch(tx: Tx, form: Tx & { paymentMethod: "account"|"credit_card"; accountId: string; cardId: string; description: string; categoryId: string; amount: string; occurredAt: string; notes: string }) {
  const patch: Record<string, unknown> = {};
  if ((tx.description ?? "") !== form.description) patch.description = form.description || null;
  if ((tx.category_id ?? "") !== form.categoryId) patch.category_id = form.categoryId || null;
  const parsedAmount = Number(String(form.amount).replace(",", "."));
  if (Number.isFinite(parsedAmount) && parsedAmount > 0 && parsedAmount !== Number(tx.amount)) patch.amount = parsedAmount;
  if (form.occurredAt && form.occurredAt !== tx.occurred_at) patch.occurred_at = form.occurredAt;
  if ((tx.notes ?? "") !== form.notes) patch.notes = form.notes || null;

  const originalMethod = tx.payment_method;
  if (form.paymentMethod !== originalMethod) {
    patch.payment_method = form.paymentMethod;
    if (form.paymentMethod === "account") { patch.account_id = form.accountId; patch.credit_card_id = null; }
    else { patch.credit_card_id = form.cardId; patch.account_id = null; }
  } else if (form.paymentMethod === "account" && form.accountId !== (tx.account_id ?? "")) {
    patch.account_id = form.accountId;
  } else if (form.paymentMethod === "credit_card" && form.cardId !== (tx.credit_card_id ?? "")) {
    patch.credit_card_id = form.cardId;
  }
  return patch;
}

describe("edição de lançamento — mensagens", () => {
  it("mapeia erros técnicos para mensagens amigáveis", () => {
    expect(mapRpcError("conflict")).toContain("alterado em outro lugar");
    expect(mapRpcError("account_required")).toContain("uma conta");
    expect(mapRpcError("credit_card_required")).toContain("um cartão");
    expect(mapRpcError("invalid_payment_method")).toBe("Método de pagamento inválido.");
    expect(mapRpcError(undefined)).toContain("Não consegui salvar");
  });
});

describe("edição de lançamento — composição de patch", () => {
  const base: Tx = {
    description: "Mercado", category_id: null, amount: 100, occurred_at: "2026-07-01",
    notes: null, payment_method: "account", account_id: "acc-1", credit_card_id: null,
  };

  it("só descrição/valor/nota compõem patch sem tocar em método", () => {
    const patch = buildPatch(base, {
      ...base, paymentMethod: "account", accountId: "acc-1", cardId: "",
      description: "Mercado do bairro", categoryId: "", amount: "120", occurredAt: "2026-07-01", notes: "compra semanal",
    });
    expect(patch).toEqual({ description: "Mercado do bairro", amount: 120, notes: "compra semanal" });
  });

  it("troca de conta preserva payment_method e não envia credit_card_id", () => {
    const patch = buildPatch(base, {
      ...base, paymentMethod: "account", accountId: "acc-2", cardId: "",
      description: base.description ?? "", categoryId: "", amount: String(base.amount), occurredAt: base.occurred_at, notes: base.notes ?? "",
    });
    expect(patch).toEqual({ account_id: "acc-2" });
    expect(patch).not.toHaveProperty("payment_method");
    expect(patch).not.toHaveProperty("credit_card_id");
  });

  it("mudar de conta para cartão envia payment_method + credit_card_id e limpa account_id", () => {
    const patch = buildPatch(base, {
      ...base, paymentMethod: "credit_card", accountId: "", cardId: "card-9",
      description: base.description ?? "", categoryId: "", amount: String(base.amount), occurredAt: base.occurred_at, notes: base.notes ?? "",
    });
    expect(patch).toMatchObject({ payment_method: "credit_card", credit_card_id: "card-9", account_id: null });
  });

  it("mudar de cartão para conta envia payment_method + account_id e limpa credit_card_id", () => {
    const card: Tx = { ...base, payment_method: "credit_card", account_id: null, credit_card_id: "card-1" };
    const patch = buildPatch(card, {
      ...card, paymentMethod: "account", accountId: "acc-3", cardId: "card-1",
      description: card.description ?? "", categoryId: "", amount: String(card.amount), occurredAt: card.occurred_at, notes: card.notes ?? "",
    });
    expect(patch).toMatchObject({ payment_method: "account", account_id: "acc-3", credit_card_id: null });
  });

  it("categoria vazia vira null (limpar)", () => {
    const withCat: Tx = { ...base, category_id: "cat-1" };
    const patch = buildPatch(withCat, {
      ...withCat, paymentMethod: "account", accountId: "acc-1", cardId: "",
      description: withCat.description ?? "", categoryId: "", amount: String(withCat.amount), occurredAt: withCat.occurred_at, notes: withCat.notes ?? "",
    });
    expect(patch).toEqual({ category_id: null });
  });
});

// Descrições "só método" devem ser rejeitadas antes de virar rascunho.
describe("descrição x método de pagamento", () => {
  const METHOD_ONLY = new Set(["credito","debito","pix","dinheiro","cartao","boleto","transferencia","ted","doc","fatura"]);
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
  it("bloqueia descrições que são só meio de pagamento", () => {
    for (const t of ["crédito","Crédito","PIX","cartão","boleto","transferência"]) {
      expect(METHOD_ONLY.has(norm(t))).toBe(true);
    }
  });
  it("aceita descrições reais", () => {
    for (const t of ["mercado","VPS","almoço no bar","gasolina"]) {
      expect(METHOD_ONLY.has(norm(t))).toBe(false);
    }
  });
});
