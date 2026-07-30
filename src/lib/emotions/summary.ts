export type EmotionalCheckin = {
  mood: number | string;
  occurred_at: string;
  trigger_label?: string | null;
};

export type EmotionalSummary = {
  streakDays: number;
  checkinsLast7Days: number;
  weeklyGoal: number;
  weeklyProgress: number;
  averageMood30Days: number | null;
  dominantTrigger: string | null;
};

function localDay(value: string): string {
  return String(value ?? "").slice(0, 10);
}

function addDays(iso: string, delta: number): string {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function computeEmotionalSummary(
  checkins: EmotionalCheckin[],
  today = new Date().toISOString().slice(0, 10),
  weeklyGoal = 5,
): EmotionalSummary {
  const lastByDay = new Map<string, EmotionalCheckin>();
  for (const checkin of checkins) {
    const day = localDay(checkin.occurred_at);
    if (!day || day > today || lastByDay.has(day)) continue;
    lastByDay.set(day, checkin);
  }

  let streakDays = 0;
  let cursor = today;
  if (!lastByDay.has(cursor)) cursor = addDays(cursor, -1);
  while (lastByDay.has(cursor)) {
    streakDays++;
    cursor = addDays(cursor, -1);
  }

  const start7 = addDays(today, -6);
  const start30 = addDays(today, -29);
  const last7 = [...lastByDay.entries()].filter(([day]) => day >= start7 && day <= today);
  const last30 = [...lastByDay.entries()].filter(([day]) => day >= start30 && day <= today);
  const moods = last30.map(([, row]) => Number(row.mood)).filter(Number.isFinite);
  const triggers = new Map<string, number>();
  for (const [, row] of last30) {
    const trigger = row.trigger_label?.trim();
    if (trigger) triggers.set(trigger, (triggers.get(trigger) ?? 0) + 1);
  }
  const dominantTrigger = [...triggers.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    streakDays,
    checkinsLast7Days: last7.length,
    weeklyGoal,
    weeklyProgress: Math.min(1, last7.length / weeklyGoal),
    averageMood30Days: moods.length ? moods.reduce((sum, value) => sum + value, 0) / moods.length : null,
    dominantTrigger,
  };
}
