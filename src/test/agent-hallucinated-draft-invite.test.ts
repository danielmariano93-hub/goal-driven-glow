// Regressão do incidente 22/07/2026: o LLM devolvia o texto-template do
// rascunho ("Responda *CONFIRMAR*…") sem chamar create_transaction_draft,
// o usuário confirmava e o Agent Core respondia "Não encontrei nada pendente".
// Espelho puro de ResponseValidator.validate (idêntico ao Deno).
import { describe, it, expect } from "vitest";

const MAX = 4000;
const FRIENDLY = "Tive um problema para responder agora. Pode tentar novamente em instantes? 💛";
const DRAFT_LANGUAGE_RX = /\b(rascunho|proposta)\b.*\b(confirmar|confirma|registrar|registro|criar|criei|salvar)\b|\b(posso|vou|quer que eu)\s+(criar|crie|registrar|registre|salvar|salve)\b/i;
const CONFIRM_QUESTION_RX = /\b(voc[eê]\s+confirma|confirma\s*\?|posso\s+(registrar|lan[çc]ar|salvar|criar|anotar))\b/i;
const RECEIPT_LANGUAGE_RX = /(\b(?:despesa|receita|lan[çc]amento|transfer[eê]ncia|aporte|opera[çc][aã]o)\s+(?:foi\s+)?(?:registrad[ao]|salv[ao]|anotad[ao]|confirmad[ao]|criad[ao]|cadastrad[ao])\b)|(\b(?:registrad[ao]|salv[ao]|anotad[ao]|confirmad[ao])\b.*(?:✅|com sucesso))|(✅\s*$)/i;
const DRAFT_INVITE_RX = /(responda\s*\*?\s*confirmar\s*\*?)|(\*?\s*confirmar\s*\*?\s*para\s+(registrar|salvar|lan[çc]ar|criar|anotar))|(\bposso\s+(lan[çc]ar|registrar|salvar|criar|anotar)\b[^?]{0,80}\?)|(\bvou\s+(lan[çc]ar|registrar|salvar|criar|anotar)\b)/i;

type Ctx = { hasDraft?: boolean; hasSuccessfulMutation?: boolean; expectedKind?: string; toolCallErrors?: number };
function validate(raw: string, ctx: Ctx = {}) {
  const t = String(raw ?? "").trim();
  if (!t) return { action: "fallback_deterministic", body: FRIENDLY, reasons: ["empty_reply"] };
  if (ctx.expectedKind === "receipt" && ctx.hasDraft === false)
    return { action: "fallback_deterministic", body: FRIENDLY, reasons: ["receipt_without_draft"] };
  if (ctx.hasSuccessfulMutation === false && RECEIPT_LANGUAGE_RX.test(t))
    return { action: "fallback_deterministic", body: FRIENDLY, reasons: ["hallucinated_receipt"] };
  if (ctx.hasDraft === false && CONFIRM_QUESTION_RX.test(t))
    return { action: "fallback_deterministic", body: FRIENDLY, reasons: ["confirm_question_without_draft"] };
  if (ctx.hasSuccessfulMutation === false && DRAFT_INVITE_RX.test(t))
    return { action: "fallback_deterministic", body: FRIENDLY, reasons: ["hallucinated_draft_invite"] };
  if (ctx.hasDraft === false && DRAFT_LANGUAGE_RX.test(t))
    return { action: "fallback_deterministic", body: FRIENDLY, reasons: ["draft_language_without_draft"] };
  const errs = ctx.toolCallErrors ?? 0;
  if (errs >= 1 && RECEIPT_LANGUAGE_RX.test(t) && ctx.hasSuccessfulMutation === false)
    return { action: "fallback_deterministic", body: FRIENDLY, reasons: ["receipt_with_tool_errors"] };
  if (errs >= 2)
    return { action: "fallback_deterministic", body: FRIENDLY, reasons: ["too_many_tool_errors"] };
  return { action: "accept", body: t.length > MAX ? t.slice(0, MAX) : t, reasons: [] };
}

describe("ResponseValidator — draft-invite alucinado", () => {
  it("bloqueia o template completo do rascunho quando não houve mutação real", () => {
    const raw = "Despesa de R$ 33,89 na conta corrente Itaú — Alimentação em 2026-07-22. Responda *CONFIRMAR* para registrar ou *CANCELAR* para descartar.";
    const r = validate(raw, { hasSuccessfulMutation: false, hasDraft: false });
    expect(r.action).toBe("fallback_deterministic");
    // Pode disparar hallucinated_receipt OU hallucinated_draft_invite — ambos são aceitáveis.
    expect(["hallucinated_draft_invite", "hallucinated_receipt"]).toContain(r.reasons[0]);
  });

  it("bloqueia 'Posso lançar R$50 no Nubank?' sem mutação", () => {
    const r = validate("Posso lançar R$ 50,00 no Nubank?", { hasSuccessfulMutation: false, hasDraft: false });
    expect(r.action).toBe("fallback_deterministic");
    expect(["hallucinated_draft_invite", "confirm_question_without_draft"]).toContain(r.reasons[0]);
  });

  it("bloqueia 'Vou registrar R$30 alimentação' sem mutação", () => {
    const r = validate("Vou registrar R$ 30,00 alimentação hoje", { hasSuccessfulMutation: false, hasDraft: false });
    expect(r.action).toBe("fallback_deterministic");
    expect(r.reasons).toContain("hallucinated_draft_invite");
  });

  it("aceita o mesmo template quando o rascunho foi realmente criado", () => {
    const raw = "Despesa de R$ 33,89 na conta corrente Itaú — Alimentação em 2026-07-22. Responda *CONFIRMAR* para registrar ou *CANCELAR* para descartar.";
    const r = validate(raw, { hasSuccessfulMutation: true, hasDraft: true, expectedKind: "draft" });
    expect(r.action).toBe("accept");
  });

  it("recibo com 1 erro de tool cai em fallback (novo threshold)", () => {
    const r = validate("Despesa registrada ✅", { hasSuccessfulMutation: false, toolCallErrors: 1 });
    expect(r.action).toBe("fallback_deterministic");
    // Ordem: hallucinated_receipt dispara primeiro; se não disparasse, receipt_with_tool_errors também é válido.
    expect(["hallucinated_receipt", "receipt_with_tool_errors"]).toContain(r.reasons[0]);
  });
});
