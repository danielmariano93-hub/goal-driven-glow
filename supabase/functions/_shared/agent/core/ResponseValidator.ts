// ResponseValidator — final safety pass on outgoing replies.
// - `validateReply(raw)` : string-in/string-out (used by AgentCore; behaviour
//   unchanged from Fase 1 so existing tests stay green).
// - `validate(reply, ctx)` : structured result with an action hint so higher
//   layers can decide to accept, regenerate once, or drop to deterministic
//   fallback. This is additive.
// deno-lint-ignore-file no-explicit-any
const MAX_REPLY_LEN = 4000;
export const FRIENDLY_ORCHESTRATOR_ERROR =
  "Tive um problema para responder agora. Pode tentar novamente em instantes? 💛";

export function validateReply(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return FRIENDLY_ORCHESTRATOR_ERROR;
  return t.length > MAX_REPLY_LEN ? t.slice(0, MAX_REPLY_LEN) : t;
}

export type ValidationAction = "accept" | "regenerate" | "fallback_deterministic";

export type ValidationResult = {
  action: ValidationAction;
  body: string;
  reasons: string[];
};

export type ValidationContext = {
  hasDraft?: boolean;
  expectedKind?: "receipt" | "draft" | "question" | "info" | "cancelled" | "expired";
  toolCallErrors?: number;
  /** True quando existe ≥1 tool call bem-sucedida que cria rascunho OU confirma
   *  uma pendência neste mesmo turno. Usado para bloquear alucinação de recibo. */
  hasSuccessfulMutation?: boolean;
};

const DRAFT_LANGUAGE_RX = /\b(rascunho|proposta)\b.*\b(confirmar|confirma|registrar|registro|criar|criei|salvar)\b|\b(posso|vou|quer que eu)\s+(criar|crie|registrar|registre|salvar|salve)\b/i;

// "Você confirma?", "confirma?", "posso registrar/lançar/salvar?".
// Sinaliza que o LLM pediu confirmação — nesse caso PRECISA existir um rascunho.
const CONFIRM_QUESTION_RX = /\b(voc[eê]\s+confirma|confirma\s*\?|posso\s+(registrar|lan[çc]ar|salvar|criar|anotar))\b/i;

// Frases que afirmam sucesso ("Despesa registrada ✅", "salvo com sucesso",
// "anotado", "confirmado"). Se aparecerem sem uma mutation real neste turno,
// é alucinação e cai no fallback determinístico.
const RECEIPT_LANGUAGE_RX = /(\b(?:despesa|receita|lan[çc]amento|transfer[eê]ncia|aporte|opera[çc][aã]o)\s+(?:foi\s+)?(?:registrad[ao]|salv[ao]|anotad[ao]|confirmad[ao]|criad[ao]|cadastrad[ao])\b)|(\b(?:registrad[ao]|salv[ao]|anotad[ao]|confirmad[ao])\b.*(?:✅|com sucesso))|(✅\s*$)/i;

export function validate(raw: string, ctx: ValidationContext = {}): ValidationResult {
  const reasons: string[] = [];
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    reasons.push("empty_reply");
    return { action: "fallback_deterministic", body: FRIENDLY_ORCHESTRATOR_ERROR, reasons };
  }
  // Detect malformed JSON leaks (assistant returning raw JSON blob)
  if (/^\s*[\[{]/.test(trimmed) && trimmed.length > 40) {
    try { JSON.parse(trimmed); reasons.push("json_leak"); }
    catch { reasons.push("malformed_json_leak"); }
    return { action: "regenerate", body: trimmed.slice(0, MAX_REPLY_LEN), reasons };
  }
  // Receipt without a draft is inconsistent
  if (ctx.expectedKind === "receipt" && ctx.hasDraft === false) {
    reasons.push("receipt_without_draft");
    return { action: "fallback_deterministic", body: FRIENDLY_ORCHESTRATOR_ERROR, reasons };
  }
  // Recibo alucinado: fala como se tivesse salvo mas nenhuma tool de mutação
  // rodou. Bloqueia mesmo quando expectedKind ficou como "info".
  if (ctx.hasSuccessfulMutation === false && RECEIPT_LANGUAGE_RX.test(trimmed)) {
    reasons.push("hallucinated_receipt");
    return { action: "fallback_deterministic", body: FRIENDLY_ORCHESTRATOR_ERROR, reasons };
  }
  // Pediu confirmação sem ter criado o rascunho: força o caminho determinístico
  // que sabe montar o draft a partir de mensagens estruturadas.
  if (ctx.hasDraft === false && CONFIRM_QUESTION_RX.test(trimmed)) {
    reasons.push("confirm_question_without_draft");
    return { action: "fallback_deterministic", body: FRIENDLY_ORCHESTRATOR_ERROR, reasons };
  }
  if (ctx.hasDraft === false && DRAFT_LANGUAGE_RX.test(trimmed)) {
    reasons.push("draft_language_without_draft");
    return { action: "fallback_deterministic", body: FRIENDLY_ORCHESTRATOR_ERROR, reasons };
  }
  // Too many tool failures — mistrust the reply and fall back
  if ((ctx.toolCallErrors ?? 0) >= 2) {
    reasons.push("too_many_tool_errors");
    return { action: "fallback_deterministic", body: FRIENDLY_ORCHESTRATOR_ERROR, reasons };
  }
  const body = trimmed.length > MAX_REPLY_LEN ? trimmed.slice(0, MAX_REPLY_LEN) : trimmed;
  return { action: "accept", body, reasons };
}
