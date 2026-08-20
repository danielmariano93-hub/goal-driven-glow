// deno-lint-ignore-file no-explicit-any
// proactive_multifinance.v1 — coleta de sinais canônicos (função pura).
// Cada sinal aponta para o motor que o produziu; nenhum número nasce aqui.
import type {
  FinancialSignal,
  MultiFinanceProactiveContext,
  PerformanceHighlightInput,
} from "./contracts.ts";

/** Confiança textual do motor de performance → 0..1. */
function confidenceOf(label: string): number {
  switch (label) {
    case "high": return 0.9;
    case "medium": return 0.75;
    case "low": return 0.6;
    default: return 0.4;
  }
}

/** Tipo do sinal de performance, derivado do tópico e do sentimento. */
function performanceSignalKind(h: PerformanceHighlightInput): string {
  const positive = h.sentiment === "positive";
  if (/category/.test(h.topic_key)) return positive ? "category_improvement" : "category_deterioration";
  if (/card/.test(h.topic_key)) return "card_cycle_improvement";
  if (/fixed|cost|structure/.test(h.topic_key)) return "fixed_cost_increase";
  if (/behavior/.test(h.topic_key)) return "behavior_improvement";
  if (/timing/.test(String(h.nature ?? "")) || h.nature === "timing") return "timing_effect";
  if (/net|resultado/.test(h.topic_key)) return "net_improvement";
  return positive ? "expense_improvement" : "expense_deterioration";
}

/**
 * Highlights de performance viram SINAIS — nunca mensagem direta. Continuam
 * passando por materialidade, prioridade, cota de atenção e canal.
 */
export function collectPerformanceSignals(ctx: MultiFinanceProactiveContext): FinancialSignal[] {
  const highlights = ctx.performance_highlights ?? [];
  return highlights.map((h) => ({
    key: `performance:${h.topic_key}:${performanceSignalKind(h)}`,
    domain: "performance" as const,
    label: h.title,
    amount: Math.abs(num(h.materiality)),
    direction: h.sentiment === "positive" ? "achievement" : h.sentiment === "negative" ? "risk" : "context",
    date: null,
    days_until: null,
    confidence: confidenceOf(String(h.confidence)),
    actionable: Boolean(h.actionable),
    route: "/app/relatorios",
    evidence: {
      source: "financial_performance",
      highlight_id: h.id,
      logical_topic_key: h.topic_key,
      interpretation: h.body,
      nature: h.nature,
      recommended_action: h.recommended_action,
      methodology: h.methodology,
      performance_signal_kind: performanceSignalKind(h),
      severity: h.severity,
    },
  }));
}

function num(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

function brl(value: number): string {
  return `R$ ${Math.abs(value).toFixed(2).replace(".", ",")}`;
}

export function collectFinancialSignals(ctx: MultiFinanceProactiveContext): FinancialSignal[] {
  const out: FinancialSignal[] = [];
  const cash = ctx.domains.cash as any;
  const cards = ctx.domains.cards as any;

  // ---------------- Caixa e liquidez ----------------
  if (ctx.first_negative_day) {
    const point = ctx.first_negative_day;
    out.push({
      key: `cash_negative:${point.date}`,
      domain: "cash",
      label: `Caixa projetado negativo em ${point.date} (${brl(point.balance)})`,
      amount: Math.abs(point.balance),
      direction: "risk",
      date: point.date,
      days_until: daysBetween(ctx.as_of, point.date),
      confidence: 0.9,
      actionable: true,
      route: "/app/compromissos",
      evidence: {
        source: "cash_horizon",
        projected_balance: point.balance,
        labels: point.labels,
        available_today: ctx.available_today,
        formula_version: ctx.snapshot_ref.formula_version,
      },
    });
  }
  if (num(ctx.projected_month_end_available) < 0) {
    out.push({
      key: "month_end_shortfall",
      domain: "cash",
      label: `Fechamento do mês projetado em ${brl(ctx.projected_month_end_available)} negativo`,
      amount: Math.abs(num(ctx.projected_month_end_available)),
      direction: "risk",
      date: String(cash?.month_end ?? ctx.as_of),
      days_until: daysBetween(ctx.as_of, String(cash?.month_end ?? ctx.as_of)),
      confidence: 0.85,
      actionable: true,
      route: "/app/planejamento",
      evidence: {
        source: "financial_snapshot",
        projected_month_end_available: ctx.projected_month_end_available,
        known_future_commitments: num(cash?.known_future_commitments),
        estimated_fixed_income: num(cash?.estimated_fixed_income),
        formula_version: ctx.snapshot_ref.formula_version,
      },
    });
  }
  const pace = num(ctx.daily_pace);
  const typical = num(ctx.typical_daily_pace);
  if (typical > 0 && pace > typical * 1.25) {
    const extra = (pace - typical) * num(cash?.days_remaining);
    out.push({
      key: "pace_above_typical",
      domain: "patterns",
      label: `Ritmo diário ${brl(pace)} contra ${brl(typical)} típicos`,
      amount: Math.max(0, extra),
      direction: "risk",
      date: null,
      days_until: null,
      confidence: 0.8,
      actionable: true,
      route: "/app/relatorios",
      evidence: {
        source: "spending_rhythm",
        daily_pace: pace,
        typical_daily_pace: typical,
        days_remaining: num(cash?.days_remaining),
        formula_version: ctx.snapshot_ref.formula_version,
      },
    });
  }

  // ---------------- Cartões ----------------
  const cardDue = num(cards?.card_due_this_month);
  if (cardDue > 0) {
    out.push({
      key: "card_due_this_month",
      domain: "cards",
      label: `Fatura de ${brl(cardDue)} vence nesta competência`,
      amount: cardDue,
      direction: "context",
      date: cards?.next_card_due_date ?? null,
      days_until: cards?.next_card_due_date ? daysBetween(ctx.as_of, String(cards.next_card_due_date)) : null,
      confidence: cards?.card_due_estimated ? 0.7 : 0.95,
      actionable: true,
      route: "/app/contas",
      evidence: {
        source: "card_truth.v3",
        card_due_this_month: cardDue,
        cards_owed: num(cards?.cards_owed),
        estimated: Boolean(cards?.card_due_estimated),
        formula_version: ctx.snapshot_ref.formula_version,
      },
    });
  }
  if (cardDue > 0 && cardDue > ctx.available_today) {
    out.push({
      key: "card_above_cash",
      domain: "cards",
      label: `Fatura (${brl(cardDue)}) maior que o disponível hoje (${brl(ctx.available_today)})`,
      amount: cardDue - ctx.available_today,
      direction: "risk",
      date: cards?.next_card_due_date ?? null,
      days_until: cards?.next_card_due_date ? daysBetween(ctx.as_of, String(cards.next_card_due_date)) : null,
      confidence: cards?.card_due_estimated ? 0.75 : 0.9,
      actionable: true,
      route: "/app/contas",
      evidence: {
        source: "card_truth.v3",
        card_due_this_month: cardDue,
        available_today: ctx.available_today,
        estimated: Boolean(cards?.card_due_estimated),
        formula_version: ctx.snapshot_ref.formula_version,
      },
    });
  }

  // ---------------- Metas por categoria ----------------
  for (const goal of (ctx.domains.goals as any[])) {
    const overage = num(goal.current_overage);
    const projected = num(goal.projected_overage);
    const impact = overage > 0 ? overage : projected;
    if (impact <= 0) continue;
    out.push({
      key: `category_goal:${goal.goal_id}`,
      domain: "goals",
      label: overage > 0
        ? `${goal.category_name ?? "Categoria"} passou o teto em ${brl(overage)}`
        : `${goal.category_name ?? "Categoria"} deve passar o teto em ${brl(projected)}`,
      amount: impact,
      direction: "risk",
      date: String(goal.period_end ?? ctx.as_of),
      days_until: num(goal.days_remaining),
      confidence: num(goal.days_elapsed) >= 14 ? 0.9 : num(goal.days_elapsed) >= 7 ? 0.8 : 0.7,
      actionable: true,
      route: `/app/metas/categoria/${goal.goal_id}`,
      evidence: {
        source: "category_goal_strategy.v1",
        goal_id: goal.goal_id,
        category_id: goal.category_id,
        category_name: goal.category_name,
        limit: num(goal.target_amount),
        spent: num(goal.actual_spend),
        projected: num(goal.projected_final_spend),
        overage,
        projected_overage: projected,
        status: goal.status,
        projection_method: goal.projection_method,
        period_start: goal.period_start,
        period_end: goal.period_end,
        formula_version: ctx.snapshot_ref.formula_version,
      },
    });
  }

  // ---------------- Compromissos ----------------
  const commitments = (ctx.domains.commitments as any[])
    .filter((item) => item.type === "expense")
    .map((item) => ({ ...item, days: daysBetween(ctx.as_of, String(item.date)) }))
    .filter((item) => item.days >= 0 && item.days <= 10);
  if (commitments.length >= 2) {
    const total = commitments.reduce((sum, item) => sum + num(item.amount), 0);
    if (total > 0) {
      out.push({
        key: "commitment_cluster",
        domain: "commitments",
        label: `${commitments.length} compromissos de ${brl(total)} nos próximos 10 dias`,
        amount: total,
        direction: "context",
        date: String(commitments[0].date),
        days_until: commitments[0].days,
        confidence: commitments.some((item) => item.estimated) ? 0.75 : 0.9,
        actionable: true,
        route: "/app/compromissos",
        evidence: {
          source: "commitment_agenda.v2",
          count: commitments.length,
          total,
          items: commitments.slice(0, 8).map((item) => ({
            name: item.name, date: item.date, amount: num(item.amount), source: item.source, estimated: item.estimated,
          })),
          formula_version: ctx.snapshot_ref.formula_version,
        },
      });
    }
  }

  // ---------------- Dívidas ----------------
  for (const debt of (ctx.domains.debts as any[])) {
    const installment = num(debt.installment_amount);
    const dueDay = debt.due_day == null ? null : Number(debt.due_day);
    if (installment <= 0 || dueDay == null) continue;
    const day = Number(ctx.as_of.slice(8, 10));
    const daysUntil = dueDay >= day ? dueDay - day : dueDay - day + 30;
    if (daysUntil > 7) continue;
    out.push({
      key: `debt_due:${debt.id}`,
      domain: "debts",
      label: `Parcela de ${debt.name} (${brl(installment)}) vence em ${daysUntil} dia(s)`,
      amount: installment,
      direction: "risk",
      date: null,
      days_until: daysUntil,
      confidence: 0.9,
      actionable: true,
      route: "/app/mais/dividas",
      evidence: {
        source: "debt_status.v2",
        debt_id: debt.id,
        debt_name: debt.name,
        installment_amount: installment,
        outstanding_balance: num(debt.outstanding_balance),
        due_day: dueDay,
        formula_version: ctx.snapshot_ref.formula_version,
      },
    });
  }

  // ---------------- Padrões e emoções (diagnóstico canônico) ----------------
  for (const item of (ctx.domains.patterns as any[])) {
    const impact = Math.abs(num(item.impact_amount));
    out.push({
      key: `diagnosis:${item.id}`,
      domain: String(item.kind) === "pattern" ? "patterns" : "emotions",
      label: String(item.title ?? "Padrão observado"),
      amount: impact,
      direction: String(item.kind) === "achievement" ? "achievement" : "risk",
      date: null,
      days_until: null,
      confidence: num(item.confidence) || 0.7,
      actionable: Boolean(item.primary_action),
      route: (item.primary_action as any)?.route ?? null,
      evidence: {
        source: "nino_intelligence_items",
        item_id: item.id,
        kind: item.kind,
        severity: item.severity,
        summary: item.summary,
        impact_amount: impact,
        logical_topic_key: item.logical_topic_key,
      },
    });
  }

  // ---------------- Performance (financial_performance.v1) ----------------
  out.push(...collectPerformanceSignals(ctx));

  return out;
}
