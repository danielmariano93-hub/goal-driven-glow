import { describe, expect, it } from "vitest";
import { renderDraftCard, renderReceiptCard, renderUpdateCard } from "../../supabase/functions/_shared/agent/core/DraftCard.ts";
import { extractMerchantFromText } from "../../supabase/functions/_shared/agent/tools.ts";
import { findBrokenPhrases, humanizeReply } from "../../supabase/functions/_shared/agent/core/ReplyHumanizer.ts";

describe("cartão determinístico do rascunho", () => {
  const base = {
    kind: "expense" as const,
    amount: 96,
    description: "Adega",
    category: null,
    category_status: "auto_later" as const,
    account: "Itaú",
    occurred_at: "2026-08-15",
  };

  it("nunca apresenta estabelecimento como categoria", () => {
    const card = renderDraftCard(base, "seed-1");
    expect(card).toMatch(/\*Descrição:\* Adega/);
    expect(card).toMatch(/\*Categoria:\* eu classifico depois/);
    expect(card).not.toMatch(/\*Categoria:\* Adega/);
  });

  it("mostra valor e data em formato brasileiro e layout íntegro", () => {
    const card = humanizeReply(renderDraftCard(base, "seed-2"));
    expect(card).toMatch(/R\$\s?96,00/);
    expect(card).toMatch(/15\/08\/2026/);
    expect(findBrokenPhrases(card)).toEqual([]);
  });

  it("recibo ecoa o que ficou salvo", () => {
    const receipt = humanizeReply(renderReceiptCard({ ...base, category: "Lazer" }, "seed-3"));
    expect(receipt).toMatch(/R\$\s?96,00/);
    expect(receipt).toMatch(/Adega/);
    expect(findBrokenPhrases(receipt)).toEqual([]);
  });

  it("cartão de edição usa rótulos humanos, não colunas do banco", () => {
    const card = humanizeReply(renderUpdateCard(
      [{ field: "category_id", from: null, to: "Lazer" }, { field: "description", from: "crédito", to: "Adega" }],
      "one",
      "seed-4",
    ));
    expect(card).toMatch(/\*Categoria:\* Lazer/);
    expect(card).toMatch(/\*Descrição:\*/);
    expect(card).not.toMatch(/category_id|patch=|=\{/);
    expect(findBrokenPhrases(card)).toEqual([]);
  });
});

describe("estabelecimento extraído da fala", () => {
  it("pega o local e não a data nem o meio de pagamento", () => {
    expect(extractMerchantFromText("gasto de 96 em 15/08 em adega")?.toLowerCase()).toBe("adega");
    expect(extractMerchantFromText("paguei 40 no posto")?.toLowerCase()).toBe("posto");
    expect(extractMerchantFromText("gastei 30 no crédito")).toBeNull();
  });
});

describe("layout amigável no WhatsApp", () => {
  it("quebra lista colada com asterisco e solta a pergunta final", () => {
    const out = humanizeReply("Rascunhei aqui: * Despesa: R$ 96,00 * Data: 15/08/2026 Posso registrar?");
    expect(out).toMatch(/\n• /);
    expect(out).toMatch(/\n\nPosso registrar\?/);
    expect(findBrokenPhrases(out)).toEqual([]);
  });

  it("não transforma hífen de prosa em bullet", () => {
    const out = humanizeReply("Você gastou R$ 10,00 - foi pouco.");
    expect(out).not.toMatch(/•/);
  });
});
