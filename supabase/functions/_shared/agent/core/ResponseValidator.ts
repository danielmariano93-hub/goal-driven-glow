// ResponseValidator — final safety pass on outgoing replies.
// Currently: trim, cap length, coerce empty into the friendly fallback.
// PII/formatting rules can grow here without touching the pipeline.
const MAX_REPLY_LEN = 4000;
export const FRIENDLY_ORCHESTRATOR_ERROR =
  "Tive um problema para responder agora. Pode tentar novamente em instantes? 💛";

export function validateReply(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return FRIENDLY_ORCHESTRATOR_ERROR;
  return t.length > MAX_REPLY_LEN ? t.slice(0, MAX_REPLY_LEN) : t;
}
