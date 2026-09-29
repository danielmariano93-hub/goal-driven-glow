// nino_reminders.v1 — lembretes de obrigações e de ritmo (funções puras).
// ======================================================================
// O Nino avisa ANTES: conta do mês vencendo, fatura do cartão vencendo ou
// fechando, e o balanço da metade do mês. Tudo sai de fatos já calculados pelo
// snapshot canônico (agenda de compromissos, ritmo); nada é estimado aqui além
// de contas simples explicitadas na evidência.
import type { FinancialSituation, MultiFinanceProactiveContext } from "./contracts.ts";
import { brlPt } from "./presentation.ts";
import { saoPauloHour } from "./weekdayNudge.ts";

export const REMINDERS_VERSION = "nino_reminders.v1";

type AgendaItem = {
  name: string;
  type: string;
  amount: number;
  date: string;
  source: string;
  payment_status?: string | null;
};

export type CardCycle = { id: string; name: string; closing_day: number | null };

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

function ddmm(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

function slug(value: string): string {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function base(ctx: MultiFinanceProactiveContext, over: Partial<FinancialSituation> & Pick<FinancialSituation, "fingerprint" | "type" | "communication_kind" | "title" | "body">): FinancialSituation {
  return {
    severity: "attention",
    primary_domain: "commitments",
    domains: ["commitments"],
    signals: [],
    impact_amount: 0,
    days_until: null,
    confidence: 0.9,
    actionable: true,
    route: "/app/compromissos",
    priority_score: 0,
    score_reasons: [],
    evidence: { version: REMINDERS_VERSION, as_of: ctx.as_of, reconciliation_id: ctx.snapshot_ref.reconciliation_id },
    ...over,
  };
}

/** Lembretes só entre 7h e 20h (São Paulo): de madrugada ninguém paga conta. */
export function isReminderHour(now: Date): boolean {
  const hour = saoPauloHour(now);
  return hour >= 7 && hour < 20;
}

/**
 * Contas recorrentes/planejadas vencendo hoje ou amanhã (parcelas de dívida e
 * faturas têm lembretes próprios). Contas do mesmo dia viram UMA mensagem: o
 * WhatsApp só aceita um lembrete deste tipo por dia.
 */
export function billDueReminders(ctx: MultiFinanceProactiveContext): FinancialSituation[] {
  const items = (ctx.domains.commitments ?? []) as AgendaItem[];
  const byDate = new Map<string, AgendaItem[]>();
  for (const item of items) {
    if (item.type !== "expense") continue;
    if (!["recurring", "planned"].includes(String(item.source))) continue;
    if (item.payment_status === "paid") continue;
    const days = daysBetween(ctx.as_of, item.date);
    if (days < 0 || days > 1) continue;
    byDate.set(item.date, [...(byDate.get(item.date) ?? []), item]);
  }
  const out: FinancialSituation[] = [];
  for (const [date, bills] of byDate) {
    const days = daysBetween(ctx.as_of, date);
    const when = days === 0 ? "vence hoje" : "vence amanhã";
    const whenPlural = days === 0 ? "vencem hoje" : "vencem amanhã";
    const total = Math.round(bills.reduce((sum, bill) => sum + (Number(bill.amount) || 0), 0) * 100) / 100;
    const names = bills.map((bill) => bill.name);
    const title = bills.length === 1 ? `${names[0]} ${when}` : `${bills.length} contas ${whenPlural}`;
    const list = bills.length === 1
      ? `${names[0]} ${when} (${ddmm(date)}), cerca de ${brlPt(total)}.`
      : `${whenPlural[0].toUpperCase()}${whenPlural.slice(1)} (${ddmm(date)}): ${bills.map((bill) => `${bill.name} (${brlPt(bill.amount)})`).join(", ")}. Total de ${brlPt(total)}.`;
    out.push(base(ctx, {
      fingerprint: `${REMINDERS_VERSION}:bill:${date}:${days === 0 ? "today" : "eve"}:${names.map(slug).sort().join("+")}`,
      type: "bill_due",
      communication_kind: "bill_due_reminder",
      title,
      body: `${list} Se já pagou, é só me avisar que eu tiro da lista.`,
      impact_amount: total,
      days_until: days,
      evidence: {
        version: REMINDERS_VERSION, as_of: ctx.as_of, reconciliation_id: ctx.snapshot_ref.reconciliation_id,
        bills: bills.map((bill) => ({ name: bill.name, amount: bill.amount, date: bill.date, source: bill.source })),
        total,
      },
    }));
  }
  return out;
}

/** Fatura do cartão vencendo em até 3 dias (e no dia), ainda não paga. */
export function cardDueReminders(ctx: MultiFinanceProactiveContext): FinancialSituation[] {
  const items = (ctx.domains.commitments ?? []) as AgendaItem[];
  const out: FinancialSituation[] = [];
  for (const item of items) {
    if (item.source !== "card_statement" || item.payment_status === "paid") continue;
    const days = daysBetween(ctx.as_of, item.date);
    if (days < 0 || days > 3) continue;
    const stage = days === 0 ? "today" : "soon";
    const when = days === 0 ? "vence hoje" : days === 1 ? "vence amanhã" : `vence em ${days} dias`;
    out.push(base(ctx, {
      fingerprint: `${REMINDERS_VERSION}:card_due:${slug(item.name)}:${item.date}:${stage}`,
      type: "card_due",
      communication_kind: "card_bill_pressure",
      severity: days === 0 ? "critical" : "attention",
      title: `Fatura ${when}`,
      body: `A fatura (${item.name}) de ${brlPt(item.amount)} ${when}, em ${ddmm(item.date)}. Pagar em dia evita juros do rotativo.`,
      primary_domain: "cards",
      domains: ["cards"],
      impact_amount: Number(item.amount) || 0,
      days_until: days,
      route: "/app/cartoes",
      evidence: {
        version: REMINDERS_VERSION, as_of: ctx.as_of, reconciliation_id: ctx.snapshot_ref.reconciliation_id,
        statement: { name: item.name, amount: item.amount, date: item.date },
      },
    }));
  }
  return out;
}

function closingDateOf(today: string, closingDay: number): string {
  const [y, m] = today.split("-").map(Number);
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const thisMonth = `${y}-${String(m).padStart(2, "0")}-${String(Math.min(closingDay, lastDay(y, m))).padStart(2, "0")}`;
  if (thisMonth >= today) return thisMonth;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(closingDay, lastDay(ny, nm))).padStart(2, "0")}`;
}

/**
 * Cartão fechando em 2 dias: dica de momento (compra grande pode esperar o
 * fechamento e cair só na fatura seguinte). Sem valor: não inventa fatura.
 */
export function cardClosingReminders(ctx: MultiFinanceProactiveContext, cards: CardCycle[]): FinancialSituation[] {
  const out: FinancialSituation[] = [];
  for (const card of cards) {
    const day = Number(card.closing_day ?? 0);
    if (!day || day < 1 || day > 31) continue;
    const closing = closingDateOf(ctx.as_of, day);
    const days = daysBetween(ctx.as_of, closing);
    if (days !== 2) continue;
    out.push(base(ctx, {
      fingerprint: `${REMINDERS_VERSION}:card_closing:${card.id}:${closing}`,
      type: "card_closing",
      communication_kind: "card_closing_soon",
      severity: "attention",
      title: `Seu cartão ${card.name} fecha em 2 dias`,
      body: `O ${card.name} fecha em ${ddmm(closing)}. Se tiver uma compra grande planejada, fazer depois do fechamento joga o pagamento para a fatura seguinte e dá mais tempo para o caixa.`,
      primary_domain: "cards",
      domains: ["cards"],
      impact_amount: 0,
      days_until: days,
      confidence: 0.85,
      route: "/app/cartoes",
      evidence: {
        version: REMINDERS_VERSION, as_of: ctx.as_of, reconciliation_id: ctx.snapshot_ref.reconciliation_id,
        card: { id: card.id, name: card.name, closing_day: day, closing_date: closing },
      },
    }));
  }
  return out;
}

/**
 * Ritmo típico confiável: veio do histórico (quando não há histórico o
 * snapshot repete o ritmo do mês, e a comparação vira tautologia) e o mês já
 * tem dias suficientes para a projeção significar algo.
 */
export function isPaceReliable(ctx: MultiFinanceProactiveContext): boolean {
  const cash = (ctx.domains.cash ?? {}) as Record<string, unknown>;
  const typical = Number(ctx.typical_daily_pace ?? 0);
  const current = Number(ctx.daily_pace ?? 0);
  return typical > 0 && Math.abs(typical - current) > 0.005 && Number(cash.days_elapsed ?? 0) >= 10;
}

/**
 * Balanço do meio do mês (dias 14–16, de manhã): quanto já foi e para onde o
 * ritmo leva, contra o típico da pessoa. Só quando o ritmo típico é confiável.
 */
export function midMonthCheckin(
  ctx: MultiFinanceProactiveContext,
  now: Date,
): FinancialSituation | null {
  if (!isPaceReliable(ctx)) return null;
  const day = Number(ctx.as_of.slice(8, 10));
  if (day < 14 || day > 16) return null;
  const hour = saoPauloHour(now);
  if (hour < 8 || hour >= 11) return null;
  const cash = (ctx.domains.cash ?? {}) as Record<string, unknown>;
  const spent = Number(cash.current_month_expense ?? 0);
  const projected = Number(cash.projected_month_expense ?? 0);
  const [y, m] = ctx.as_of.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const typical = Math.round(Number(ctx.typical_daily_pace ?? 0) * daysInMonth * 100) / 100;
  if (spent <= 0 || projected <= 0 || typical <= 0) return null;

  const above = projected > typical * 1.1;
  const diff = Math.abs(Math.round((projected - typical) * 100) / 100);
  const body = above
    ? `Metade do mês: você já gastou ${brlPt(spent)}. No ritmo atual, o mês fecha perto de ${brlPt(projected)}, ${brlPt(diff)} acima do seu típico (${brlPt(typical)}). Ainda dá tempo de ajustar a segunda quinzena.`
    : `Metade do mês: você já gastou ${brlPt(spent)} e, no ritmo atual, fecha perto de ${brlPt(projected)}, dentro do seu típico (${brlPt(typical)}). Bom ritmo, segue assim.`;
  return base(ctx, {
    fingerprint: `${REMINDERS_VERSION}:mid_month:${ctx.as_of.slice(0, 7)}`,
    type: "mid_month_checkin",
    communication_kind: "mid_month_checkin",
    severity: above ? "attention" : "info",
    title: above ? "Metade do mês: o ritmo está acima do seu típico" : "Metade do mês: você está no seu ritmo",
    body,
    primary_domain: "patterns",
    domains: ["patterns"],
    impact_amount: above ? diff : 0,
    days_until: null,
    confidence: 0.8,
    route: "/app/relatorios",
    evidence: {
      version: REMINDERS_VERSION, as_of: ctx.as_of, reconciliation_id: ctx.snapshot_ref.reconciliation_id,
      spent, projected, typical_month: typical, typical_daily_pace: ctx.typical_daily_pace, days_in_month: daysInMonth,
    },
  });
}

/** Todos os lembretes da rodada. Fora do horário diurno, nenhum nasce. */
export function reminderSituations(
  ctx: MultiFinanceProactiveContext,
  now: Date,
  cards: CardCycle[],
): FinancialSituation[] {
  if (!isReminderHour(now)) return [];
  const mid = midMonthCheckin(ctx, now);
  return [
    ...billDueReminders(ctx),
    ...cardDueReminders(ctx),
    ...cardClosingReminders(ctx, cards),
    ...(mid ? [mid] : []),
  ];
}
