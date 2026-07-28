// Helpers isolados para construção de links absolutos do app público.
// Puros, testáveis a partir de vitest — sem side effects nem APIs Deno.
//
// Regras:
//   - Nunca embutir hostname hardcoded. O único input aceito é a env
//     `APP_PUBLIC_URL`. Se ela estiver ausente, malformada, sem HTTPS
//     ou apontando para hosts privados, retornamos `null` para que o
//     caller possa enviar orientação sem link quebrado.
//   - Normalizamos a barra final para evitar `https://x//app/assessor`.
//   - Aceitamos apenas HTTPS. HTTP é rejeitado por padrão de segurança
//     (o link vai por WhatsApp para o usuário final).

export type AppUrlEnv = { APP_PUBLIC_URL?: string | null };

/** Retorna a base normalizada (sem barra final) ou `null` se inválida. */
export function resolveAppPublicUrl(env: AppUrlEnv): string | null {
  const raw = (env.APP_PUBLIC_URL ?? "").trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (!u.hostname || u.hostname === "localhost") return null;
  // Bloqueia IPs literais e ranges locais óbvios. Não substitui SSRF guard,
  // mas evita distribuir um link inutilizável para o usuário final.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname)) return null;
  // Descarta credenciais embutidas — nunca devem ir para o WhatsApp.
  if (u.username || u.password) return null;
  // O WhatsApp reconhece melhor hosts com `www.`; o apex costuma ficar sem
  // link clicável. Normalizamos domínios de segundo nível para o subdomínio www.
  const labels = u.hostname.split(".");
  const host = labels.length === 2 ? `www.${u.host}` : u.host;
  const origin = `${u.protocol}//${host}`;
  const path = u.pathname.replace(/\/+$/, "");
  return path ? `${origin}${path}` : origin;

}

/** Constrói o deep link do Assessor sobre a base validada.
 *  Retorna `null` quando a base é inválida ou ausente. */
export function buildAssessorLink(env: AppUrlEnv, source?: string): string | null {
  const base = resolveAppPublicUrl(env);
  if (!base) return null;
  const params = new URLSearchParams();
  if (source) params.set("source", source);
  const qs = params.toString();
  return qs ? `${base}/app/assessor?${qs}` : `${base}/app/assessor`;
}

function withParams(url: string, params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) usp.set(k, v);
  const qs = usp.toString();
  return qs ? `${url}?${qs}` : url;
}

/** Link para o detalhe de um rolê. */
export function buildSharedExpenseUrl(
  env: AppUrlEnv,
  expenseId: string,
  opts: { ref?: string; token?: string } = {},
): string | null {
  const base = resolveAppPublicUrl(env);
  if (!base || !expenseId) return null;
  return withParams(`${base}/app/divisao-do-role/${encodeURIComponent(expenseId)}`, {
    ref: opts.ref, t: opts.token,
  });
}

/** Link para o detalhe de uma meta conjunta. */
export function buildSharedGoalUrl(
  env: AppUrlEnv,
  goalId: string,
  opts: { ref?: string; token?: string } = {},
): string | null {
  const base = resolveAppPublicUrl(env);
  if (!base || !goalId) return null;
  return withParams(`${base}/app/metas-conjuntas/${encodeURIComponent(goalId)}`, {
    ref: opts.ref, t: opts.token,
  });
}

/** Link para signup com atribuição opcional.
 *  Suporta `next` (rota relativa dentro do app) para retornar o convidado ao
 *  destino esperado após concluir cadastro (ex.: rolê ou meta conjunta). */
export function buildSignupUrl(
  env: AppUrlEnv,
  opts: { ref?: string; phone?: string; next?: string } = {},
): string | null {
  const base = resolveAppPublicUrl(env);
  if (!base) return null;
  // next é uma rota relativa. Rejeita URLs absolutas para evitar open redirect.
  let nextParam: string | undefined;
  if (opts.next) {
    const n = opts.next.trim();
    if (n.startsWith("/") && !n.startsWith("//")) nextParam = n;
  }
  return withParams(`${base}/signup`, {
    next: nextParam,
    ref: opts.ref,
    phone: opts.phone,
  });
}

