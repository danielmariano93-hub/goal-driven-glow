// Cliente único para chamar Edge Functions respeitando o contrato de erro
// `edge_error.v1` (E7): falha nunca vira sucesso silencioso e o `request_id`
// fica disponível para suporte.
import { supabase } from "@/integrations/supabase/client";

export interface EdgeFailure {
  error_code: string;
  message: string;
  request_id: string | null;
  retryable: boolean;
  status: number | null;
  details?: unknown;
}

export interface EdgeResult<T> {
  data: T | null;
  failure: EdgeFailure | null;
}

const GENERIC = "Não consegui concluir agora. Tente novamente em instantes.";

/** Normaliza qualquer corpo de erro (contrato novo ou legado) em `EdgeFailure`. */
export function toEdgeFailure(body: unknown, status: number | null): EdgeFailure {
  const b = (body ?? {}) as Record<string, unknown>;
  const code = String(b.error_code ?? b.error ?? "internal");
  return {
    error_code: code,
    message: String(b.message ?? b.user_message ?? GENERIC),
    request_id: typeof b.request_id === "string" ? b.request_id : null,
    retryable: typeof b.retryable === "boolean" ? b.retryable : status !== null && status >= 500,
    status,
    details: b.details,
  };
}

/** Descrição pronta para toast, com o identificador de suporte quando existir. */
export function failureDescription(failure: EdgeFailure): string {
  const suffix = failure.request_id ? ` (ref. ${failure.request_id.slice(0, 8)})` : "";
  return `${failure.message}${suffix}`;
}

export async function invokeEdge<T>(fnName: string, body: unknown): Promise<EdgeResult<T>> {
  const { data, error } = await supabase.functions.invoke(fnName, { body });

  if (error) {
    const ctx = (error as { context?: Response }).context;
    let parsed: unknown = null;
    let status: number | null = null;
    if (ctx && typeof ctx.json === "function") {
      status = ctx.status ?? null;
      parsed = await ctx.json().catch(() => null);
    }
    return { data: null, failure: toEdgeFailure(parsed ?? { message: error.message }, status) };
  }

  const payload = data as Record<string, unknown> | null;
  if (payload && payload.ok === false) {
    return { data: null, failure: toEdgeFailure(payload, 200) };
  }
  return { data: (data as T) ?? null, failure: null };
}
