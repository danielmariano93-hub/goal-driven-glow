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
};

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
  // Too many tool failures — mistrust the reply and fall back
  if ((ctx.toolCallErrors ?? 0) >= 2) {
    reasons.push("too_many_tool_errors");
    return { action: "fallback_deterministic", body: FRIENDLY_ORCHESTRATOR_ERROR, reasons };
  }
  const body = trimmed.length > MAX_REPLY_LEN ? trimmed.slice(0, MAX_REPLY_LEN) : trimmed;
  return { action: "accept", body, reasons };
}
