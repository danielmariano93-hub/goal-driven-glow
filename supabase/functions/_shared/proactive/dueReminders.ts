// nino_due_reminders.v1 — lembrete de vencimento no WhatsApp (funções puras).
// ===========================================================================
// Canal DEDICADO e previsível: quem ligou o aviso recebe, no horário escolhido, UMA mensagem
// com o que vence hoje e/ou nos próximos dias combinados (padrão: amanhã e hoje).
// Não disputa vaga com dicas e insights: a fonte é a agenda canônica de compromissos
// (`commitment_agenda`), a mesma da tela "Próximos compromissos".
//
// Regras:
//  • só saída (despesa) ainda não paga; parcela estimada de cartão fica de fora (a fatura cobre);
//  • cada obrigação avisa uma vez por etapa (D-3, D-1, hoje) — o log impede repetir;
//  • todas as etapas do dia saem juntas, numa única mensagem;
//  • atraso não é daqui: dívida em atraso tem o próprio fluxo.
export const DUE_REMINDERS_VERSION = "nino_due_reminders.v1";

export const DUE_REMINDER_SOURCES = ["card_statement", "debt_installment", "recurring", "planned", "donation_goal"] as const;
export const ALLOWED_DAYS_BEFORE = [0, 1, 2, 3, 5, 7] as const;
export const DEFAULT_DAYS_BEFORE = [1, 0];
export const DEFAULT_REMINDER_HOUR = 9;
const MAX_LISTED_PER_STAGE = 6;

export type AgendaItem = {
  id?: string;
  name: string;
  type: string;
  amount: number;
  date: string;
  source: string;
  estimated?: boolean;
  dedupKey?: string;
  payment_status?: string | null;
};

export type DueReminderStage = { days: number; items: AgendaItem[]; keys: string[] };
export type DueReminderPlan = { stages: DueReminderStage[]; message: string | null; keys: Array<{ key: string; days: number; due_date: string }> };

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const brl = (n: number) => `R$ ${Number(n).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

/** Normaliza a lista de antecedências: só valores permitidos, sem repetir, do mais distante ao dia. */
export function normalizeDaysBefore(value: unknown): number[] {
  const list = Array.isArray(value) ? value.map(Number) : [];
  const allowed = [...new Set(list.filter((n) => (ALLOWED_DAYS_BEFORE as readonly number[]).includes(n)))];
  return (allowed.length ? allowed : DEFAULT_DAYS_BEFORE).sort((a, b) => b - a);
}

/** Chave estável da obrigação (a mesma conta no mesmo vencimento gera a mesma chave). */
export function obligationKey(item: AgendaItem): string {
  return `${item.source}:${item.dedupKey || item.id || item.name}:${item.date}`;
}

/** O que entra nos lembretes: saída, não paga, fonte conhecida e com data. */
export function reminderEligible(item: AgendaItem): boolean {
  return item.type === "expense"
    && (DUE_REMINDER_SOURCES as readonly string[]).includes(String(item.source))
    && item.payment_status !== "paid"
    && Number(item.amount) > 0
    && /^\d{4}-\d{2}-\d{2}$/.test(String(item.date));
}

function whenLabel(days: number, date: string): string {
  if (days === 0) return `Hoje (${ddmm(date)})`;
  if (days === 1) return `Amanhã (${ddmm(date)})`;
  return `Em ${days} dias (${ddmm(date)})`;
}

function line(item: AgendaItem): string {
  const approx = item.estimated ? "cerca de " : "";
  return `• ${item.name} — ${approx}${brl(item.amount)}`;
}

/** Texto único do dia: todas as etapas, do mais próximo ao mais distante, tom leve e direto. */
export function composeDueMessage(stages: DueReminderStage[]): string | null {
  const filled = stages.filter((s) => s.items.length > 0).sort((a, b) => a.days - b.days);
  if (filled.length === 0) return null;
  const total = filled.reduce((sum, s) => sum + s.items.reduce((x, i) => x + Number(i.amount), 0), 0);
  const count = filled.reduce((sum, s) => sum + s.items.length, 0);

  const head = filled.length === 1 && filled[0].days === 0
    ? (count === 1 ? "⏰ *Vence hoje*" : "⏰ *Vencem hoje*")
    : filled.length === 1 && filled[0].days === 1
    ? (count === 1 ? "📅 *Vence amanhã*" : "📅 *Vencem amanhã*")
    : "📅 *Seus próximos vencimentos*";

  const blocks = filled.map((stage) => {
    const items = stage.items.slice(0, MAX_LISTED_PER_STAGE);
    const extra = stage.items.length - items.length;
    const date = stage.items[0].date;
    const title = filled.length === 1 && stage.days <= 1 ? "" : `*${whenLabel(stage.days, date)}*\n`;
    return `${title}${items.map(line).join("\n")}${extra > 0 ? `\n• e mais ${extra}` : ""}`;
  });

  const totalLine = count > 1 ? `Total: ${brl(Math.round(total * 100) / 100)}` : "";
  const foot = "Se já pagou, é só me avisar que eu tiro da lista. 😉";
  return [head, ...blocks, totalLine, foot].filter(Boolean).join("\n\n").slice(0, 1800);
}

/**
 * Plano do dia: filtra a agenda pelas antecedências escolhidas, tira o que já foi avisado
 * (`sentKeys` = "chave|dias") e compõe a mensagem. `message` é null quando não há o que avisar.
 */
export function planDueReminders(args: {
  items: AgendaItem[];
  asOf: string;
  daysBefore: number[];
  sentKeys: ReadonlySet<string>;
}): DueReminderPlan {
  const wanted = new Set(normalizeDaysBefore(args.daysBefore));
  const stages = new Map<number, DueReminderStage>();
  const seen = new Set<string>();
  for (const item of args.items) {
    if (!reminderEligible(item)) continue;
    const days = daysBetween(args.asOf, item.date);
    if (!wanted.has(days)) continue;
    const key = obligationKey(item);
    if (seen.has(`${key}|${days}`) || args.sentKeys.has(`${key}|${days}`)) continue;
    seen.add(`${key}|${days}`);
    const stage = stages.get(days) ?? { days, items: [], keys: [] };
    stage.items.push(item);
    stage.keys.push(key);
    stages.set(days, stage);
  }
  const ordered = [...stages.values()].sort((a, b) => a.days - b.days);
  for (const stage of ordered) stage.items.sort((a, b) => b.amount - a.amount);
  return {
    stages: ordered,
    message: composeDueMessage(ordered),
    keys: ordered.flatMap((s) => s.items.map((item) => ({ key: obligationKey(item), days: s.days, due_date: item.date }))),
  };
}

/** Horário permitido: dentro da janela diurna do usuário (fora do silêncio configurado). */
export function clampReminderHour(hour: unknown, quietStart = "21:00", quietEnd = "08:00"): number {
  const requested = Number.isFinite(Number(hour)) ? Math.floor(Number(hour)) : DEFAULT_REMINDER_HOUR;
  const startHour = Number(String(quietStart).slice(0, 2));
  const endHour = Number(String(quietEnd).slice(0, 2));
  const lo = Number.isFinite(endHour) ? endHour : 8;
  const hi = (Number.isFinite(startHour) ? startHour : 21) - 1;
  return Math.min(Math.max(requested, Math.min(lo, hi)), Math.max(lo, hi));
}

/**
 * Quando o lembrete dedicado está ligado, o WhatsApp do motor proativo não repete o mesmo aviso
 * (conta/fatura/parcela a vencer). Atraso e o resto continuam com o motor proativo.
 */
export function coveredByDueReminders(situation: { communication_kind: string; type?: string; days_until?: number | null }): boolean {
  const days = situation.days_until ?? 99;
  if (situation.communication_kind === "bill_due_reminder") return true;
  if (situation.communication_kind === "debt_due_soon") return days <= 7;
  if (situation.communication_kind === "card_bill_pressure" && situation.type === "card_due") return true;
  if (situation.communication_kind === "expected_recurring_payment") return days <= 1;
  return false;
}
