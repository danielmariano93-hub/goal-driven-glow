// Lembretes de Hábitos (F2): decisão pura de QUANDO falar. Sem banco, sem relógio global, sem IA.
// Regras (doc seção 8): lembrete é reforço do gatilho (só sai se o hábito não foi registrado até 90 min depois do horário);
// no máximo 2 mensagens de hábito por dia; um lembrete por horário do dia; nada depois das 22h; resumo só com pendência;
// parada automática depois de 3 lembretes seguidos ignorados; tom sem culpa.
import {
  addDays, automaticityDue, dayPace, automaticitySummary, dow, FIRM_FROM, isMaintenance, mergeAutoLogs, milestoneToday, nudgeLevel, quitStats, reviewText, streakMilestoneToday, summarizeHabit, weekStart, weeklyReview, type HabitDef, type PauseRange,
} from "../habits-core/index.ts";
import { localMinutes, type HbSnapshotAs } from "./whatsappReply.ts";

export type HabitReminder = {
  kind: "hb_cue_reminder" | "hb_daily_recap" | "hb_automaticity_due" | "hb_streak_milestone" | "hb_weekly_review";
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
export const REVIEW_FROM_MIN = 18 * 60;
export const REVIEW_TO_MIN = 20 * 60 + 30;
/** Lembretes de ritmo (metas de quantidade, como água): horas cheias em que podem sair e teto por dia (orçamento próprio, à parte dos 2 do gatilho). */
export const PACE_SLOT_HOURS = [10, 12, 14, 16, 18, 20] as const;
export const PACE_MAX_PER_DAY = 3;
/** Hora de referência de cada momento do dia para quem escolheu só "Manhã", "Tarde" ou "Noite" (o lembrete sai 90 min depois). */
export const PERIOD_CUE_MIN: Record<string, number> = { "Manhã": 8 * 60, "Tarde": 14 * 60, "Noite": 20 * 60 };

const cueMin = (cue: string | null): number | null => {
  const m = cue ? /^(\d{1,2}):(\d{2})/.exec(cue) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
/** Sem horário exato, usa o momento do dia escolhido ("Manhã · depois do café" vira 08:00). "Durante o dia" não tem hora. */
const periodCueMin = (cueText: string | null): number | null => {
  const m = cueText ? /^(Manhã|Tarde|Noite)( · |$)/.exec(cueText) : null;
  return m ? PERIOD_CUE_MIN[m[1]] : null;
};
const slotOf = (min: number): "am" | "pm" | "ev" => (min < 12 * 60 ? "am" : min < 18 * 60 ? "pm" : "ev");

const pausesOf = (snap: HbSnapshotAs, id: string): PauseRange[] => (snap.pauses ?? []).filter((p) => p.habit_id === id).map((p) => ({ from: p.from, to: p.to }));

const toDef = (h: HbSnapshotAs["habits"][number]): HabitDef => ({
  id: h.id, kind: h.kind, started_on: h.started_on, days_of_week: h.days_of_week, weekly_target: h.weekly_target,
  quantity_target: h.quantity_target, quantity_period: h.quantity_period, rest_per_week: h.rest_per_week,
  form: h.form ?? null, direction: h.direction ?? null, implicit_ok: h.implicit_ok ?? false, interval_days: h.interval_days ?? null,
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

/** Revisão semanal: domingo à noite, texto fixo com os números marcados. Só hábitos comuns (nunca saúde ou substância). */
function reviewReminder(input: ReminderInput): HabitReminder | null {
  const { snap, now } = input;
  const nowMin = localMinutes(now, snap.timezone);
  if (dow(snap.today) !== 0 || nowMin < REVIEW_FROM_MIN || nowMin > REVIEW_TO_MIN) return null;
  const key = `hb-review:${weekStart(snap.today)}`;
  if (input.sentKeys.has(key)) return null;
  const habits = snap.habits.filter((h) => h.kind === "do_daily" && (h.status ?? "active") === "active" && (h.sensitivity ?? "normal") === "normal");
  const logs = mergeAutoLogs(snap.logs, snap.auto_logs ?? []);
  const rows = weeklyReview(habits.map((h) => ({ def: toDef(h), pauses: pausesOf(snap, h.id) })), logs, snap.today).filter((r) => r.expected > 0);
  if (rows.length === 0 || rows.reduce((n, r) => n + r.expected, 0) < 3) return null;
  const body = reviewText(rows, (id) => habits.find((h) => h.id === id)?.title ?? "Hábito");
  return { kind: "hb_weekly_review", dedup_key: key, severity: "info", title: "Sua semana nos hábitos", body, evidence: { week_start: weekStart(snap.today), habit_ids: rows.map((r) => r.habit_id) }, expires_in_min: 6 * 60 };
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

/** Meta de quantidade "no mínimo" por dia (água): se está abaixo do ritmo numa das horas de lembrete, sugere quanto beber agora. */
function paceReminder(input: ReminderInput, mergedLogs: HbSnapshotAs["logs"]): HabitReminder | null {
  const { snap, now } = input;
  const nowHour = localMinutes(now, snap.timezone) / 60;
  const slot = [...PACE_SLOT_HOURS].reverse().find((h) => nowHour >= h && nowHour - h < 1);
  if (slot == null) return null;
  const sentToday = [...input.sentKeys].filter((k) => k.startsWith(`hb-pace:${snap.today}:`)).length;
  if (sentToday >= PACE_MAX_PER_DAY) return null;
  for (const habit of snap.habits) {
    if ((habit.status ?? "active") !== "active" || habit.kind !== "do_quantity" || habit.form !== "amount" || habit.direction === "at_most") continue;
    if (habit.quantity_period !== "day" || !(habit.quantity_target && habit.quantity_target > 0) || !allowed(snap, habit) || (habit.sensitivity ?? "normal") !== "normal") continue;
    if (habit.started_on > snap.today) continue;
    const key = `hb-pace:${snap.today}:${slot}`;
    if (input.sentKeys.has(key)) return null;
    const total = mergedLogs.find((l) => l.habit_id === habit.id && l.local_date === snap.today && l.status === "quantity")?.quantity ?? 0;
    const pace = dayPace(habit.quantity_target, total, nowHour);
    if (!pace || pace.state !== "behind") continue;
    const unit = habit.quantity_unit ?? "";
    const fmt = (n: number) => (unit === "litros" && n < 1 ? `${Math.round(n * 1000)} ml` : `${String(Math.round(n * 100) / 100).replace(".", ",")}${unit ? ` ${unit}` : ""}`);
    const next = pace.per_hour_plan * 2;
    return {
      kind: "hb_cue_reminder", dedup_key: key, severity: "info", title: habit.title,
      body: `${habit.title}: você está em ${fmt(total)} de ${fmt(habit.quantity_target)}. A esta hora o ideal seria cerca de ${fmt(pace.expected)}. Que tal ${fmt(next)} agora? Quando fizer, registre no app ou me responda com a quantidade.`,
      evidence: { local_date: snap.today, habit_ids: [habit.id], pace: true, total, expected: Math.round(pace.expected * 100) / 100 },
      expires_in_min: 90,
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
  const review = reviewReminder(input);
  if (review) return [review];

  const nowMin = localMinutes(now, snap.timezone);
  const measured = new Set((snap.auto_rules ?? []).map((r) => r.habit_id));
  const mergedLogs = mergeAutoLogs(snap.logs, snap.auto_logs ?? []);
  const rows = snap.habits
    .filter((h) => h.kind !== "quit" && (h.status ?? "active") === "active" && allowed(snap, h))
    .map((habit) => {
      const summary = summarizeHabit(toDef(habit), mergedLogs, snap.today, pausesOf(snap, habit.id));
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

  // 0b) Ritmo da meta de quantidade (água): orçamento próprio, à parte do gatilho; para junto com os lembretes ignorados.
  const stopped = input.ignoredCueStreak >= IGNORED_STOP && !engagedRecently(snap, now);
  if (!stopped) {
    const pace = paceReminder(input, mergedLogs);
    if (pace) return [pace];
  }

  // Daqui em diante vale o máximo diário de mensagens de hábito (gatilho, check-in e resumo).
  if (input.alreadySentToday >= limit) return [];

  // 1) Lembrete do gatilho.
  if (!stopped && pending.length > 0) {
    const ready = pending
      .filter((r) => !measured.has(r.habit.id))
      .map((r) => ({ r, c: cueMin(r.habit.cue_time) ?? periodCueMin(r.habit.cue_text) }))
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
