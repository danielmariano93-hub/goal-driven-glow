// Cliente mínimo do Pluggy (somente leitura). Isola a API externa:
// trocar o endpoint de transações (o v1 está marcado como descontinuado pelo Pluggy,
// remoção prevista para 31/12/2026) afeta apenas `listTransactions`.
//
// Segurança: segredos só do ambiente (PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET);
// nunca logamos corpo de resposta, descrição, valor nem chave de API.
import type { PluggyTransaction } from "./pluggyAdapter.ts";

const BASE_URL = "https://api.pluggy.ai";
const TIMEOUT_MS = 20_000;
const PAGE_SIZE = 500;
const MAX_PAGES = 20;

export type PluggyErrorCode = "not_configured" | "auth_failed" | "not_found" | "rate_limited" | "upstream_unavailable";

export class PluggyError extends Error {
  constructor(public code: PluggyErrorCode, public status?: number) {
    super(code);
  }
}

export type PluggyAccount = {
  id: string;
  type: "BANK" | "CREDIT" | "OTHER";
  name: string | null;
  number: string | null;
  balance: number | null;
};

export type PluggyItemInfo = { status: string | null; lastUpdatedAt: string | null; connectorName: string | null };

export function pluggyConfigured(env: { get(key: string): string | undefined } = Deno.env): boolean {
  return Boolean(env.get("PLUGGY_CLIENT_ID") && env.get("PLUGGY_CLIENT_SECRET"));
}

/** Quais segredos faltam (só os NOMES, nunca os valores). */
export function pluggyMissingSecrets(env: { get(key: string): string | undefined } = Deno.env): string[] {
  return ["PLUGGY_CLIENT_ID", "PLUGGY_CLIENT_SECRET"].filter((name) => !String(env.get(name) ?? "").trim());
}

async function call(path: string, init: RequestInit & { apiKey?: string } = {}): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init.apiKey ? { "X-API-KEY": init.apiKey } : {}),
      },
    });
    if (res.status === 401 || res.status === 403) throw new PluggyError("auth_failed", res.status);
    if (res.status === 404) throw new PluggyError("not_found", 404);
    if (res.status === 429) throw new PluggyError("rate_limited", 429);
    if (!res.ok) throw new PluggyError("upstream_unavailable", res.status);
    return await res.json();
  } catch (error) {
    if (error instanceof PluggyError) throw error;
    throw new PluggyError("upstream_unavailable");
  } finally {
    clearTimeout(timer);
  }
}

export async function pluggyAuth(env: { get(key: string): string | undefined } = Deno.env): Promise<string> {
  const clientId = env.get("PLUGGY_CLIENT_ID");
  const clientSecret = env.get("PLUGGY_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new PluggyError("not_configured");
  const data = await call("/auth", { method: "POST", body: JSON.stringify({ clientId, clientSecret }) });
  const apiKey = String(data?.apiKey ?? "");
  if (!apiKey) throw new PluggyError("auth_failed");
  return apiKey;
}

export async function getItem(apiKey: string, itemId: string): Promise<PluggyItemInfo> {
  const data = await call(`/items/${encodeURIComponent(itemId)}`, { apiKey });
  return {
    status: data?.status ?? null,
    lastUpdatedAt: data?.lastUpdatedAt ?? data?.updatedAt ?? null,
    connectorName: data?.connector?.name ?? null,
  };
}

export async function listAccounts(apiKey: string, itemId: string): Promise<PluggyAccount[]> {
  const data = await call(`/accounts?itemId=${encodeURIComponent(itemId)}`, { apiKey });
  const results: any[] = Array.isArray(data?.results) ? data.results : [];
  return results.map((row) => ({
    id: String(row.id),
    type: row.type === "BANK" || row.type === "CREDIT" ? row.type : "OTHER",
    name: row.name ?? null,
    number: row.number ?? null,
    balance: Number.isFinite(Number(row.balance)) ? Number(row.balance) : null,
  })).filter((a) => a.id && a.id !== "undefined");
}

/** Todas as transações do período (paginado). `from`/`to` em yyyy-mm-dd. */
export async function listTransactions(apiKey: string, accountId: string, from: string, to: string): Promise<PluggyTransaction[]> {
  const out: PluggyTransaction[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = `accountId=${encodeURIComponent(accountId)}&from=${from}&to=${to}&pageSize=${PAGE_SIZE}&page=${page}`;
    const data = await call(`/transactions?${q}`, { apiKey });
    const results: PluggyTransaction[] = Array.isArray(data?.results) ? data.results : [];
    out.push(...results);
    const totalPages = Number(data?.totalPages ?? 1);
    if (page >= totalPages || results.length === 0) break;
  }
  return out;
}

/**
 * Token de curta duração (≈30 min) para abrir o widget Pluggy Connect no app.
 * `clientUserId` liga a conexão ao usuário do Nino; `itemId` reabre uma conexão existente.
 */
export async function createConnectToken(apiKey: string, opts: { clientUserId: string; itemId?: string }): Promise<string> {
  const body: Record<string, unknown> = { options: { clientUserId: opts.clientUserId } };
  if (opts.itemId) body.itemId = opts.itemId;
  const data = await call("/connect_token", { method: "POST", apiKey, body: JSON.stringify(body) });
  const token = String(data?.accessToken ?? data?.connectToken ?? "");
  if (!token) throw new PluggyError("auth_failed");
  return token;
}
