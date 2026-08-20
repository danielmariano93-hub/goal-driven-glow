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
