import type { ToolContext } from "@lovable.dev/mcp-js";

export type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function requireUser(ctx: ToolContext): string | null {
  if (!ctx.isAuthenticated()) return null;
  return ctx.getUserId() ?? null;
}

export function ok(text: string, structured?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured };
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
