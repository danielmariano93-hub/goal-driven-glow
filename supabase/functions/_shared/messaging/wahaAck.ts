// Consulta de ACK na WAHA: antes de declarar uma mensagem como não entregue,
// perguntamos ao provedor qual o ACK real do `provider_message_id`.
// Sem resposta confiável do provedor, devolvemos "unknown" e o watchdog mantém
// o comportamento conservador (retry) em vez de inventar uma falha.
// deno-lint-ignore-file no-explicit-any

export type AckState = "unknown" | "pending" | "server" | "delivered" | "read" | "failed";

/** ACK numérico da WAHA/WhatsApp: -1 erro, 0 pendente, 1 servidor, 2 entregue, 3 lido. */
export function ackFromNumber(value: unknown): AckState {
  const n = Number(value);
  if (!Number.isFinite(n)) return "unknown";
  if (n < 0) return "failed";
  if (n === 0) return "pending";
  if (n === 1) return "server";
  if (n === 2) return "delivered";
  return "read";
}

export function ackFromPayload(payload: unknown): AckState {
  if (!payload || typeof payload !== "object") return "unknown";
  const row: any = Array.isArray(payload) ? payload[0] : payload;
  if (!row || typeof row !== "object") return "unknown";
  if (row.ack !== undefined && row.ack !== null) return ackFromNumber(row.ack);
  const name = String(row.ackName ?? row.status ?? "").toLowerCase();
  if (name.includes("read")) return "read";
  if (name.includes("deliver")) return "delivered";
  if (name.includes("server") || name.includes("sent")) return "server";
  if (name.includes("error") || name.includes("fail")) return "failed";
  if (name.includes("pending")) return "pending";
  return "unknown";
}

export function chatIdFromPhone(e164: string): string {
  return `${e164.replace(/^\+/, "").replace(/\D/g, "")}@c.us`;
}

export async function fetchWahaAck(opts: {
  apiUrl: string;
  apiKey: string;
  session: string;
  providerMessageId: string;
  toPhone: string;
  timeoutMs?: number;
}): Promise<AckState> {
  if (!opts.apiUrl || !opts.apiKey || !opts.providerMessageId) return "unknown";
  const chatId = chatIdFromPhone(opts.toPhone);
  const base = opts.apiUrl.replace(/\/$/, "");
  const candidates = [
    `${base}/api/${encodeURIComponent(opts.session)}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(opts.providerMessageId)}`,
    `${base}/api/${encodeURIComponent(opts.session)}/messages/${encodeURIComponent(opts.providerMessageId)}`,
  ];
  for (const url of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
    try {
      const res = await fetch(url, {
        headers: { "X-Api-Key": opts.apiKey, Accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) continue;
      const state = ackFromPayload(await res.json().catch(() => null));
      if (state !== "unknown") return state;
    } catch (_error) {
      // Rede/timeout: seguimos para o próximo formato de endpoint.
    } finally {
      clearTimeout(timer);
    }
  }
  return "unknown";
}
