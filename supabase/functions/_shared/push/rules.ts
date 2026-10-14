// Regras puras do push (testáveis): quais notificações viram push, silêncio, limite diário e validação da assinatura.

/** Confirmações de registro e fim de importação já aparecem na hora, dentro do app: não viram push. */
export const PUSH_EXCLUDED_TYPES = ["agent_confirmation", "import_done"] as const;

/** Notificação → coluna de preferência que a pessoa já controla (quando existe). */
export const PUSH_PREFERENCE_COLUMN: Record<string, string> = {
  recurrence_due: "recurrence_due",
  goal_reached: "goal_reached",
  split_reminder: "split_reminder",
  achievement: "achievement",
  system: "system",
};

export const PUSH_DAILY_CAP = 6;
export const PUSH_TTL_SECONDS = 6 * 3600;

/** Só serviços de push conhecidos (evita usar a função para chamar endereços arbitrários). */
export const PUSH_ENDPOINT_HOSTS = [
  /(^|\.)push\.apple\.com$/,
  /(^|\.)googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

export function validSubscription(value: unknown): value is PushSubscriptionInput {
  const v = value as PushSubscriptionInput | null;
  if (!v || typeof v.endpoint !== "string" || !v.keys || typeof v.keys.p256dh !== "string" || typeof v.keys.auth !== "string") return false;
  if (v.endpoint.length > 1000 || v.keys.p256dh.length > 200 || v.keys.auth.length > 100) return false;
  try {
    const url = new URL(v.endpoint);
    return url.protocol === "https:" && PUSH_ENDPOINT_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

/** Hora local de São Paulo (0–23) de um instante. */
export function saoPauloHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(now)) % 24;
}

/** Dentro do silêncio da pessoa (padrão 21h–8h), inclusive janelas que cruzam a meia-noite. */
export function inQuietHours(hour: number, quietStart = "21:00", quietEnd = "08:00"): boolean {
  const start = Number(String(quietStart).slice(0, 2));
  const end = Number(String(quietEnd).slice(0, 2));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export type PushDecision = { send: boolean; reason: string };

export function decidePush(args: {
  type: string;
  now: Date;
  prefs?: Record<string, unknown> | null;
  sentLast24h: number;
  isTest?: boolean;
}): PushDecision {
  if (args.isTest) return { send: true, reason: "test" };
  if ((PUSH_EXCLUDED_TYPES as readonly string[]).includes(args.type)) return { send: false, reason: "type_excluded" };
  const column = PUSH_PREFERENCE_COLUMN[args.type];
  if (column && args.prefs && args.prefs[column] === false) return { send: false, reason: "preference_off" };
  if (inQuietHours(saoPauloHour(args.now), String(args.prefs?.quiet_start ?? "21:00"), String(args.prefs?.quiet_end ?? "08:00"))) {
    return { send: false, reason: "quiet_hours" };
  }
  if (args.sentLast24h >= PUSH_DAILY_CAP) return { send: false, reason: "daily_cap" };
  return { send: true, reason: "ok" };
}

/** Texto curto e seguro para o aparelho; o link precisa ser do próprio app. */
export function buildPushPayload(n: { title: string; body?: string | null; action_url?: string | null; dedup_key?: string | null }) {
  const clean = (t: string, max: number) => t.replace(/\s+/g, " ").replace(/\*/g, "").trim().slice(0, max);
  const url = typeof n.action_url === "string" && n.action_url.startsWith("/") && !n.action_url.startsWith("//") ? n.action_url : "/app";
  return { title: clean(n.title || "Nino", 80), body: clean(n.body ?? "", 180), url, tag: n.dedup_key ? clean(n.dedup_key, 60) : undefined };
}
