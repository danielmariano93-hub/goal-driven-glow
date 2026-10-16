// Resolve o destino de um link interno guardado (notificação, prioridade, alerta, WhatsApp).
// Links gravados no passado podem apontar para telas renomeadas ou que nunca existiram; em vez de cair numa
// página de erro, o app leva ao lugar certo (apelido conhecido) ou ao pai existente mais próximo.
import { APP_NAVIGATION } from "./appNavigationRegistry";

/** Caminhos antigos/errados → destino certo. Chave sem query. */
export const ROUTE_ALIASES: Record<string, string> = {
  "/app/mais/dividas": "/app/dividas",
  "/app/mais/compromissos": "/app/compromissos",
  "/app/mais/metas": "/app/metas",
  "/app/alertas": "/app/nino",
  "/app/debts": "/app/dividas",
  "/app/goals": "/app/metas",
  "/app/reports": "/app/relatorios",
  // A aba Emocional virou Mapa Financeiro: links guardados em notificações e no WhatsApp continuam funcionando.
  "/app/emocoes": "/app/mapa",
};

const patternToRegex = (pattern: string) => new RegExp("^" + pattern.replace(/:[A-Za-z]+/g, "[^/]+") + "/?$");
const KNOWN = APP_NAVIGATION.map((e) => e.path).filter((p) => p.startsWith("/app")).map(patternToRegex);

const splitPath = (route: string) => {
  const i = route.search(/[?#]/);
  return i === -1 ? { path: route, rest: "" } : { path: route.slice(0, i), rest: route.slice(i) };
};

export function isKnownAppPath(path: string): boolean {
  const p = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return p === "/app" || KNOWN.some((r) => r.test(p));
}

/**
 * Devolve um destino que existe. `null` = não há o que aproveitar (o chamador mostra a tela de "não encontrado").
 * Mantém a query string quando o destino é o mesmo caminho ou um apelido.
 */
export function resolveAppRoute(route: string): string | null {
  const { path, rest } = splitPath(String(route ?? "").trim());
  if (!path.startsWith("/app")) return null;
  if (isKnownAppPath(path)) return path + rest;
  const alias = ROUTE_ALIASES[path.replace(/\/$/, "")];
  if (alias) return alias + rest;
  // "/app/mais/<tela>": o menu Mais é só um agrupador.
  const mais = path.match(/^\/app\/mais\/(.+)$/);
  if (mais && isKnownAppPath(`/app/${mais[1]}`)) return `/app/${mais[1]}${rest}`;
  // pai existente mais próximo (ex.: /app/dividas/123 → /app/dividas)
  const parts = path.split("/").filter(Boolean);
  for (let n = parts.length - 1; n >= 2; n -= 1) {
    const parent = "/" + parts.slice(0, n).join("/");
    if (parent !== "/app/mais" && isKnownAppPath(parent)) return parent;
  }
  return null;
}
