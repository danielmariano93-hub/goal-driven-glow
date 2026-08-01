// CONTRATO ÚNICO DE RESPOSTA HTTP DAS EDGE FUNCTIONS (E7 — D11).
// ===============================================================
// Regras não negociáveis:
//  1. Toda resposta carrega `request_id` (do header `x-request-id` ou gerado).
//  2. Falha SEMPRE responde `ok:false` + `error_code` + `retryable` + mensagem
//     em pt-BR. NUNCA `ok:true` em falha — sobretudo em fluxo financeiro.
//  3. Falha 5xx e falha financeira são persistidas em `public.edge_incidents`
//     para rastreabilidade pelo mesmo `request_id` mostrado ao usuário.
//  4. `error` continua no corpo por compatibilidade com clientes existentes e
//     tem exatamente o mesmo valor de `error_code`.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "./cors.ts";

export const ERROR_CONTRACT_VERSION = "edge_error.v1";

/** Códigos que valem uma nova tentativa do cliente (transitórios). */
export const RETRYABLE_CODES = new Set<string>([
  "internal",
  "rate_limited",
  "timeout",
  "upstream_unavailable",
  "signed_url_failed",
  "insert_failed",
  "update_failed",
  "storage_unavailable",
  "ai_unavailable",
]);

/** Códigos de fluxo financeiro — incidente é sempre persistido. */
export const FINANCIAL_ERROR_CODES = new Set<string>([
  "atomic_confirmation_failed",
  "reconciliation_failed",
  "invoice_coverage_failed",
  "statement_payment_failed",
  "invalid_invoice_total",
  "commit_movement_failed",
]);

const USER_MESSAGES: Record<string, string> = {
  unauthorized: "Sua sessão expirou. Entre novamente para continuar.",
  forbidden: "Você não tem permissão para esta ação.",
  method_not_allowed: "Requisição inválida.",
  invalid_json: "Não consegui ler os dados enviados. Tente de novo.",
  missing_fields: "Faltam informações obrigatórias.",
  not_found: "Não encontrei este registro.",
  rate_limited: "Muitas tentativas em pouco tempo. Aguarde alguns instantes.",
  payload_too_large: "O arquivo ou mensagem é grande demais.",
  internal: "Algo deu errado do nosso lado. Já registramos e você pode tentar novamente.",
  atomic_confirmation_failed: "Não salvei nada: a confirmação da fatura falhou e foi desfeita por inteiro.",
  reconciliation_failed: "Os valores não fecharam. Revise a fatura antes de confirmar.",
  invalid_invoice_total: "O total informado da fatura não é válido.",
  partial_success: "Parte do lote não foi concluída. Já registramos os itens que falharam.",
};

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function requestIdOf(req: Request): string {
  const fromHeader = req.headers.get("x-request-id") ?? req.headers.get("x-correlation-id");
  return fromHeader && fromHeader.length <= 100 ? fromHeader : newRequestId();
}

export function isRetryable(code: string): boolean {
  return RETRYABLE_CODES.has(code);
}

export function userMessageFor(code: string, fallback?: string): string {
  return USER_MESSAGES[code] ?? fallback ?? "Não consegui concluir agora. Tente novamente em instantes.";
}

function headersFor(requestId: string, extra: Record<string, string> = {}) {
  return { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId, ...extra };
}

export interface RespondOptions {
  status?: number;
  requestId?: string;
  headers?: Record<string, string>;
}

/** Resposta de sucesso: `ok:true` + `request_id`. */
export function respond(body: Record<string, unknown>, opts: RespondOptions = {}): Response {
  const requestId = opts.requestId ?? newRequestId();
  return new Response(
    JSON.stringify({ ok: true, request_id: requestId, ...body }),
    { status: opts.status ?? 200, headers: headersFor(requestId, opts.headers) },
  );
}

export interface FailOptions {
  status?: number;
  requestId?: string;
  functionName?: string;
  userId?: string | null;
  details?: Record<string, unknown>;
  message?: string;
  retryable?: boolean;
  /** cabeçalhos extras (ex.: auditoria de break-glass) */
  headers?: Record<string, string>;
  /** força (ou desliga) a persistência do incidente */
  persist?: boolean;
}

async function persistIncident(args: {
  requestId: string;
  functionName: string;
  errorCode: string;
  status: number;
  retryable: boolean;
  userId?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return;
  try {
    const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    await svc.from("edge_incidents").insert({
      request_id: args.requestId,
      function_name: args.functionName,
      error_code: args.errorCode,
      http_status: args.status,
      retryable: args.retryable,
      user_id: args.userId ?? null,
      details: args.details ?? {},
    });
  } catch (_e) {
    // observabilidade nunca derruba a resposta de erro
  }
}

/**
 * Resposta de falha padronizada. Persiste incidente em 5xx e em qualquer
 * código financeiro, independentemente do status.
 */
export function fail(errorCode: string, opts: FailOptions = {}): Response {
  const status = opts.status ?? 500;
  const requestId = opts.requestId ?? newRequestId();
  const retryable = opts.retryable ?? isRetryable(errorCode);
  const functionName = opts.functionName ?? "unknown";
  const shouldPersist = opts.persist ?? (status >= 500 || FINANCIAL_ERROR_CODES.has(errorCode));

  if (shouldPersist) {
    const task = persistIncident({
      requestId, functionName, errorCode, status, retryable,
      userId: opts.userId, details: opts.details,
    });
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(task);
    else void task;
  }

  return new Response(
    JSON.stringify({
      ok: false,
      error: errorCode,
      error_code: errorCode,
      retryable,
      request_id: requestId,
      message: opts.message ?? userMessageFor(errorCode),
      contract: ERROR_CONTRACT_VERSION,
      ...(opts.details ? { details: opts.details } : {}),
    }),
    { status, headers: headersFor(requestId, opts.headers) },
  );
}

export interface PartialOptions {
  requestId?: string;
  functionName?: string;
  status?: number;
  headers?: Record<string, string>;
  userId?: string | null;
  errorCode?: string;
}

/**
 * Resposta de lote: `ok` só é `true` quando NADA falhou. Havendo falhas,
 * `partial_success:true` + `failed[]` e o incidente é persistido para
 * rastreabilidade — nunca sucesso silencioso em entrega ou finanças.
 */
export function respondPartial(
  body: Record<string, unknown>,
  failed: unknown[],
  opts: PartialOptions = {},
): Response {
  const requestId = opts.requestId ?? newRequestId();
  const hasFailures = failed.length > 0;
  const errorCode = opts.errorCode ?? "partial_success";

  if (hasFailures) {
    const task = persistIncident({
      requestId,
      functionName: opts.functionName ?? "unknown",
      errorCode,
      status: opts.status ?? 200,
      retryable: true,
      userId: opts.userId ?? null,
      details: { failed: failed.slice(0, 20), failed_count: failed.length },
    });
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(task);
    else void task;
  }

  return new Response(
    JSON.stringify({
      ok: !hasFailures,
      partial_success: hasFailures,
      failed,
      failed_count: failed.length,
      request_id: requestId,
      contract: ERROR_CONTRACT_VERSION,
      ...(hasFailures ? { error: errorCode, error_code: errorCode, retryable: true } : {}),
      ...body,
    }),
    { status: opts.status ?? 200, headers: headersFor(requestId, opts.headers) },
  );
}

/** Fábrica com nome da função e request_id fixos por requisição. */
export function httpContext(functionName: string, req: Request) {
  const requestId = requestIdOf(req);
  return {
    requestId,
    ok: (body: Record<string, unknown>, status = 200, headers?: Record<string, string>) =>
      respond(body, { requestId, status, headers }),
    fail: (errorCode: string, status = 500, opts: Omit<FailOptions, "requestId" | "functionName" | "status"> = {}) =>
      fail(errorCode, { ...opts, status, requestId, functionName }),
    partial: (body: Record<string, unknown>, failed: unknown[], opts: Omit<PartialOptions, "requestId" | "functionName"> = {}) =>
      respondPartial(body, failed, { ...opts, requestId, functionName }),
    /** resposta bruta (não-envelopada) mantendo `x-request-id` — usada por download/JSON-RPC */
    raw: (payload: string, status = 200, headers: Record<string, string> = {}) =>
      new Response(payload, { status, headers: headersFor(requestId, headers) }),
  };
}

