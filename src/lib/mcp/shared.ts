import type { ToolContext } from "@lovable.dev/mcp-js";
import { FINANCE_CONTRACT_VERSION } from "../engine/metrics";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** Contrato único de erro — o mesmo das Edge Functions (`edge_error.v1`). */
export const ERROR_CONTRACT_VERSION = "edge_error.v1";

const RETRYABLE_CODES = new Set([
  "internal",
  "timeout",
  "rate_limited",
  "upstream_unavailable",
]);

function newRequestId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `req_${Date.now().toString(36)}`;
  }
}

export function errorResult(message: string, errorCode = "internal"): ToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    structuredContent: {
      ok: false,
      contract: ERROR_CONTRACT_VERSION,
      error_code: errorCode,
      error: errorCode,
      message,
      retryable: RETRYABLE_CODES.has(errorCode),
      request_id: newRequestId(),
      finance_contract: FINANCE_CONTRACT_VERSION,
    },
  };
}

export function requireUser(ctx: ToolContext): string | null {
  if (!ctx.isAuthenticated()) return null;
  return ctx.getUserId() ?? null;
}

export function ok(text: string, structured?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent: {
      ok: true,
      request_id: newRequestId(),
      finance_contract: FINANCE_CONTRACT_VERSION,
      ...(structured ?? {}),
    },
  };
}

export function brl(value: number): string {
  return `R$ ${Number(value ?? 0).toFixed(2).replace(".", ",")}`;
}

/** Período (mês) no formato YYYY-MM → { from, to } inclusivo em datas ISO. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
