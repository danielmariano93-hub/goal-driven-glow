// Identidade canônica de webhook — módulo puro (sem APIs Deno) para poder ser
// testado no vitest e importado pelas Edge Functions.
//
// A configuração gravada em `buildSessionConfig()` inclui `?t=<secret>` porque
// algumas engines WAHA não propagam `customHeaders`. Comparar por igualdade
// literal contra a URL base produziria `webhook_mismatch` falso — por isso a
// comparação é semântica e os concerns ficam separados:
//   routeValid  → mesma origem + mesmo pathname (trailing slash irrelevante);
//   authValid   → segredo presente via `?t=` OU header `X-Webhook-Secret`;
//   eventsValid → todos os eventos obrigatórios registrados.
// Nunca retorna URL, token ou segredo.

export const REQUIRED_WEBHOOK_EVENTS = ["message", "message.any", "message.ack", "session.status"];

export type WebhookIdentity = { routeValid: boolean; authValid: boolean; eventsValid: boolean };

export type WebhookHook = {
  url?: string;
  events?: string[];
  customHeaders?: Array<{ name?: string; value?: string }>;
};

function canonicalRoute(raw: string): { origin: string; path: string } | null {
  try {
    const u = new URL(raw);
    return { origin: u.origin.toLowerCase(), path: u.pathname.replace(/\/+$/, "") };
  } catch {
    return null;
  }
}

export function compareWebhookIdentity(
  hook: WebhookHook | null | undefined,
  expectedBaseUrl: string,
  secret: string,
): WebhookIdentity {
  const actual = canonicalRoute(hook?.url ?? "");
  const expected = canonicalRoute(expectedBaseUrl);
  const routeValid = Boolean(
    actual && expected && actual.origin === expected.origin && actual.path === expected.path,
  );

  let tokenOk = false;
  if (secret && hook?.url) {
    try {
      tokenOk = new URL(hook.url).searchParams.get("t") === secret;
    } catch {
      tokenOk = false;
    }
  }
  const headerOk = Boolean(
    hook?.customHeaders?.some((h) =>
      (h?.name ?? "").toLowerCase() === "x-webhook-secret"
      && Boolean(h?.value)
      && (!secret || h?.value === secret)
    ),
  );

  const events = hook?.events ?? [];
  return {
    routeValid,
    authValid: tokenOk || headerOk,
    eventsValid: REQUIRED_WEBHOOK_EVENTS.every((e) => events.includes(e)),
  };
}
