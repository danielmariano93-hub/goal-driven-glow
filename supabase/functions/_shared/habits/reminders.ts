// Lembretes de Hábitos (F2): decisão pura de QUANDO falar. Sem banco, sem relógio global, sem IA.
// Regras (doc seção 8): lembrete é reforço do gatilho (só sai se o hábito não foi registrado até 90 min depois do horário);
// no máximo 2 mensagens de hábito por dia; um lembrete por horário do dia; nada depois das 22h; resumo só com pendência;
// parada automática depois de 3 lembretes seguidos ignorados; tom sem culpa.
import {
  addDays, automaticityDue, automaticitySummary, FIRM_FROM, isMaintenance, milestoneToday, nudgeLevel, quitStats, streakMilestoneToday, summarizeHabit, type HabitDef, type PauseRange,
} from "../habits-core/index.ts";
import { localMinutes, type HbSnapshotAs } from "./whatsappReply.ts";

export type HabitReminder = {
  kind: "hb_cue_reminder" | "hb_daily_recap" | "hb_automaticity_due" | "hb_streak_milestone";
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
export const AUTO_FROM_MIN = 10 * 60;
export const AUTO_TO_MIN = 20 * 60;
export const MILESTONE_FROM_MIN = 8 * 60;
export const MILESTONE_TO_MIN = 20 * 60;
export const AUTO_REPEAT_DAYS = 7;

const cueMin = (cue: string | null): number | null => {
  const m = cue ? /^(\d{1,2}):(\d{2})/.exec(cue) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const slotOf = (min: number): "am" | "pm" | "ev" => (min < 12 * 60 ? "am" : min < 18 * 60 ? "pm" : "ev");

const pausesOf = (snap: HbSnapshotAs, id: string): PauseRange[] => (snap.pauses ?? []).filter((p) => p.habit_id === id).map((p) => ({ from: p.from, to: p.to }));

const toDef = (h: HbSnapshotAs["habits"][number]): HabitDef => ({
  id: h.id, kind: h.kind, started_on: h.started_on, days_of_week: h.days_of_week, weekly_target: h.weekly_target,
  quantity_target: h.quantity_target, quantity_period: h.quantity_period, rest_per_week: h.rest_per_week,
});

/** O último registro (de qualquer origem) foi nas últimas 24 h? Quem está registrando não está "ignorando". */
function engagedRecently(snap: HbSnapshotAs, now: Date): boolean {
  return snap.logs.some((l) => l.logged_at && now.getTime() - Date.parse(l.logged_at) <= 24 * 3_600_000);
}

/** Hábitos de saúde e substâncias só entram em lembretes com autorização, e a mensagem fala do hábito de forma discreta. */
const allowed = (snap: HbSnapshotAs, h: HbSnapshotAs["habits"][number]) => (h.sensitivity ?? "normal") === "normal" || snap.consent_sensitive === true;

/** Marco (sequência ou dias sem): reconhece uma vez, sem prêmio. */
function milestoneReminder(input: ReminderInput): HabitReminder | null {
  const { snap, now } = input;
  const nowMin = localMinutes(now, snap.timezone);
  if (nowMin < MILESTONE_FROM_MIN || nowMin > MILESTONE_TO_MIN) return null;
  for (const habit of snap.habits.filter((h) => (h.status ?? "active") === "active" && allowed(snap, h))) {
    const discreet = (habit.sensitivity ?? "normal") !== "normal";
    if (habit.kind === "quit") {
      const st = quitStats(habit.id, snap.cycles ?? [], snap.cravings ?? [], snap.slips ?? [], snap.today);
      const m = milestoneToday(st.days_clean);
      const key = `hb-mile:${habit.id}:q${m}`;
      if (m == null || m < 3 || input.sentKeys.has(key)) continue;
      return {
        kind: "hb_streak_milestone", dedup_key: key, severity: "info", title: discreet ? "Sua contagem" : habit.title,
        body: discreet ? `Sua contagem chegou a ${m} dias. Isso é seu.` : `${m} dias sem ${habit.title.toLowerCase()}. Isso é seu.`,
        evidence: { habit_id: habit.id, milestone: m, kind: "quit" }, expires_in_min: 24 * 60,
      };
    }
    const summary = summarizeHabit(toDef(habit), snap.logs, snap.today, pausesOf(snap, habit.id));
    if (summary.model !== "daily") continue;
    const m = streakMilestoneToday(summary.streak);
    const key = `hb-mile:${habit.id}:s${m}`;
    if (m == null || input.sentKeys.has(key) || !(summary.today.outcome === "done" || summary.today.outcome === "minimum")) continue;
    return {
      kind: "hb_streak_milestone", dedup_key: key, severity: "info", title: discreet ? "Seu hábito" : habit.title,
      body: discreet ? `${m} dias seguidos. Isso mostra constância.` : `${m} dias seguidos de ${habit.title.toLowerCase()}. Isso mostra constância.`,
      evidence: { habit_id: habit.id, milestone: m, kind: "streak" }, expires_in_min: 24 * 60,
    };
  }
  return null;
}

/** Pergunta de automaticidade (1 a 7): no máximo uma por rodada e nunca repetida antes de 7 dias. */
function automaticityReminder(input: ReminderInput): HabitReminder | null {
  const { snap, now } = input;
  const nowMin = localMinutes(now, snap.timezone);
  if (nowMin < AUTO_FROM_MIN || nowMin > AUTO_TO_MIN) return null;
  for (const habit of snap.habits.filter((h) => h.kind !== "quit" && (h.status ?? "active") === "active" && allowed(snap, h))) {
    if (!automaticityDue({ id: habit.id, kind: habit.kind, started_on: habit.started_on, status: habit.status }, snap.automaticity ?? [], snap.today)) continue;
    const recent = [...input.sentKeys].some((k) => {
      const m = new RegExp(`^hb-auto:${habit.id}:(\\d{4}-\\d{2}-\\d{2})$`).exec(k);
      return !!m && m[1] >= addDays(snap.today, -(AUTO_REPEAT_DAYS - 1));
    });
    if (recent) continue;
    const discreet = (habit.sensitivity ?? "normal") !== "normal";
    return {
      kind: "hb_automaticity_due", dedup_key: `hb-auto:${habit.id}:${snap.today}`, severity: "info", title: discreet ? "Seu hábito" : habit.title,
      body: `${discreet ? "Seu hábito" : `"${habit.title}"`} já acontece quase sem você pensar? Responda de 1 (nada) a 7 (totalmente).`,
      evidence: { habit_id: habit.id, local_date: snap.today }, expires_in_min: 24 * 60,
    };
  }
  return null;
}

/** Devolve no máximo UM lembrete por rodada (a rodada roda de hora em hora). */
export function habitReminders(input: ReminderInput): HabitReminder[] {
  const { snap, now } = input;
  if (!snap.nudges_enabled) return [];
  const limit = Math.min(MAX_NUDGES_HARD_CAP, Math.max(0, snap.max_nudges_per_day));
  if (limit === 0) return [];

  // 0) Reconhecimento e check-in de automaticidade (valem mesmo sem hábito pendente; um por rodada).
  const mile = milestoneReminder(input);
  if (mile) return [mile];

  if (input.alreadySentToday >= limit) return [];

  const nowMin = localMinutes(now, snap.timezone);
  const rows = snap.habits
    .filter((h) => h.kind !== "quit" && (h.status ?? "active") === "active" && allowed(snap, h))
    .map((habit) => {
      const summary = summarizeHabit(toDef(habit), snap.logs, snap.today, pausesOf(snap, habit.id));
      const auto = automaticitySummary(habit.id, snap.automaticity ?? []);
      const maintenance = isMaintenance(auto, summary.strength, FIRM_FROM);
      return { habit, summary, level: nudgeLevel(auto, maintenance) };
    });
  // Quanto mais automático, menos lembrete: manutenção = nenhum; nota 4 ou mais = só se ontem ficou em aberto ou falhou.
  const yesterday = addDays(snap.today, -1);
  const wanted = rows.filter((r) => {
    if (r.level === "none") return false;
    if (r.level === "reduced") {
      const y = snap.logs.find((l) => l.habit_id === r.habit.id && l.local_date === yesterday);
      return !y || y.status === "skipped";
    }
    return true;
  });
  const due = wanted.filter((r) => r.summary.model === "daily" && r.summary.today.outcome !== "not_expected" && r.summary.today.outcome !== "rest");
  const pending = due.filter((r) => r.summary.today.outcome === "unlogged");

  // 1) Lembrete do gatilho.
  const stopped = input.ignoredCueStreak >= IGNORED_STOP && !engagedRecently(snap, now);
  if (!stopped && pending.length > 0) {
    const ready = pending
      .map((r) => ({ r, c: cueMin(r.habit.cue_time) }))
      .filter((x): x is { r: (typeof pending)[number]; c: number } => x.c != null && x.c + CUE_GRACE_MIN <= nowMin && nowMin <= CUE_LAST_MIN);
    if (ready.length > 0) {
      const earliest = Math.min(...ready.map((x) => x.c));
      const slot = slotOf(earliest);
      const group = ready.filter((x) => slotOf(x.c) === slot);
      const key = `hb-cue:${snap.today}:${slot}`;
      if (!input.sentKeys.has(key)) {
        const discreetAny = group.some((x) => (x.r.habit.sensitivity ?? "normal") !== "normal");
        const titles = group.map((x) => x.r.habit.title);
        const single = group.length === 1 ? group[0].r.habit : null;
        const text = discreetAny
          ? 'Hora do seu hábito. Já fez? Responda "feito", "mínimo" ou "hoje não".'
          : single
            ? `${single.cue_text ? `${single.cue_text}: ${single.title}` : `Hora de ${single.title}`}. Já fez? Responda "feito", "mínimo" ou "hoje não".`
            : `Faltam: ${titles.join(", ")}. Já fez algum? Responda, por exemplo, "fiz ${titles[0].toLowerCase()}".`;
        return [{
          kind: "hb_cue_reminder", dedup_key: key, severity: "info",
          title: discreetAny ? "Seu hábito" : single ? single.title : "Seus hábitos",
          body: text,
          evidence: { local_date: snap.today, slot, habit_ids: group.map((x) => x.r.habit.id) },
          expires_in_min: Math.max(30, Math.min(180, CUE_LAST_MIN - nowMin)),
        }];
      }
    }
  }

  // 2) Check-in de automaticidade.
  const auto = automaticityReminder(input);
  if (auto) return [auto];

  // 3) Resumo do fim do dia (só para quem tem 2 ou mais hábitos previstos e ainda falta algo).
  if (due.length >= 2 && pending.length > 0 && nowMin >= RECAP_FROM_MIN && nowMin <= RECAP_TO_MIN && due.every((r) => (r.habit.sensitivity ?? "normal") === "normal")) {
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
