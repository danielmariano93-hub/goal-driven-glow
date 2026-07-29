// Resolve identificadores `@lid` (WAHA/Baileys 2026.x) para o telefone real.
//
// A partir da atualização do WAHA, os eventos de mensagem podem chegar apenas
// com o identificador interno do WhatsApp (`<id>@lid`), sem o JID de telefone.
// Sem resolver isso, o webhook não consegue achar o vínculo do usuário e o
// Nino nunca responde.
//
// Estratégia (nesta ordem):
//  1. cache local em `whatsapp_lid_map`;
//  2. API do provedor: GET {api_url}/api/{session}/lids/{lid} -> { lid, pn };
//  3. falha silenciosa e sanitizada (o webhook registra o drop).
import { getWahaAccess } from "./waha.ts";
import { normalizeBrPhone } from "./types.ts";
import { assertPublicHttpsUrl } from "../security/ssrf.ts";

type Sb = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: unknown }> };
    };
    upsert: (row: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<{ error: unknown }>;
  };
};

export function maskLid(lid: string): string {
  const local = lid.split("@")[0] ?? "";
  if (local.length <= 4) return `***@lid`;
  return `***${local.slice(-4)}@lid`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 6_000): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: c.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Consulta a API do WAHA. Retorna o telefone normalizado (+55...) ou null. */
export async function resolveLidFromProvider(lid: string): Promise<string | null> {
  const { api_url, api_key, session } = getWahaAccess();
  if (!api_url || !api_key || !session) return null;
  const url = `${api_url.replace(/\/+$/, "")}/api/${encodeURIComponent(session)}/lids/${encodeURIComponent(lid)}`;
  const guard = assertPublicHttpsUrl(url);
  if (!guard.ok) {
    console.warn("[lidResolver] blocked_url", guard.code);
    return null;
  }
  try {
    const r = await fetchWithTimeout(url, {
      headers: { accept: "application/json", "X-Api-Key": api_key },
    });
    if (!r.ok) {
      console.warn("[lidResolver] provider_status", r.status);
      return null;
    }
    const body = await r.json().catch(() => null) as Record<string, unknown> | null;
    const raw = body
      ? (body.pn ?? body.phoneNumber ?? body.phone ?? body.jid ?? body.id)
      : null;
    if (typeof raw !== "string" || !raw) return null;
    return normalizeBrPhone(raw.split("@")[0] ?? raw);
  } catch (e) {
    console.warn("[lidResolver] provider_error", String((e as Error).message ?? "").slice(0, 120));
    return null;
  }
}

/** Cache-first: `whatsapp_lid_map` e, em caso de miss, API do provedor. */
export async function resolveLidToPhone(sb: Sb, lid: string): Promise<string | null> {
  if (!lid) return null;
  try {
    const { data } = await sb.from("whatsapp_lid_map").select("phone_e164").eq("lid", lid).maybeSingle();
    const cached = (data as { phone_e164?: string } | null)?.phone_e164;
    if (cached) return cached;
  } catch { /* cache é best-effort */ }

  const phone = await resolveLidFromProvider(lid);
  if (!phone) return null;

  try {
    await sb.from("whatsapp_lid_map").upsert(
      { lid, phone_e164: phone, updated_at: new Date().toISOString() },
      { onConflict: "lid" },
    );
  } catch { /* cache é best-effort */ }
  return phone;
}
