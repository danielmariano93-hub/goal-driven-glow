// nino_spending_goals_comm.v1 — comunicação ativa das metas de gasto
// (categoria + submetas por estabelecimento). Funções puras: todos os valores
// vêm da leitura canônica (`spending_goals.v1`); aqui só se decide o que dizer.
//
// O valor não está em cadastrar a meta, e sim em intervir enquanto ainda dá
// tempo de corrigir o mês: desvio com responsável e valor disponível, cobrança
// em submeta zerada, 75% usado cedo demais, fim de semana de risco e os
// fechamentos semanal e mensal com a economia medida.
import type { FinancialSituation, MultiFinanceProactiveContext, SituationSeverity } from "./contracts.ts";
import { brlPt } from "./presentation.ts";
import { summarizeClosedCycle, weekendAllowance } from "../finance-core/spendingGoals.ts";
import { goalHistoryOf, type GoalReading, type SpendingGoalContext } from "../spendingGoals/runtime.ts";

export const SPENDING_GOALS_COMM_VERSION = "nino_spending_goals_comm.v1";

/** Tipos que valem pelo que orientam (não pelo valor) e têm identidade por período. */
export const SPENDING_GOAL_ORIENTATION_KINDS = new Set(["spending_goal_weekend", "spending_goal_weekly", "spending_goal_monthly"]);

const brl = brlPt;
const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1] ?? ym;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function weekday(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function make(
  ctx: MultiFinanceProactiveContext,
  over: Pick<FinancialSituation, "type" | "communication_kind" | "title" | "body"> & {
    anchor: string;
    severity: SituationSeverity;
    impact: number;
    route: string;
    days_until?: number | null;
    evidence?: Record<string, unknown>;
  },
): FinancialSituation {
  return {
    fingerprint: `${SPENDING_GOALS_COMM_VERSION}:${over.type}:${over.anchor}`,
    type: over.type,
    communication_kind: over.communication_kind,
    severity: over.severity,
    title: over.title,
    body: over.body,
    primary_domain: "goals",
    domains: ["goals"],
    signals: [],
    impact_amount: Math.round(Math.abs(over.impact) * 100) / 100,
    days_until: over.days_until ?? null,
    confidence: 0.9,
    actionable: true,
    route: over.route,
    priority_score: 0,
    score_reasons: [],
    evidence: {
      version: SPENDING_GOALS_COMM_VERSION,
      as_of: ctx.as_of,
      reconciliation_id: ctx.snapshot_ref.reconciliation_id,
      ...(over.evidence ?? {}),
    },
  };
}

const route = (goalId: string) => `/app/metas/categoria/${goalId}`;
const OPEN = new Set(["on_track", "attention", "at_risk", "exceeded", "limit_reached"]);

/** "Para cumprir a meta": R$/dia quando faz sentido, senão o saldo do período. */
function availableText(r: GoalReading): string {
  const remaining = Math.max(0, r.limit - r.actual);
  if (remaining <= 0) return "O limite já foi usado; cada novo gasto aumenta o excesso.";
  if (r.supports_daily_budget && r.daily_allowance > 0 && r.breakdown.remaining_days > 0) {
    return `Para cumprir a meta, o disponível é ${brl(r.daily_allowance)} por dia até ${ddmm(r.period.end)} (${brl(remaining)} no total).`;
  }
  return `Para cumprir a meta, restam ${brl(remaining)} até ${ddmm(r.period.end)}.`;
}

/** Desvio da meta com o responsável: a leitura que muda comportamento. */
function pressureSituation(ctx: MultiFinanceProactiveContext, r: GoalReading): FinancialSituation | null {
  if (!OPEN.has(r.status)) return null;
  const b = r.breakdown;
  const overNow = r.current_overage > 0;
  const overProjected = r.projected_overage > 0 && (r.status === "at_risk" || r.status === "attention" || b.pace === "ahead");
  if (!overNow && !overProjected) return null;
  const driver = b.main_driver;
  const recent = driver?.target_id
    ? b.targets.find((t) => t.id === driver.target_id && t.last_charge && t.last_charge.date >= addDays(ctx.as_of, -1))
    : null;
  const parts: string[] = [];
  if (recent?.last_charge) {
    parts.push(`O gasto de ${brl(recent.last_charge.amount)} em ${recent.label} entrou na submeta de ${recent.label} e também na meta de ${r.category_name}.`);
  }
  parts.push(`Você já usou ${pct(b.consumed_share)} da meta de ${r.category_name} com ${pct(b.elapsed_share)} do período.`);
  if (driver) {
    parts.push(`O principal responsável é ${driver.label} (${brl(driver.amount)}, ${pct(driver.share)} da categoria)${driver.reason === "over_target" ? ", acima do limite da submeta" : ""}.`);
  }
  parts.push(overNow
    ? `O limite de ${brl(r.limit)} já foi ultrapassado em ${brl(r.current_overage)}.`
    : `Mantendo o comportamento atual, ${r.category_name} fecha em ${brl(r.projected)}, ${brl(r.projected_overage)} acima do limite.`);
  parts.push(availableText(r));
  return make(ctx, {
    type: "spending_goal_pressure",
    communication_kind: "spending_goal_pressure",
    title: overNow
      ? `${r.category_name} passou o limite em ${brl(r.current_overage)}`
      : `${r.category_name} está acima do ritmo da meta`,
    body: parts.join(" "),
    anchor: `${r.goal_id}:${r.period.start}:${overNow ? "over" : "pace"}`,
    severity: overNow ? "critical" : "attention",
    impact: overNow ? r.current_overage : r.projected_overage,
    route: route(r.goal_id),
    days_until: b.remaining_days,
    evidence: { goal_id: r.goal_id, category_id: r.category_id, main_driver: driver, consumed_share: b.consumed_share, elapsed_share: b.elapsed_share, projected: r.projected, limit: r.limit },
  });
}

/** Cobrança nova onde a submeta é zero: assinatura esquecida ou renovação. */
function zeroChargeSituations(ctx: MultiFinanceProactiveContext, r: GoalReading): FinancialSituation[] {
  return r.breakdown.targets
    .filter((t) => t.status === "zero_violated" && t.last_charge)
    .map((t) => make(ctx, {
      type: "spending_goal_zero_charge",
      communication_kind: "spending_goal_zero_charge",
      title: `Nova cobrança em ${t.label}`,
      body: `Identifiquei uma cobrança de ${brl(t.last_charge!.amount)} em ${t.label} em ${ddmm(t.last_charge!.date)}, e a submeta desse estabelecimento é zero. Pode ser uma assinatura ainda ativa ou uma renovação automática: vale cancelar ou pedir o estorno.`,
      anchor: `${t.id}:${t.last_charge!.date}`,
      severity: "critical",
      impact: t.actual,
      route: route(r.goal_id),
      evidence: { goal_id: r.goal_id, target_id: t.id, charges: t.charges, actual: t.actual },
    }));
}

/** Submeta estourando enquanto a categoria ainda está sob controle. */
function targetSituations(ctx: MultiFinanceProactiveContext, r: GoalReading): FinancialSituation[] {
  return r.breakdown.targets
    .filter((t) => t.status === "exceeded" || t.status === "at_risk")
    .map((t) => make(ctx, {
      type: "spending_goal_target",
      communication_kind: "spending_goal_pressure",
      title: t.status === "exceeded" ? `${t.label} passou o limite da submeta` : `${t.label} deve passar o limite da submeta`,
      body: `${t.message} Esse gasto também compõe a meta de ${r.category_name}, que está em ${pct(r.breakdown.consumed_share)} com ${pct(r.breakdown.elapsed_share)} do período.`,
      anchor: `${t.id}:${r.period.start}:${t.status}`,
      severity: "attention",
      impact: t.status === "exceeded" ? Math.max(0, t.actual - (t.limit ?? 0)) : t.projected_overage,
      route: route(r.goal_id),
      days_until: r.breakdown.remaining_days,
      evidence: { goal_id: r.goal_id, target_id: t.id, actual: t.actual, limit: t.limit, projected: t.projected },
    }));
}

/** 75% usado com boa parte do período pela frente. */
function thresholdSituation(ctx: MultiFinanceProactiveContext, r: GoalReading): FinancialSituation | null {
  const b = r.breakdown;
  if (!OPEN.has(r.status) || r.current_overage > 0) return null;
  const remainingShare = b.total_days > 0 ? b.remaining_days / b.total_days : 0;
  if (b.consumed_share < 0.75 || remainingShare < 0.3) return null;
  const remaining = Math.max(0, r.limit - r.actual);
  const perDay = b.remaining_days > 0 ? remaining / b.remaining_days : remaining;
  return make(ctx, {
    type: "spending_goal_threshold",
    communication_kind: "spending_goal_threshold",
    title: `Você já usou ${pct(b.consumed_share)} da meta de ${r.category_name}`,
    body: `Você já utilizou ${pct(b.consumed_share)} da meta de ${r.category_name}, mas ainda restam ${pct(remainingShare)} dos dias do período. Para manter o objetivo, o gasto médio disponível até o fechamento é de ${brl(perDay)} por dia (${brl(remaining)} no total).`,
    anchor: `${r.goal_id}:${r.period.start}:75`,
    severity: "attention",
    impact: remaining,
    route: route(r.goal_id),
    days_until: b.remaining_days,
    evidence: { goal_id: r.goal_id, consumed_share: b.consumed_share, remaining_share: remainingShare },
  });
}

/** Quinta ou sexta: quanto cabe no fim de semana, se ele costuma pesar mais. */
function weekendSituations(ctx: MultiFinanceProactiveContext, readings: GoalReading[], sg: SpendingGoalContext): FinancialSituation[] {
  const dow = weekday(ctx.as_of);
  if (dow !== 4 && dow !== 5) return [];
  return readings.flatMap((r) => {
    if (!OPEN.has(r.status) || r.current_overage > 0) return [];
    const w = weekendAllowance({
      entries: sg.entries, categoryId: r.category_id, today: ctx.as_of, period: r.period,
      remainingBudget: Math.max(0, r.limit - r.actual),
    });
    if (!w || w.allowance < 20) return [];
    return [make(ctx, {
      type: "spending_goal_weekend",
      communication_kind: "spending_goal_weekend",
      title: `Quanto cabe de ${r.category_name} neste fim de semana`,
      body: `Seus gastos com ${r.category_name} costumam aumentar aos fins de semana. Considerando a meta e o que já foi usado, o valor disponível para este fim de semana é ${brl(w.allowance)} (restam ${brl(Math.max(0, r.limit - r.actual))} até ${ddmm(r.period.end)}).`,
      anchor: `${r.goal_id}:${w.weekend_days[0]}`,
      severity: "info",
      impact: w.allowance,
      route: route(r.goal_id),
      days_until: Math.max(0, Math.round((Date.parse(`${w.weekend_days[0]}T12:00:00Z`) - Date.parse(`${ctx.as_of}T12:00:00Z`)) / 86_400_000)),
      evidence: { goal_id: r.goal_id, weekend_days: w.weekend_days, weekend_weight: w.weekend_weight },
    })];
  });
}

/** Segunda-feira: fechamento da semana com recomendação objetiva. */
function weeklySituation(ctx: MultiFinanceProactiveContext, readings: GoalReading[], sg: SpendingGoalContext): FinancialSituation | null {
  if (weekday(ctx.as_of) !== 1) return null;
  const open = readings.filter((r) => OPEN.has(r.status) && r.breakdown.elapsed_days >= 3);
  if (!open.length) return null;
  const weekStart = addDays(ctx.as_of, -7);
  const lines = open.slice(0, 4).map((r) => {
    const b = r.breakdown;
    const weekSpend = sg.entries
      .filter((e) => e.category_id === r.category_id && e.date >= weekStart && e.date < ctx.as_of)
      .reduce((acc, e) => acc + e.amount, 0);
    const weeksLeft = Math.max(1, Math.ceil(b.remaining_days / 7));
    const perWeek = Math.max(0, r.limit - r.actual) / weeksLeft;
    const pieces = [
      `${r.category_name}: ${pct(b.consumed_share)} usado com ${pct(b.elapsed_share)} do período`,
      `projeção ${brl(r.projected)} para limite ${brl(r.limit)}`,
      `na semana, ${brl(weekSpend)}`,
    ];
    if (b.main_driver) pieces.push(`quem mais pesou: ${b.main_driver.label}`);
    const sub = b.targets.filter((t) => t.limit != null).slice(0, 2)
      .map((t) => `${t.label} ${brl(t.actual)} de ${brl(t.limit ?? 0)}`);
    if (sub.length) pieces.push(`submetas: ${sub.join(", ")}`);
    if (r.baseline && r.baseline > 0) {
      const saving = r.baseline - r.projected;
      pieces.push(saving >= 0 ? `economia projetada de ${brl(saving)} frente à referência` : `${brl(-saving)} acima da referência`);
    }
    const advice = r.limit - r.actual > 0
      ? `Para a semana: até ${brl(perWeek)} em ${r.category_name}.`
      : `Para a semana: segurar novos gastos em ${r.category_name}.`;
    return `${pieces.join(" · ")}. ${advice}`;
  });
  const risk = open.filter((r) => r.projected_overage > 0).length;
  return make(ctx, {
    type: "spending_goal_weekly",
    communication_kind: "spending_goal_weekly",
    title: risk ? `Resumo da semana: ${risk} meta${risk > 1 ? "s" : ""} acima do ritmo` : "Resumo da semana: metas no ritmo",
    body: lines.join("\n"),
    anchor: ctx.as_of,
    severity: "info",
    impact: open.reduce((acc, r) => acc + Math.max(0, r.projected_overage), 0),
    route: "/app/metas",
    evidence: { goals: open.map((r) => r.goal_id) },
  });
}

/** Dias 1 a 3: fechamento do mês anterior, com a economia apurada. */
function monthlySituation(ctx: MultiFinanceProactiveContext, sg: SpendingGoalContext): FinancialSituation | null {
  const day = Number(ctx.as_of.slice(8, 10));
  if (day > 3) return null;
  const month = shiftMonth(ctx.as_of.slice(0, 7), -1);
  const names = new Map(sg.categories.map((c) => [c.id, c.name]));
  const summaries = sg.goals
    .filter((g) => g.status === "active" && (g.period_type ?? "monthly_recurring") === "monthly_recurring" && g.start_date.slice(0, 7) <= month)
    .map((g) => summarizeClosedCycle({
      goal: { id: g.id, category_id: g.category_id, limit: Number(g.computed_limit || 0), baseline: g.baseline_value ?? null, name: names.get(g.category_id) ?? "Categoria" },
      month,
      targets: sg.targets.filter((t) => t.goal_id === g.id),
      entries: sg.entries,
    }));
  if (!summaries.length) return null;
  const savings = summaries.reduce((acc, s) => acc + Math.max(0, s.savings ?? 0), 0);
  const met = summaries.filter((s) => s.met).length;
  const tail = savings > 0
    ? ` No total, a economia apurada frente à sua referência foi de ${brl(savings)}. Quer direcionar esse valor para uma reserva, um investimento ou para reduzir uma dívida?`
    : "";
  // goal_history.v1 — além do mês, a tendência: reduziu ou aumentou desde o início?
  const trend = (() => {
    try {
      return goalHistoryOf(sg).highlights
        .filter((h) => h.id.startsWith("down:") || h.id.startsWith("up:") || h.id.startsWith("streak:") || h.id.startsWith("misses:"))
        .slice(0, 2)
        .map((h) => `${h.title}: ${h.body}`);
    } catch {
      return [];
    }
  })();
  return make(ctx, {
    type: "spending_goal_monthly",
    communication_kind: "spending_goal_monthly",
    title: `Fechamento de ${monthName(month)}: ${met} de ${summaries.length} meta${summaries.length > 1 ? "s" : ""} cumprida${met === 1 ? "" : "s"}`,
    body: `${summaries.map((s) => s.text).join("\n")}${trend.length ? `\n${trend.join("\n")}` : ""}${tail}`,
    anchor: month,
    severity: "info",
    impact: savings,
    route: "/app/metas",
    evidence: { month, summaries: summaries.map((s) => ({ goal_id: s.goal_id, actual: s.actual, limit: s.limit, met: s.met, savings: s.savings })) },
  });
}

export function spendingGoalSituations(
  ctx: MultiFinanceProactiveContext,
  sg: SpendingGoalContext,
  readings: GoalReading[],
): FinancialSituation[] {
  const out: FinancialSituation[] = [];
  for (const r of readings) {
    out.push(...zeroChargeSituations(ctx, r));
    const pressure = pressureSituation(ctx, r);
    if (pressure) {
      out.push(pressure);
      continue;
    }
    const targets = targetSituations(ctx, r);
    if (targets.length) {
      out.push(...targets);
      continue;
    }
    const threshold = thresholdSituation(ctx, r);
    if (threshold) out.push(threshold);
  }
  out.push(...weekendSituations(ctx, readings, sg));
  const weekly = weeklySituation(ctx, readings, sg);
  if (weekly) out.push(weekly);
  const monthly = monthlySituation(ctx, sg);
  if (monthly) out.push(monthly);
  return out;
}
