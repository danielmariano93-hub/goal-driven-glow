// Hábitos no WhatsApp (F2): marcar, consultar e desfazer por mensagem. Só para quem tem Hábitos liberado (`hb_access`).
// Tudo é determinístico (sem IA) e falha fechado: qualquer dúvida devolve null e a conversa segue o caminho normal.
// O registro vai por `hb_log_as` (mesma regra única da hb_log do app: janela de 7 dias, folgas, idempotência).
import { addDays, summarizeHabit, type HabitDef, type LogRow } from "../habits-core/index.ts";
import { interpretHabitMessage, type HabitIntent, type HabitLite, type HabitStatusWord } from "./interpret.ts";

export type HbSnapshotAs = {
  today: string;
  timezone: string;
  whatsapp_logging: boolean;
  nudges_enabled: boolean;
  max_nudges_per_day: number;
  habits: Array<{
    id: string; title: string; kind: HabitDef["kind"]; started_on: string; days_of_week: number[] | null; weekly_target: number | null;
    quantity_target: number | null; quantity_unit: string | null; quantity_period: "day" | "week" | null; rest_per_week: number; cue_time: string | null;
    cue_text: string | null; minimum_text: string | null;
  }>;
  logs: Array<LogRow & { source?: string; logged_at?: string }>;
};

export type HabitReply = { action: string; reply: string };

/** O mínimo do cliente Supabase de que esta camada precisa (facilita testar com um banco de mentira). */
export type RpcResult = { data: unknown; error: { message?: string } | null };
export type RpcLike = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> };

const RECENT_UNDO_MS = 15 * 60_000;

// Quem não tem Hábitos não paga uma consulta por mensagem: guarda a resposta "não liberado" por 2 minutos.
const NOT_ENABLED_UNTIL = new Map<string, number>();
export const resetHabitGateCache = () => NOT_ENABLED_UNTIL.clear();

const toDef = (h: HbSnapshotAs["habits"][number]): HabitDef => ({
  id: h.id, kind: h.kind, started_on: h.started_on, days_of_week: h.days_of_week, weekly_target: h.weekly_target,
  quantity_target: h.quantity_target, quantity_period: h.quantity_period, rest_per_week: h.rest_per_week,
});

/** Minutos desde 00:00 no fuso da pessoa. */
export function localMinutes(now: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const v = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return v("hour") * 60 + v("minute");
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

const cueMinutes = (cue: string | null): number | null => {
  if (!cue) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(cue);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

type View = { habit: HbSnapshotAs["habits"][number]; def: HabitDef; summary: ReturnType<typeof summarizeHabit> };

function views(snap: HbSnapshotAs, logs: LogRow[]): View[] {
  return snap.habits.map((habit) => {
    const def = toDef(habit);
    return { habit, def, summary: summarizeHabit(def, logs, snap.today, []) };
  });
}

const isDue = (v: View) => v.summary.model === "daily" && v.summary.today.outcome !== "not_expected" && v.summary.today.outcome !== "rest";
const isResolved = (v: View) => v.summary.today.outcome === "done" || v.summary.today.outcome === "minimum";

/** "Hoje: 3 de 4" para os hábitos diários previstos hoje. */
export function todayCount(vs: View[]): { done: number; total: number } {
  const due = vs.filter(isDue);
  return { done: due.filter(isResolved).length, total: due.length };
}

export function statusReply(vs: View[]): string | null {
  const due = vs.filter(isDue);
  const weekly = vs.filter((v) => v.summary.model === "weekly");
  if (due.length === 0 && weekly.length === 0) return null;
  const lines: string[] = [];
  if (due.length > 0) {
    const done = due.filter(isResolved);
    const missing = due.filter((v) => !isResolved(v));
    lines.push(`Hoje: ${done.length} de ${due.length}.`);
    if (done.length > 0) lines.push(`Feitos: ${done.map((v) => v.habit.title).join(", ")}.`);
    lines.push(missing.length > 0 ? `Falta: ${missing.map((v) => v.habit.title).join(", ")}.` : "Tudo marcado por hoje.");
  }
  for (const v of weekly) {
    const w = v.summary.week;
    if (w) lines.push(`${v.habit.title}: ${Math.min(Math.round(w.count * 10) / 10, 99)} de ${w.target} esta semana.`);
  }
  return lines.join("\n");
}

const STATUS_PT: Record<HabitStatusWord, string> = { done: "fiz", minimum: "mínimo", skipped: "hoje não", rest: "folga", quantity: "fiz" };

function logReply(v: View, status: HabitStatusWord, quantity: number | undefined, all: View[], day: "today" | "yesterday"): string {
  const { habit, summary } = v;
  const when = day === "yesterday" ? " de ontem" : "";
  const count = day === "today" ? todayCount(all) : null;
  const tail = count && count.total > 0 ? ` Hoje: ${count.done} de ${count.total}.` : "";
  const streak = summary.streak >= 2 && (status === "done" || status === "minimum" || status === "quantity")
    ? ` ${plural(summary.streak, summary.model === "weekly" ? "semana seguida" : "dia seguido", summary.model === "weekly" ? "semanas seguidas" : "dias seguidos")}.`
    : "";
  switch (status) {
    case "done":
      return `Marcado${when}: ${habit.title}.${streak}${tail}`;
    case "minimum":
      return `Marcada a versão mínima${when} de ${habit.title}${habit.minimum_text ? ` (${habit.minimum_text})` : ""}. Conta como feito.${streak}${tail}`;
    case "quantity": {
      const target = habit.quantity_target ?? 0;
      const unit = habit.quantity_unit ? ` ${habit.quantity_unit}` : "";
      const q = quantity ?? 0;
      return q >= target
        ? `Anotei${when}: ${q}${unit} em ${habit.title}. Meta batida.${streak}${tail}`
        : `Anotei${when}: ${q} de ${target}${unit} em ${habit.title}. Faltam ${Math.round((target - q) * 100) / 100}.${tail}`;
    }
    case "skipped":
      return `Anotado: ${habit.title}${when} não rolou. Sem culpa, amanhã é outro dia.${tail}`;
    case "rest":
      return `Folga${when} de ${habit.title} registrada. A sequência continua.${tail}`;
  }
}

function errorReply(message: string, title: string): string | null {
  if (message.includes("rest_budget_exhausted")) return `As folgas desta semana de ${title} acabaram. Quer marcar como não feito?`;
  if (message.includes("edit_window_closed")) return "Só dá para corrigir os últimos 7 dias.";
  if (message.includes("before_start")) return `${title} ainda não tinha começado nesse dia.`;
  if (message.includes("habit_not_active")) return `${title} está arquivado.`;
  return null;
}

export async function handleHabitReply(
  client: unknown,
  args: { userId: string; text: string; idempotencyKey?: string | null; now?: Date },
): Promise<HabitReply | null> {
  const sb = client as RpcLike;
  const now = args.now ?? new Date();
  const until = NOT_ENABLED_UNTIL.get(args.userId);
  if (until && until > now.getTime()) return null;

  const { data, error } = await sb.rpc("hb_snapshot_as", { p_user: args.userId, p_days: 60 });
  if (error) throw new Error(`hb_snapshot_as: ${String(error.message ?? error).slice(0, 120)}`);
  if (!data) {
    NOT_ENABLED_UNTIL.set(args.userId, now.getTime() + 120_000);
    return null;
  }
  const snap = data as HbSnapshotAs;
  if (!snap.whatsapp_logging || snap.habits.length === 0) return null;

  const all = views(snap, snap.logs);
  const nowMin = localMinutes(now, snap.timezone);
  const due = all.filter((v) => isDue(v) && v.summary.today.outcome === "unlogged");
  const dueNow = due.filter((v) => {
    const c = cueMinutes(v.habit.cue_time);
    return c == null || c <= nowMin;
  });
  const recent = snap.logs
    .filter((l) => l.source === "whatsapp" && l.logged_at && now.getTime() - Date.parse(l.logged_at) <= RECENT_UNDO_MS)
    .sort((a, b) => String(b.logged_at).localeCompare(String(a.logged_at)))[0];

  const lite: HabitLite[] = snap.habits.map((h) => ({ id: h.id, title: h.title, kind: h.kind, quantity_target: h.quantity_target, quantity_unit: h.quantity_unit, cue_time: h.cue_time }));
  const intent: HabitIntent | null = interpretHabitMessage(args.text, {
    habits: lite, dueUnlogged: due.map((v) => v.habit.id), dueNow: dueNow.map((v) => v.habit.id), recentWhatsappLog: !!recent,
  });
  if (!intent) return null;

  if (intent.kind === "status") {
    const reply = statusReply(all);
    return reply ? { action: "habit_status", reply } : null;
  }

  if (intent.kind === "undo") {
    if (!recent) return null;
    const v = all.find((x) => x.habit.id === recent.habit_id);
    const { error: undoErr } = await sb.rpc("hb_unlog_as", { p_user: args.userId, p_habit: recent.habit_id, p_date: recent.local_date });
    if (undoErr) throw new Error(`hb_unlog_as: ${String(undoErr.message ?? undoErr).slice(0, 120)}`);
    return { action: "habit_undo", reply: `Desfeito: ${v?.habit.title ?? "o registro"} voltou a ficar em aberto.` };
  }

  if (intent.kind === "ask") {
    const names = intent.candidates.map((id) => snap.habits.find((h) => h.id === id)?.title).filter((t): t is string => !!t);
    if (names.length === 0) return null;
    return {
      action: "habit_ask",
      reply: `Qual hábito? ${names.join(", ")}.\nResponda, por exemplo: "${STATUS_PT[intent.status]} ${names[0].toLowerCase()}".`,
    };
  }

  const v = all.find((x) => x.habit.id === intent.habit_id);
  if (!v) return null;
  const date = intent.day === "yesterday" ? addDays(snap.today, -1) : snap.today;
  const { error: logErr } = await sb.rpc("hb_log_as", {
    p_user: args.userId, p_habit: v.habit.id, p_date: date, p_status: intent.status,
    p_quantity: intent.status === "quantity" ? intent.quantity ?? null : null, p_note: null, p_source: "whatsapp",
    p_idem: args.idempotencyKey ? `${args.idempotencyKey}:${v.habit.id}` : null,
  });
  if (logErr) {
    const friendly = errorReply(String(logErr.message ?? ""), v.habit.title);
    if (friendly) return { action: "habit_rejected", reply: friendly };
    throw new Error(`hb_log_as: ${String(logErr.message ?? logErr).slice(0, 120)}`);
  }
  const newLog: LogRow = { habit_id: v.habit.id, local_date: date, status: intent.status, quantity: intent.status === "quantity" ? intent.quantity ?? null : null };
  const logs2 = [...snap.logs.filter((l) => !(l.habit_id === newLog.habit_id && l.local_date === newLog.local_date)), newLog];
  const all2 = views(snap, logs2);
  const v2 = all2.find((x) => x.habit.id === v.habit.id)!;
  return {
    action: `habit_log_${intent.status}`,
    reply: `${logReply(v2, intent.status, intent.kind === "log" ? intent.quantity : undefined, all2, intent.day)}\nSe foi engano, responda "desfaz".`,
  };
}
