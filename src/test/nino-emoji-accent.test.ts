import { describe, expect, it } from "vitest";
import { addEmojiAccent, humanizeReply } from "../../supabase/functions/_shared/agent/core/ReplyHumanizer";

describe("acento de emoji nas respostas do Nino", () => {
  it("insere um emoji coerente quando a resposta não tem nenhum", () => {
    const out = addEmojiAccent("Sua fatura fecha em 25/08 com R$ 1.200.");
    expect(out.startsWith("💳 ")).toBe(true);
  });

  it("mantém a resposta quando já existe emoji", () => {
    const text = "📊 Você gastou R$ 300 esta semana.";
    expect(addEmojiAccent(text)).toBe(text);
  });

  it("corta excesso de emoji para no máximo 2", () => {
    const out = addEmojiAccent("💸 Gasto 🎯 alto 📊 hoje ⚠️ ok");
    const count = (out.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) ?? []).length;
    expect(count).toBeLessThanOrEqual(2);
  });

  it("não mexe em texto vazio", () => {
    expect(addEmojiAccent("")).toBe("");
    expect(humanizeReply("")).toBe("");
  });

  it("humanizeReply entrega emoji na resposta final", () => {
    const out = humanizeReply("Registrei o gasto de R$ 32 no mercado.");
    expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(out)).toBe(true);
  });
});
