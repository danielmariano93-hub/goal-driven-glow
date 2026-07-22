// Cobre o guardrail que impede o LLM de "confirmar" um lançamento
// sem ter chamado nenhuma tool de mutação neste mesmo turno.
import { describe, it, expect } from "vitest";

// Espelho puro da função `validate` de supabase/functions/_shared/agent/core/ResponseValidator.ts.
// Mantido em sincronia manual porque o módulo original importa runtime Deno.
const MAX = 4000;
const FRIENDLY = "Tive um problema para responder agora. Pode tentar novamente em instantes? 💛";
const DRAFT_LANGUAGE_RX = /\b(rascunho|proposta)\b.*\b(confirmar|confirma|registrar|registro|criar|criei|salvar)\b|\b(posso|vou|quer que eu)\s+(criar|crie|registrar|registre|salvar|salve)\b/i;
const CONFIRM_QUESTION_RX = /\b(voc[eê]\s+confirma|confirma\s*\?|posso\s+(registrar|lan[çc]ar|salvar|criar|anotar))\b/i;
const RECEIPT_LANGUAGE_RX = /(\b(?:despesa|receita|lan[çc]amento|transfer[eê]ncia|aporte|opera[çc][aã]o)\s+(?:foi\s+)?(?:registrad[ao]|salv[ao]|anotad[ao]|confirmad[ao]|criad[ao]|cadastrad[ao])\b)|(\b(?:registrad[ao]|salv[ao]|anotad[ao]|confirmad[ao])\b.*(?:✅|com sucesso))|(✅\s*$)/i;

function validate(raw: string, ctx: { hasDraft?: boolean; hasSuccessfulMutation?: boolean; expectedKind?: string; toolCallErrors?: number } = {}) {
  const t = String(raw ?? "").trim();
  if (!t) return { action: "fallback_deterministic", body: FRIENDLY, reasons: ["empty_reply"] };
  if (ctx.expectedKind === "receipt" && ctx.hasDraft === false) {
    return { action: "fallback_deterministic", body: FRIENDLY, reasons: ["receipt_without_draft"] };
  }
  if (ctx.hasSuccessfulMutation === false && RECEIPT_LANGUAGE_RX.test(t)) {
    return { action: "fallback_deterministic", body: FRIENDLY, reasons: ["hallucinated_receipt"] };
  }
  if (ctx.hasDraft === false && CONFIRM_QUESTION_RX.test(t)) {
    return { action: "fallback_deterministic", body: FRIENDLY, reasons: ["confirm_question_without_draft"] };
  }
  if (ctx.hasDraft === false && DRAFT_LANGUAGE_RX.test(t)) {
    return { action: "fallback_deterministic", body: FRIENDLY, reasons: ["draft_language_without_draft"] };
  }
  if ((ctx.toolCallErrors ?? 0) >= 2) return { action: "fallback_deterministic", body: FRIENDLY, reasons: ["too_many_tool_errors"] };
  return { action: "accept", body: t.length > MAX ? t.slice(0, MAX) : t, reasons: [] };
}

describe("ResponseValidator — anti-alucinação", () => {
  it("bloqueia 'Despesa registrada ✅' sem nenhuma mutação bem-sucedida", () => {
    const r = validate("Despesa registrada: R$ 30,00. ✅", { hasSuccessfulMutation: false, hasDraft: false });
    expect(r.action).toBe("fallback_deterministic");
    expect(r.reasons).toContain("hallucinated_receipt");
  });

  it("bloqueia 'Você confirma?' quando não existe rascunho ainda", () => {
    const r = validate("Despesa de R$ 30,00 na sua Conta Corrente Itaú. Você confirma?", { hasDraft: false, hasSuccessfulMutation: false });
    expect(r.action).toBe("fallback_deterministic");
    // O guardrail de recibo pode disparar antes do de confirmação; ambos são aceitáveis.
    expect(["confirm_question_without_draft", "hallucinated_receipt"]).toContain(r.reasons[0]);
  });

  it("aceita recibo quando a mutação de fato aconteceu", () => {
    const r = validate("Despesa registrada: R$ 30,00. ✅", { hasSuccessfulMutation: true, hasDraft: true, expectedKind: "receipt" });
    expect(r.action).toBe("accept");
  });

  it("não bloqueia respostas informativas neutras", () => {
    const r = validate("Neste mês: entradas R$ 100,00, saídas R$ 50,00.", { hasSuccessfulMutation: false });
    expect(r.action).toBe("accept");
  });
});
