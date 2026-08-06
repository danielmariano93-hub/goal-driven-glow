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

/** Lembra somente após uso no dia, depois das 18h e sem check-in registrado. */
export function emotionalReminderDue(input: {
  now: Date;
  timezone?: string | null;
  lastSurfaceSeenAt?: string | null;
  checkinDates: string[];
}): { due: boolean; localDate: string } {
  const timezone = input.timezone || "America/Sao_Paulo";
  const current = localParts(input.now, timezone);
  const seenToday = input.lastSurfaceSeenAt
    ? localParts(new Date(input.lastSurfaceSeenAt), timezone).date === current.date
    : false;
  const checkedToday = input.checkinDates.some((date) => localParts(new Date(date), timezone).date === current.date);
  return { due: current.hour >= 18 && seenToday && !checkedToday, localDate: current.date };
}
