export const EMOTIONAL_REMINDER_KIND = "emotional_checkin_due";

function localParts(now: Date, timezone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, hour: Number(value("hour")) };
}

export type EmotionalReminderSettings = {
  /** Lembrete ligado no produto. */
  enabled?: boolean;
  /** Hora local a partir da qual o lembrete pode sair (0..23). */
  hour?: number;
  /** Exigir que a pessoa tenha usado o Nino no dia (app ou WhatsApp). */
  requiresActivity?: boolean;
};

/**
 * O lembrete é devido quando: está ligado, passou da hora configurada, não há
 * check-in no dia e — se a configuração exigir — houve atividade no dia em
 * qualquer canal (app ou WhatsApp). Quem usa só o WhatsApp também é lembrado.
 */
export function emotionalReminderDue(input: {
  now: Date;
  timezone?: string | null;
  /** Última presença em qualquer superfície (app, Nino, WhatsApp). */
  lastActivityAt?: string | null;
  /** Compatibilidade: presença apenas na superfície do app. */
  lastSurfaceSeenAt?: string | null;
  checkinDates: string[];
  settings?: EmotionalReminderSettings;
}): { due: boolean; localDate: string; reason: string } {
  const timezone = input.timezone || "America/Sao_Paulo";
  const settings = input.settings ?? {};
  const enabled = settings.enabled !== false;
  const targetHour = Number.isFinite(settings.hour) ? Math.min(23, Math.max(0, Number(settings.hour))) : 19;
  const requiresActivity = settings.requiresActivity === true;

  const current = localParts(input.now, timezone);
  const activityAt = input.lastActivityAt ?? input.lastSurfaceSeenAt ?? null;
  const activeToday = activityAt
    ? localParts(new Date(activityAt), timezone).date === current.date
    : false;
  const checkedToday = input.checkinDates.some((date) =>
    localParts(new Date(date), timezone).date === current.date
  );

  const reason = !enabled
    ? "reminder_disabled"
    : checkedToday
    ? "already_checked_in"
    : current.hour < targetHour
    ? "before_target_hour"
    : requiresActivity && !activeToday
    ? "no_activity_today"
    : activeToday
    ? "used_nino_without_checkin"
    : "daily_care_reminder";

  const due = enabled && !checkedToday && current.hour >= targetHour &&
    (!requiresActivity || activeToday);
  return { due, localDate: current.date, reason };
}
