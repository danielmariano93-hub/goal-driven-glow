// MessagingProvider contract — provider-agnostic surface.
// The domain and edge functions depend on this, never on WAHA payload shapes.

export type NormalizedInbound = {
  provider: "waha" | "meta_cloud";
  provider_message_id: string;
  from_phone: string; // E.164
  to_phone?: string;
  body: string;
  from_bot: boolean;
  received_at: string; // ISO
};

export interface MessagingProvider {
  name: "waha" | "meta_cloud";
  configured: boolean;
  normalizeAddress(raw: string): string | null;
  sendText(to: string, body: string): Promise<{ provider_message_id: string }>;
  getHealth(): Promise<{ ok: boolean; latency_ms: number; error?: string }>;
  getSessionStatus(): Promise<{ status: string; error?: string }>;
  startSession?(): Promise<void>;
  stopSession?(): Promise<void>;
  verifyWebhookSecret(headers: Headers): boolean;
  mapInboundEvent(payload: unknown): NormalizedInbound | null;
}

/** Normalize a Brazilian phone number to E.164 (+55DDDNNNNNNNNN).
 *  Accepts a wide range of inputs — returns null when clearly invalid. */
export function normalizeBrPhone(raw: string): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D+/g, "");
  if (!digits) return null;
  let d = digits;
  // Strip international "00" prefix
  if (d.startsWith("00")) d = d.slice(2);
  // Strip country code
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  // Strip leading zero on national trunk
  if (d.startsWith("0")) d = d.replace(/^0+/, "");
  // Now expect DDD + subscriber (10 or 11 digits)
  if (d.length < 10 || d.length > 11) return null;
  // Ensure mobile 9-digit prefix when 10 digits and first subscriber digit >= 6
  if (d.length === 10 && /^[6-9]/.test(d.slice(2))) d = d.slice(0, 2) + "9" + d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  return "+55" + d;
}

export function maskPhone(e164: string): string {
  if (!e164) return "";
  const tail = e164.slice(-4);
  return `+55 (**) *****-${tail}`;
}
