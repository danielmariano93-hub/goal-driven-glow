// nino_day_plan_offer.v1 — plano do dia crítico (não só sexta), função pura.
//
// A sexta já tinha convite ("topo") e fechamento (segunda). Este módulo generaliza para o dia da semana em que a
// PESSOA gasta mais numa categoria (o padrão dela, não um dia fixo):
//  - o convite muda conforme a meta da categoria: cabe no ritmo / vai estourar / já estourou / sem meta;
//  - corte grande vira um degrau no meio do caminho (nunca pede de uma vez mais que 25%);
//  - no dia seguinte, o fechamento diz como foi numa nota graduada (dentro do plano / abaixo do padrão / acima).
// Espelha `src/lib/behavioral/dayPlanCreate.ts` (suggestTarget) e `dayPlan.ts` (gradeDayPlan): há teste de paridade.
// Só existe com a flag `critical_day_plan_v1`.
import type { FinancialSituation, MultiFinanceProactiveContext } from "./contracts.ts";
import { isWeekdayNudgeWindow, type NudgeTransaction, type WeekdayProjection } from "./weekdayNudge.ts";
import { money0, type WeekendOffer } from "./weekendMessages.ts";

export const DAY_PLAN_OFFER_VERSION = "nino_day_plan_offer.v1";

/** Corte máximo pedido de uma vez; acima disso o plano propõe um degrau. */
export const MAX_DIRECT_CUT = 0.25;
/** Sem meta: redução pequena e fácil de testar sobre o padrão. */
export const NO_GOAL_CUT = 0.1;
/** Abaixo disso o resultado não conta como "abaixo do seu padrão" (ruído do dia a dia). */
export const TYPICAL_NOISE_MARGIN = 0.1;

export type PlanSuggestion = {
  typical: number;
  goalRoom: number | null;
  target: number;
  cutPct: number;
  kind: "goal_fits" | "goal_direct" | "goal_step" | "average_cut" | "no_history";
};

export function suggestPlanTarget(input: { typical: number; goalRoom: number | null }): PlanSuggestion {
  const typical = Math.max(0, input.typical);
  const room = input.goalRoom == null ? null : Math.max(0, input.goalRoom);
  if (typical <= 0) return { typical: 0, goalRoom: room, target: room != null ? Math.round(room) : 0, cutPct: 0, kind: "no_history" };
  if (room == null) {
    const target = Math.round(typical * (1 - NO_GOAL_CUT));
    return { typical, goalRoom: null, target, cutPct: 1 - target / typical, kind: "average_cut" };
  }
  if (room >= typical) return { typical, goalRoom: room, target: Math.round(typical), cutPct: 0, kind: "goal_fits" };
  const cut = 1 - room / typical;
  if (cut <= MAX_DIRECT_CUT) return { typical, goalRoom: room, target: Math.round(room), cutPct: cut, kind: "goal_direct" };
  const step = Math.round(typical - (typical - room) / 2);
  return { typical, goalRoom: room, target: step, cutPct: 1 - step / typical, kind: "goal_step" };
}

export type DayPlanBand = "met" | "partial" | "missed";
export type DayPlanGrade = { band: DayPlanBand; vs_typical_pct: number | null; over_target: number };

export function gradeDayPlan(input: { target: number; expected: number | null; realized: number }): DayPlanGrade {
  const { target, expected, realized } = input;
  const over = Math.max(0, Math.round((realized - target) * 100) / 100);
  const vs = expected != null && expected > 0 ? Math.round(((expected - realized) / expected) * 100) : null;
  const belowTypical = expected != null && expected > 0 && realized <= expected * (1 - TYPICAL_NOISE_MARGIN);
  if (realized <= target) return { band: "met", vs_typical_pct: vs, over_target: 0 };
  if (belowTypical && vs != null) return { band: "partial", vs_typical_pct: vs, over_target: over };
  return { band: "missed", vs_typical_pct: vs, over_target: over };
}

/** Situação da meta da categoria no momento do convite. */
export type GoalState = "pace" | "exceeded" | "no_goal";

export function goalStateOf(projection: WeekdayProjection): GoalState {
  if (projection.anchor.kind !== "goal") return "no_goal";
  return projection.month_to_date >= projection.anchor.amount ? "exceeded" : "pace";
}

const WEEKDAY_LABEL = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const WEEKDAY_PLURAL = ["domingos", "segundas", "terças", "quartas", "quintas", "sextas", "sábados"];
const bold = (text: string) => `*${text}*`;
const plain = (text: string) => text.replace(/\*/g, "");
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Ocorrências do dia da semana de hoje (inclusive) até o fim do mês. */
export function occurrencesLeftInMonth(today: string, weekday: number): number {
  const [y, m, d] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let n = 0;
  for (let day = d; day <= last; day += 1) if (new Date(Date.UTC(y, m - 1, day)).getUTCDay() === weekday) n += 1;
  return n;
}

export type DayPlanOffer = {
  state: GoalState;
  suggestion: PlanSuggestion & { exceeded?: boolean };
  offer: WeekendOffer;
  whatsapp: { title: string; body: string };
  title: string;
  body: string;
};

export function composeDayPlanOffer(projection: WeekdayProjection, today: string): DayPlanOffer | null {
  const { pattern } = projection;
  const typical = pattern.typical_on_weekday;
  if (!(typical > 0)) return null;
  const state = goalStateOf(projection);
  const left = Math.max(1, occurrencesLeftInMonth(today, pattern.weekday));

  let suggestion: PlanSuggestion & { exceeded?: boolean };
  if (state === "exceeded") {
    // Meta já ultrapassada: não há "o que cabe". O passo é o corte máximo direto, para não ampliar o estouro.
    const target = Math.round(typical * (1 - MAX_DIRECT_CUT));
    suggestion = { typical, goalRoom: 0, target, cutPct: MAX_DIRECT_CUT, kind: "goal_step", exceeded: true };
  } else if (state === "pace") {
    const projectedOther = projection.projected_month - typical * left;
    const room = Math.max(0, (projection.anchor.amount - projectedOther) / left);
    suggestion = suggestPlanTarget({ typical, goalRoom: round2(room) });
  } else {
    suggestion = suggestPlanTarget({ typical, goalRoom: null });
  }
  if (!(suggestion.target > 0)) return null;

  const label = WEEKDAY_LABEL[pattern.weekday];
  const category = pattern.category;
  const anchorWord = projection.anchor.kind === "goal" ? "meta" : "média dos últimos 3 meses";
  const title = `🎯 Hoje é ${label}: um plano para ${category}`;
  const habit = `Em ${pattern.occurrences} das últimas ${pattern.weeks} ${WEEKDAY_PLURAL[pattern.weekday]} você gastou com ${category}, em média ${bold(money0(typical))} por ${label}.`;

  const stateBlock = state === "exceeded"
    ? `⚠️ A meta de ${category} (${money0(projection.anchor.amount)}) já foi ultrapassada: você está em ${bold(money0(projection.month_to_date))} no mês. Agora o objetivo é não ampliar.`
    : state === "pace"
      ? `📈 No ritmo atual, ${category} fecha o mês em ${bold(money0(projection.projected_month))}, ${bold(`${money0(projection.projected_month - projection.anchor.amount)} acima`)} da meta (${money0(projection.anchor.amount)}).`
      : `ℹ️ Você não tem meta em ${category}. No ritmo atual o mês fecha em ${bold(money0(projection.projected_month))}; a ${anchorWord} é ${money0(projection.anchor.amount)}.`;

  const why = suggestion.exceeded
    ? `Sugiro um passo pequeno: até ${bold(money0(suggestion.target))} hoje (25% abaixo do seu padrão).`
    : suggestion.kind === "goal_step"
      ? `Para fechar na meta caberiam uns ${bold(money0(suggestion.goalRoom ?? 0))} por ${label}, um corte grande. Sugiro um passo no meio do caminho: ${bold(money0(suggestion.target))}.`
      : suggestion.kind === "goal_direct"
        ? `Para fechar na meta, cabem uns ${bold(money0(suggestion.target))} hoje.`
        : suggestion.kind === "goal_fits"
          ? `O seu padrão (${money0(typical)}) já cabe na meta. Manter ${bold(money0(suggestion.target))} hoje já ajuda.`
          : `Sugiro uma redução pequena e fácil de testar: até ${bold(money0(suggestion.target))} hoje (10% abaixo do seu padrão).`;

  const question = `Topa ficar em ${money0(suggestion.target)} hoje?`;
  const reply = `Responda ${bold("topo")} e amanhã eu te conto como foi.`;
  const shared = [habit, stateBlock, why];
  const waBody = [...shared, question, reply].join("\n\n");

  const offer: WeekendOffer = {
    category,
    friday: today,
    target: suggestion.target,
    expected: typical,
    projected_before: projection.projected_month,
    projected_if_target: round2(projection.projected_month - typical + suggestion.target),
    anchor: { kind: projection.anchor.kind, amount: projection.anchor.amount },
  };
  return { state, suggestion, offer, title: plain(title), body: shared.map(plain).join("\n\n"), whatsapp: { title: plain(title), body: waBody } };
}

/** Acrescenta o convite ao aviso de dia útil já existente (mesma mensagem, mesma vaga). */
export function withDayPlanOffer(
  nudge: FinancialSituation,
  projection: WeekdayProjection,
  today: string,
): FinancialSituation {
  // Sexta já tem o convite do fim de semana; fim de semana também (bloco sex a dom).
  if (projection.pattern.weekday === 5 || projection.pattern.weekday === 6 || projection.pattern.weekday === 0) return nudge;
  const composed = composeDayPlanOffer(projection, today);
  if (!composed) return nudge;
  return {
    ...nudge,
    title: composed.title,
    body: composed.body,
    evidence: {
      ...(nudge.evidence as Record<string, unknown>),
      day_plan_version: DAY_PLAN_OFFER_VERSION,
      day_plan_state: composed.state,
      day_plan_kind: composed.suggestion.kind,
      offer: composed.offer,
      whatsapp: composed.whatsapp,
    },
  };
}

export type AcceptedDayPlan = { category: string; date: string; target: number; expected: number | null };

export type DayPlanRecap = AcceptedDayPlan & { realized: number; grade: DayPlanGrade; kept: boolean };

/** Fechamento do dia seguinte: gasto real da categoria na data do plano (compra do dia, só despesa). */
export function buildDayPlanRecaps(plans: AcceptedDayPlan[], txs: NudgeTransaction[]): DayPlanRecap[] {
  return plans.map((p) => {
    const realized = round2(txs
      .filter((t) => t.category === p.category && t.occurred_at.slice(0, 10) === p.date && Number(t.amount) > 0)
      .reduce((s, t) => s + Number(t.amount), 0));
    return { ...p, realized, grade: gradeDayPlan({ target: p.target, expected: p.expected, realized }), kept: realized <= p.target };
  });
}

export function composeDayPlanRecap(recap: DayPlanRecap): { title: string; body: string; whatsapp: { title: string; body: string } } {
  const label = WEEKDAY_LABEL[new Date(`${recap.date}T12:00:00Z`).getUTCDay()];
  const planned = `Você combinou ficar em ${bold(money0(recap.target))} com ${recap.category} e gastou ${bold(money0(recap.realized))}.`;
  const vs = recap.grade.vs_typical_pct;
  const expected = recap.expected != null ? money0(recap.expected) : null;
  let title: string;
  const content: string[] = [planned];
  if (recap.grade.band === "met") {
    title = `✅ Plano cumprido: ${recap.category}`;
    content.push(vs != null && vs > 0 && expected ? `🎉 Foram ${bold(`${vs}% a menos`)} que o seu padrão de ${label} (${expected}).` : "🎉 Ficou dentro do plano.");
  } else if (recap.grade.band === "partial") {
    title = `🔎 Como foi o plano de ${label}: ${recap.category}`;
    content.push(`Passou ${bold(money0(recap.grade.over_target))} do combinado, mas ficou ${bold(`${vs}% abaixo`)} do seu padrão (${expected}). É um passo real.`);
  } else {
    title = `🔎 Como foi o plano de ${label}: ${recap.category}`;
    content.push(`Passou ${bold(money0(recap.grade.over_target))} do combinado e ficou perto do seu padrão. Acontece.`);
    content.push("Se quiser me contar o que pesou no dia, é só responder; isso me ajuda a ajustar o próximo plano.");
  }
  const body = content.join("\n\n");
  return { title: plain(title), body: plain(body), whatsapp: { title: plain(title), body } };
}

export function dayPlanRecapSituation(
  recaps: DayPlanRecap[],
  ctx: Pick<MultiFinanceProactiveContext, "as_of" | "snapshot_ref">,
  now: Date,
): FinancialSituation | null {
  if (!recaps.length) return null;
  if (!isWeekdayNudgeWindow(now)) return null;
  const recap = recaps[0];
  const message = composeDayPlanRecap(recap);
  return {
    fingerprint: `${DAY_PLAN_OFFER_VERSION}:recap:${recap.category}:${recap.date}`,
    type: "day_plan_recap",
    // Mesma família do fechamento de segunda; evita o cooldown de 24h do aviso `weekday_spending_risk` de ontem.
    communication_kind: "weekend_spending_risk",
    severity: recap.grade.band === "missed" ? "attention" : "info",
    title: message.title,
    body: message.body,
    primary_domain: "patterns",
    domains: ["patterns"],
    signals: [],
    impact_amount: Math.abs(recap.realized - recap.target),
    days_until: 0,
    confidence: 0.8,
    actionable: false,
    route: "/app/metas",
    priority_score: 0,
    score_reasons: [],
    evidence: {
      version: DAY_PLAN_OFFER_VERSION,
      as_of: ctx.as_of,
      reconciliation_id: ctx.snapshot_ref.reconciliation_id,
      recap,
      whatsapp: message.whatsapp,
      commitment_outcomes: recaps.map((r) => ({ category: r.category, friday: r.date, realized: r.realized, kept: r.kept })),
    },
  };
}
