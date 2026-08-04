// anticipation_contract.v1 — momento ótimo de envio (regras, não modelo).
// Fuso do usuário, horário de silêncio, janela de ação e hora habitual de
// abertura. Nunca envia fora da janela em que a pessoa ainda pode agir.

const DEFAULT_TZ = "America/Sao_Paulo";

function localParts(date: Date, tz: string): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(date).split(":").map(Number);
  return { hour: parts[0], minute: parts[1] };
}

function toMinutes(hhmm: string | null | undefined): number | null {
  if (!hhmm || !/^\d{2}:\d{2}/.test(hhmm)) return null;
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

export function isWithinQuietHours(
  at: Date,
  quietStart: string | null | undefined,
  quietEnd: string | null | undefined,
  tz: string = DEFAULT_TZ,
): boolean {
  const s = toMinutes(quietStart);
  const e = toMinutes(quietEnd);
  if (s === null || e === null || s === e) return false;
  const { hour, minute } = localParts(at, tz);
  const n = hour * 60 + minute;
  return s < e ? n >= s && n < e : n >= s || n < e;
}

export type SendTimeInput = {
  now: Date;
  windowStart: Date;
  windowEnd: Date;
  timezone?: string | null;
  quietStart?: string | null;
  quietEnd?: string | null;
  /** Hora local em que a pessoa costuma abrir o app (0-23), quando conhecida. */
  habitualHour?: number | null;
};

export type SendTimeResult = {
  sendAt: string | null;
  reason: string;
};

/**
 * Escolhe o primeiro instante dentro da janela que respeite silêncio e, quando
 * possível, a hora habitual. Se a janela inteira cair no silêncio, devolve
 * `null` — a decisão de adiar ou converter em app fica com a política de stale.
 */
export function resolveOptimalSendAt(input: SendTimeInput): SendTimeResult {
  const tz = (input.timezone ?? "").trim() || DEFAULT_TZ;
  const start = new Date(Math.max(input.now.getTime(), input.windowStart.getTime()));
  const end = input.windowEnd;
  if (start.getTime() >= end.getTime()) return { sendAt: null, reason: "window_closed" };

  const habitual = typeof input.habitualHour === "number" ? input.habitualHour : null;
  let best: Date | null = null;
  let reason = "first_available_slot";

  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += 15 * 60_000) {
    const candidate = new Date(cursor);
    if (isWithinQuietHours(candidate, input.quietStart, input.quietEnd, tz)) continue;
    if (!best) best = candidate;
    if (habitual !== null && localParts(candidate, tz).hour === habitual) {
      return { sendAt: candidate.toISOString(), reason: "habitual_hour" };
    }
  }

  if (!best) return { sendAt: null, reason: "quiet_hours_cover_window" };
  return { sendAt: best.toISOString(), reason };
}
