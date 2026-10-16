// Runtime servidor do Mapa Financeiro (`mapa_financeiro.v1`).
// Carrega o ledger canônico (competência, estornos, sem transferência/fatura/investimento) e os insumos de saúde
// financeira, e entrega a leitura pronta. Nenhuma fórmula vive aqui: tudo está em `finance-core` (mapa*.ts).
// Falha de uma fonte degrada a leitura (indicador sem dados), nunca derruba a resposta.
// deno-lint-ignore-file no-explicit-any
import { fetchAllPages } from "../derived/pagedSelect.ts";
import { loadExecutiveInput } from "../insights/executive/load.ts";
import { computeDebtStatus } from "../finance-core/debtStatus.ts";
import { buildMapaReading } from "../finance-core/mapaReading.ts";
import { EMPTY_HABIT_INPUTS, snapshotInputFromPayload, type MapaDebtIn, type MapaHealthInputs } from "../finance-core/mapaInputs.ts";
import type { MapaReading, MapaRecommendationFeedback, MapaStoredReading } from "../finance-core/mapaContracts.ts";
import { storedRows } from "../finance-core/mapaEvolution.ts";
import { detectRecurringSuggestions, type DetectionTx } from "../finance-core/recurringDetection.ts";
import type { MapaCommitmentPeriod, MapaHabitInputs, MapaMonthlyEstimate, MapaQuestionRow } from "../finance-core/mapaInputs.ts";
import { goalHistoryOf, loadSpendingGoalContext } from "../spendingGoals/runtime.ts";

/** Acesso controlado por flag (`mapa_access`): por ora só quem foi liberado. */
export async function mapaAccess(sb: any, userId: string): Promise<boolean> {
  const { data, error } = await sb.from("mapa_access").select("enabled").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`mapa_access:${error.message}`);
  return data?.enabled === true;
}

const num = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const shiftDays = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function safe<T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try { return await run(); } catch (error) { console.warn(`mapa:${label}`, String(error).slice(0, 160)); return fallback; }
}

export async function loadHealthInputs(sb: any, userId: string, today: string): Promise<MapaHealthInputs> {
  const since = shiftDays(today, -90);
  const [snapshot, flags, debtRows, payments, investments, goals, contributions, movements, debtTx] = await Promise.all([
    safe("snapshot", null, async () => {
      const { data } = await sb.from("financial_current_snapshots").select("payload").eq("user_id", userId).order("computed_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      return snapshotInputFromPayload(data?.payload);
    }),
    safe("flags", {} as Record<string, boolean>, async () => {
      const { data } = await sb.from("category_essential_flags").select("category_id,essential").eq("user_id", userId);
      return Object.fromEntries(((data ?? []) as any[]).map((r) => [String(r.category_id), r.essential === true]));
    }),
    safe("debts", [] as any[], async () => (await sb.from("debts").select("*").eq("user_id", userId)).data ?? []),
    safe("debt_payments", [] as any[], async () => (await sb.from("debt_payments").select("debt_id,paid_at,amount,amount_applied,installments_covered").eq("user_id", userId)).data ?? []),
    safe("investments", [] as any[], async () => (await sb.from("investments").select("id,name,current_value,liquidity,reserve_role").eq("user_id", userId)).data ?? []),
    safe("goals", [] as any[], async () => (await sb.from("goals").select("id,name,target_amount,target_date,created_at,kind,status").eq("user_id", userId)).data ?? []),
    safe("goal_contributions", [] as any[], async () => (await sb.from("goal_contributions").select("goal_id,amount").eq("user_id", userId)).data ?? []),
    safe("investment_movements", [] as any[], async () =>
      (await sb.from("investment_movements").select("kind,amount,occurred_at").eq("user_id", userId).in("kind", ["redemption", "withdrawal"]).gte("occurred_at", since)).data ?? []),
    safe("debt_payments_ledger", [] as any[], async () => fetchAllPages<any>((a, b) =>
      sb.from("transactions").select("id,amount,occurred_at")
        .eq("user_id", userId).eq("status", "confirmed").eq("type", "expense")
        .in("movement_kind", ["debt_payment", "loan_payment"]).gte("occurred_at", `${since}T00:00:00`)
        .order("occurred_at", { ascending: true }).order("id", { ascending: true }).range(a, b),
      { source: "mapa_debt_payments" })),
  ]);

  const activeDebts = (debtRows as any[]).filter((d) => String(d.status ?? "active") === "active");
  const status = activeDebts.length
    ? computeDebtStatus({
      debts: activeDebts as any,
      payments: (payments as any[]).map((p) => ({ ...p, amount: num(p.amount), amount_applied: p.amount_applied == null ? null : num(p.amount_applied) })),
      today,
    })
    : null;
  const maxDays = status ? Math.max(0, ...status.breakdown.map((i: any) => (typeof i.days_overdue === "number" ? i.days_overdue : 0))) : null;

  const debts: MapaDebtIn[] = (debtRows as any[]).map((d) => ({
    id: String(d.id), name: String(d.name ?? ""), status: String(d.status ?? "active"),
    kind: d.kind ?? null, outstanding_balance: num(d.outstanding_balance),
    installment_amount: d.installment_amount == null ? null : num(d.installment_amount),
    interest_rate_pct: d.interest_rate_pct == null ? null : num(d.interest_rate_pct),
    interest_rate_period: d.interest_rate_period ?? null,
  }));
  const saved = new Map<string, number>();
  for (const c of contributions as any[]) saved.set(String(c.goal_id), (saved.get(String(c.goal_id)) ?? 0) + num(c.amount));

  return {
    snapshot,
    categoryEssential: flags,
    debts,
    debtOverdue: status ? { count: status.facts.overdue_count, amount: status.facts.overdue_amount, max_days: maxDays || null } : { count: 0, amount: 0, max_days: null },
    investments: (investments as any[]).map((v) => ({ id: String(v.id), name: String(v.name ?? ""), current_value: num(v.current_value), liquidity: v.liquidity ?? null, reserve_role: v.reserve_role ?? null })),
    savingsGoals: (goals as any[])
      .filter((g) => g.kind !== "donation" && String(g.status ?? "active") === "active")
      .map((g) => ({ id: String(g.id), name: String(g.name ?? ""), target_amount: num(g.target_amount), saved_amount: saved.get(String(g.id)) ?? 0, created_at: String(g.created_at ?? today).slice(0, 10), target_date: g.target_date ? String(g.target_date).slice(0, 10) : null })),
    redemptions90: (movements as any[]).map((m) => ({ date: String(m.occurred_at).slice(0, 10), amount: num(m.amount) })),
    debtPayments90: (debtTx as any[]).map((t) => ({ date: String(t.occurred_at).slice(0, 10), amount: num(t.amount) })),
  };
}

const MONTHLY_FACTOR: Record<string, number> = { monthly: 1, weekly: 52 / 12, daily: 30, yearly: 1 / 12 };

/** Insumos da camada Hábitos: compromissos cumpridos, recorrências, respostas e perguntas já feitas. */
export async function loadHabitInputs(sb: any, userId: string, today: string, essentialFlags: Record<string, boolean>): Promise<MapaHabitInputs> {
  const since90 = shiftDays(today, -90);
  const since270 = shiftDays(today, -270);
  const [goalPeriods, weekendPeriods, recurring, answers, events, questions, cfpb] = await Promise.all([
    safe("goal_history", [] as MapaCommitmentPeriod[], async () => {
      const ctx = await loadSpendingGoalContext(sb, userId, today);
      const out: MapaCommitmentPeriod[] = [];
      for (const series of goalHistoryOf(ctx).series) {
        for (const m of series.months) {
          if (m.status === "met" || m.status === "missed") out.push({ key: series.category_id, period: m.month, status: m.status === "met" ? "cumprido" : "estourado" });
        }
      }
      return out;
    }),
    safe("weekend", [] as MapaCommitmentPeriod[], async () => {
      const { data } = await sb.from("weekend_commitments").select("friday,category,status").eq("user_id", userId).in("status", ["kept", "missed"]).gte("friday", shiftDays(today, -90));
      return ((data ?? []) as any[]).map((r) => ({ key: String(r.category), period: String(r.friday), status: r.status === "kept" ? "cumprido" as const : "estourado" as const }));
    }),
    safe("recurring", { detected: 0, registered: 0, nonEssentialMonthly: null as number | null }, async () => {
      const [txs, rules, dismissed] = await Promise.all([
        fetchAllPages<DetectionTx>((a, b) => sb.from("transactions")
          .select("id,description,merchant_name,normalized_description,amount,occurred_at,type,account_id,category_id,status,movement_kind,transfer_group_id,settles_card_id,superseded_by,credit_card_id,payment_method")
          .eq("user_id", userId).eq("status", "confirmed").gte("occurred_at", `${since270}T00:00:00`)
          .order("occurred_at", { ascending: false }).order("id", { ascending: true }).range(a, b), { source: "mapa_recurring" }),
        sb.from("recurring_rules").select("name,amount,kind,frequency,status,category_id").eq("user_id", userId).eq("status", "active"),
        sb.from("recurring_suggestion_dismissals").select("key").eq("user_id", userId),
      ]);
      const ruleRows = ((rules.data ?? []) as any[]);
      const dismissedKeys = ((dismissed.data ?? []) as any[]).map((d) => String(d.key));
      const all = detectRecurringSuggestions({ txs, today, existingRules: [], dismissedKeys });
      const open = detectRecurringSuggestions({ txs, today, existingRules: ruleRows.map((r) => ({ name: String(r.name) })), dismissedKeys });
      const nonEssential = ruleRows
        .filter((r) => r.kind === "expense" && !(r.category_id && essentialFlags[String(r.category_id)] === true))
        .reduce((a, r) => a + num(r.amount) * (MONTHLY_FACTOR[String(r.frequency)] ?? 1), 0);
      return { detected: all.length, registered: Math.max(0, all.length - open.length), nonEssentialMonthly: Math.round(nonEssential * 100) / 100 };
    }),
    safe("context_answers", { planned: 0, total: 0 }, async () => {
      const { data } = await sb.from("habit_context_answers").select("answer_keys,updated_at").eq("user_id", userId).eq("question", "planned_vs_spontaneous").gte("updated_at", `${since90}T00:00:00`);
      const rows = (data ?? []) as any[];
      return { planned: rows.filter((r) => Array.isArray(r.answer_keys) && r.answer_keys.includes("planned")).length, total: rows.length };
    }),
    safe("insight_events", { useful: 0, notUseful: 0 }, async () => {
      const { data } = await sb.from("habit_insight_events").select("event").eq("user_id", userId).in("event", ["useful", "not_useful"]).gte("created_at", `${since90}T00:00:00`);
      const rows = (data ?? []) as any[];
      return { useful: rows.filter((r) => r.event === "useful").length, notUseful: rows.filter((r) => r.event === "not_useful").length };
    }),
    safe("map_questions", [] as any[], async () =>
      (await sb.from("map_questions").select("kind,due_at,answered_at,skipped_at,created_at,payload").eq("user_id", userId).gte("created_at", `${shiftDays(today, -400)}T00:00:00`).order("created_at", { ascending: false }).limit(200)).data ?? []),
    safe("cfpb", null as string | null, async () => {
      const { data } = await sb.from("financial_wellbeing_responses").select("answered_at").eq("user_id", userId).order("answered_at", { ascending: false }).limit(1).maybeSingle();
      return data?.answered_at ? String(data.answered_at) : null;
    }),
  ]);

  const estimates: MapaMonthlyEstimate[] = (questions as any[])
    .filter((q) => q.kind === "estimativa_mensal" && q.answered_at && /^\d{4}-\d{2}$/.test(String(q.payload?.month)) && Number.isFinite(Number(q.payload?.estimate)) && Number(q.payload.estimate) >= 0)
    .map((q) => ({ month: String(q.payload.month), estimate: Number(q.payload.estimate), top_category_id: q.payload.top_category_id ? String(q.payload.top_category_id) : null, answered_at: String(q.answered_at) }));
  const questionRows: MapaQuestionRow[] = (questions as any[]).map((q) => ({
    kind: String(q.kind), due_at: String(q.due_at), answered_at: q.answered_at ?? null, skipped_at: q.skipped_at ?? null, created_at: String(q.created_at),
  }));

  return {
    ...EMPTY_HABIT_INPUTS,
    goalPeriods, weekendPeriods,
    recurringDetected: recurring.detected, recurringRegistered: recurring.registered, recurringNonEssentialMonthly: recurring.nonEssentialMonthly,
    plannedAnswers: answers.planned, totalAnswers: answers.total, usefulEvents: events.useful, notUsefulEvents: events.notUseful,
    estimates, questions: questionRows, lastCfpbAt: cfpb,
  };
}

const HISTORY_DAYS = 120;
const FEEDBACK_DAYS = 90;

/** Segunda-feira da semana de `ymd`: uma leitura gravada por semana (reabrir o Mapa no mesmo dia só atualiza). */
export function weekStartOf(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // segunda = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Leituras anteriores (E10) e respostas a recomendações (E11). */
export async function loadEvolutionInputs(sb: any, userId: string, today: string): Promise<{ history: MapaStoredReading[]; feedback: MapaRecommendationFeedback[] }> {
  const [history, feedback] = await Promise.all([
    safe("map_readings", [] as MapaStoredReading[], async () => {
      const { data } = await sb.from("map_readings").select("indicator_id,as_of,value,formula_version,data").eq("user_id", userId).eq("period_kind", "semanal").gte("as_of", shiftDays(today, -HISTORY_DAYS)).order("as_of", { ascending: false }).limit(2500);
      return ((data ?? []) as any[]).map((r) => ({
        indicator_id: String(r.indicator_id), as_of: String(r.as_of), value: r.value == null ? null : num(r.value), formula_version: String(r.formula_version),
        window_end: r.data?.window_end ?? null, window_kind: r.data?.window_kind ?? null, window_n: typeof r.data?.window_n === "number" ? r.data.window_n : null, dq_signature: r.data?.dq_signature ?? null,
      }));
    }),
    safe("map_recommendation_events", [] as MapaRecommendationFeedback[], async () => {
      const { data } = await sb.from("map_recommendation_events").select("rec_id,event,created_at").eq("user_id", userId).gte("created_at", `${shiftDays(today, -FEEDBACK_DAYS)}T00:00:00`).limit(500);
      return ((data ?? []) as any[]).map((r) => ({ rec_id: String(r.rec_id), event: r.event, at: String(r.created_at) }));
    }),
  ]);
  return { history, feedback };
}

/** Grava a leitura da semana (sobrescreve a anterior da mesma semana). Nunca derruba a resposta. */
export async function persistReading(sb: any, userId: string, reading: MapaReading): Promise<void> {
  try {
    const week = weekStartOf(reading.as_of);
    const rows = storedRows(reading).map((r) => ({
      user_id: userId, as_of: week, period_kind: "semanal", indicator_id: r.indicator_id, value: r.value, unit: r.unit, status: r.status,
      confidence: r.confidence, formula_version: r.formula_version, contract_version: reading.contract,
      data: { inputs: r.inputs, window_end: r.window_end, window_kind: r.window_kind, window_n: r.window_n, dq_signature: r.dq_signature, read_on: reading.as_of },
    }));
    const { error } = await sb.from("map_readings").upsert(rows, { onConflict: "user_id,as_of,period_kind,indicator_id" });
    if (error) throw new Error(error.message);
  } catch (error) { console.warn("mapa:persist", String(error).slice(0, 160)); }
}

export async function loadMapaReading(sb: any, userId: string, today: string, opts: { persist?: boolean } = {}): Promise<MapaReading> {
  // 24 meses de histórico; leitura paginada dentro do loader.
  const [input, health, evolution] = await Promise.all([loadExecutiveInput(sb, userId, today, 24), loadHealthInputs(sb, userId, today), loadEvolutionInputs(sb, userId, today)]);
  const habits = await loadHabitInputs(sb, userId, today, health.categoryEssential);
  const entries = input.entries.map((e) => ({ date: e.date, kind: e.kind, amount: e.amount, category_id: e.category_id }));
  const reading = buildMapaReading({ asOf: today, entries, health, habits, history: evolution.history, feedback: evolution.feedback, nowIso: new Date().toISOString() });
  if (opts.persist) await persistReading(sb, userId, reading);
  return reading;
}
