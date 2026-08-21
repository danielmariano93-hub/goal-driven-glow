// Links curtos (`nino_agent.v1`).
//
// Mensagens de WhatsApp com URL longa e cheia de parâmetros parecem spam e
// quebram em vários clientes. Aqui trocamos um caminho interno do app por
// `https://<site>/s/<token>`, com auditoria de clique no banco.
// deno-lint-ignore-file no-explicit-any

export const DEFAULT_SITE_URL = "https://meunino.com.br";

function baseUrl(siteUrl?: string | null): string {
  const raw = String(siteUrl ?? "").trim() || Deno.env.get("APP_SITE_URL") || DEFAULT_SITE_URL;
  return raw.replace(/\/+$/, "");
}

/**
 * Cria (ou reaproveita) um link curto para um caminho interno do app.
 * Em qualquer falha devolve a URL longa: comunicação nunca deixa de sair por
 * causa de encurtador.
 */
export async function buildShortLink(
  sb: any,
  params: { user_id: string; path: string; kind?: string; ttl_days?: number; site_url?: string | null },
): Promise<{ url: string; token: string | null; shortened: boolean }> {
  const site = baseUrl(params.site_url);
  const path = String(params.path ?? "").trim();
  const longUrl = `${site}${path.startsWith("/") ? path : `/${path}`}`;
  if (!path.startsWith("/") || !params.user_id) return { url: longUrl, token: null, shortened: false };

  try {
    const { data, error } = await sb.rpc("create_short_link", {
      _target_path: path,
      _kind: params.kind ?? "generic",
      _ttl_days: params.ttl_days ?? 30,
      _user_id: params.user_id,
    });
    if (error) return { url: longUrl, token: null, shortened: false };
    const payload = (data ?? {}) as { ok?: boolean; token?: string; path?: string };
    if (!payload.ok || !payload.token) return { url: longUrl, token: null, shortened: false };
    return { url: `${site}/s/${payload.token}`, token: payload.token, shortened: true };
  } catch {
    return { url: longUrl, token: null, shortened: false };
  }
}

/**
 * Encurta uma URL absoluta do app (mantendo caminho + query) usando o mesmo
 * serviço central. Qualquer falha devolve a URL original: nenhuma comunicação
 * deixa de sair por causa do encurtador.
 */
export async function shortenAppUrl(
  sb: any,
  params: { user_id: string | null | undefined; url: string | null | undefined; kind?: string; ttl_days?: number },
): Promise<string | null> {
  const raw = String(params.url ?? "").trim();
  if (!raw || !params.user_id) return params.url ?? null;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return raw; }
  const path = `${parsed.pathname}${parsed.search}`;
  if (!path.startsWith("/")) return raw;
  const { url } = await buildShortLink(sb, {
    user_id: String(params.user_id),
    path,
    kind: params.kind ?? "generic",
    ttl_days: params.ttl_days,
    site_url: parsed.origin,
  });
  return url;
}
