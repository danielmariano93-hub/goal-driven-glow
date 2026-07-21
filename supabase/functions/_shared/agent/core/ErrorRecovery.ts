// ErrorRecovery — centralised classification + friendly messaging.
// Wraps risky async work with `guard`; classifies known transient errors as
// retryable so ToolRuntime and higher layers can decide what to do.
// deno-lint-ignore-file no-explicit-any
import { FRIENDLY_ORCHESTRATOR_ERROR } from "./ResponseValidator.ts";

export type ErrorClass = "transient" | "validation" | "permission" | "not_found" | "unknown";

export function classifyError(e: unknown): ErrorClass {
  const s = String((e as any)?.message ?? e ?? "").toLowerCase();
  if (!s) return "unknown";
  if (/timeout|abort|fetch failed|econnreset|econnrefused|gateway_5\d\d|429|rate limit/.test(s)) return "transient";
  if (/invalid|missing|schema|required|malformed|bad_json/.test(s)) return "validation";
  if (/forbidden|unauthorized|not allowed|permission|rls/.test(s)) return "permission";
  if (/not_found|no rows|does not exist/.test(s)) return "not_found";
  return "unknown";
}

export function isRetryable(e: unknown): boolean {
  return classifyError(e) === "transient";
}

export function friendlyFor(e: unknown): string {
  switch (classifyError(e)) {
    case "permission": return "Não consegui autorizar essa operação. Verifique se sua conta está ativa e tente de novo.";
    case "not_found":  return "Não encontrei os dados necessários para responder. Pode me dar mais contexto?";
    case "validation": return "Faltou alguma informação para completar. Pode me repetir com mais detalhes?";
    case "transient":  return "Estou com dificuldade temporária para responder. Pode tentar novamente em instantes? 💛";
    default:            return FRIENDLY_ORCHESTRATOR_ERROR;
  }
}

/** Runs `fn`; on error returns the fallback value while capturing the message. */
export async function guard<T>(
  fn: () => Promise<T>,
  onError: (msg: string) => void,
  fallback: T,
): Promise<T> {
  try { return await fn(); }
  catch (e) {
    const msg = String((e as any)?.message ?? e ?? "unknown_error").slice(0, 200);
    onError(msg);
    return fallback;
  }
}
