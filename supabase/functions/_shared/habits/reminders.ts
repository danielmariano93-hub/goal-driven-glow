// Lembretes de Hábitos (F2): decisão pura de QUANDO falar. Sem banco, sem relógio global, sem IA.
// Regras (doc seção 8): lembrete é reforço do gatilho (só sai se o hábito não foi registrado até 90 min depois do horário);
// no máximo 2 mensagens de hábito por dia; um lembrete por horário do dia; nada depois das 22h; resumo só com pendência;
// parada automática depois de 3 lembretes seguidos ignorados; tom sem culpa.
import { summarizeHabit, type HabitDef } from "../habits-core/index.ts";
import { localMinutes, type HbSnapshotAs } from "./whatsappReply.ts";

export type HabitReminder = {
  kind: "hb_cue_reminder" | "hb_daily_recap";
  dedup_key: string;
  title: string;
  body: string;
  severity: "info";
  evidence: Record<string, unknown>;
  /** Validade da mensagem, em minutos (passou disso, não faz mais sentido enviar). */
  expires_in_min: number;
};

export type ReminderInput = {
  snap: HbSnapshotAs;
  now: Date;
  /** Mensagens de hábito já aceitas hoje (enfileiradas, enviadas ou entregues). */
  alreadySentToday: number;
  /** Chaves de dedup já usadas (hoje). */
  sentKeys: ReadonlySet<string>;
  /** Quantos lembretes de gatilho MAIS RECENTES seguidos ficaram sem resposta. */
  ignoredCueStreak: number;
};

export const CUE_GRACE_MIN = 90;
export const CUE_LAST_MIN = 22 * 60;
export const RECAP_FROM_MIN = 21 * 60 + 30;
export const RECAP_TO_MIN = 23 * 60;
export const IGNORED_STOP = 3;
export const MAX_NUDGES_HARD_CAP = 3;

const cueMin = (cue: string | null): number | null => {
  const m = cue ? /^(\d{1,2}):(\d{2})/.exec(cue) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const slotOf = (min: number): "am" | "pm" | "ev" => (min < 12 * 60 ? "am" : min < 18 * 60 ? "pm" : "ev");

const toDef = (h: HbSnapshotAs["habits"][number]): HabitDef => ({
  id: h.id, kind: h.kind, started_on: h.started_on, days_of_week: h.days_of_week, weekly_target: h.weekly_target,
  quantity_target: h.quantity_target, quantity_period: h.quantity_period, rest_per_week: h.rest_per_week,
});

/** O último registro (de qualquer origem) foi nas últimas 24 h? Quem está registrando não está "ignorando". */
function engagedRecently(snap: HbSnapshotAs, now: Date): boolean {
  return snap.logs.some((l) => l.logged_at && now.getTime() - Date.parse(l.logged_at) <= 24 * 3_600_000);
}

/** Devolve no máximo UM lembrete por rodada (a rodada roda de hora em hora). */
export function habitReminders(input: ReminderInput): HabitReminder[] {
  const { snap, now } = input;
  if (!snap.nudges_enabled) return [];
  const limit = Math.min(MAX_NUDGES_HARD_CAP, Math.max(0, snap.max_nudges_per_day));
  if (limit === 0 || input.alreadySentToday >= limit) return [];

  const nowMin = localMinutes(now, snap.timezone);
  const rows = snap.habits.map((habit) => ({ habit, summary: summarizeHabit(toDef(habit), snap.logs, snap.today, []) }));
  const due = rows.filter((r) => r.summary.model === "daily" && r.summary.today.outcome !== "not_expected" && r.summary.today.outcome !== "rest");
  const pending = due.filter((r) => r.summary.today.outcome === "unlogged");
  if (pending.length === 0) return [];

  // 1) Lembrete do gatilho.
  const stopped = input.ignoredCueStreak >= IGNORED_STOP && !engagedRecently(snap, now);
  if (!stopped) {
    const ready = pending
      .map((r) => ({ r, c: cueMin(r.habit.cue_time) }))
      .filter((x): x is { r: (typeof pending)[number]; c: number } => x.c != null && x.c + CUE_GRACE_MIN <= nowMin && nowMin <= CUE_LAST_MIN);
    if (ready.length > 0) {
      const earliest = Math.min(...ready.map((x) => x.c));
      const slot = slotOf(earliest);
      const group = ready.filter((x) => slotOf(x.c) === slot);
      const key = `hb-cue:${snap.today}:${slot}`;
      if (!input.sentKeys.has(key)) {
        const titles = group.map((x) => x.r.habit.title);
        const single = group.length === 1 ? group[0].r.habit : null;
        const text = single
          ? `${single.cue_text ? `${single.cue_text}: ${single.title}` : `Hora de ${single.title}`}. Já fez? Responda "feito", "mínimo" ou "hoje não".`
          : `Faltam: ${titles.join(", ")}. Já fez algum? Responda, por exemplo, "fiz ${titles[0].toLowerCase()}".`;
        return [{
          kind: "hb_cue_reminder", dedup_key: key, severity: "info",
          title: single ? single.title : "Seus hábitos",
          body: text,
          evidence: { local_date: snap.today, slot, habit_ids: group.map((x) => x.r.habit.id) },
          expires_in_min: Math.max(30, Math.min(180, CUE_LAST_MIN - nowMin)),
        }];
      }
    }
  }

  // 2) Resumo do fim do dia (só para quem tem 2 ou mais hábitos previstos e ainda falta algo).
  if (due.length >= 2 && nowMin >= RECAP_FROM_MIN && nowMin <= RECAP_TO_MIN) {
    const key = `hb-recap:${snap.today}`;
    if (!input.sentKeys.has(key)) {
      const done = due.length - pending.length;
      return [{
        kind: "hb_daily_recap", dedup_key: key, severity: "info", title: "Resumo dos hábitos",
        body: `Hoje: ${done} de ${due.length}. Falta: ${pending.map((r) => r.habit.title).join(", ")}.`,
        evidence: { local_date: snap.today, habit_ids: pending.map((r) => r.habit.id), done, total: due.length },
        expires_in_min: Math.max(30, RECAP_TO_MIN - nowMin + 60),
      }];
    }
  }
  return [];
}
