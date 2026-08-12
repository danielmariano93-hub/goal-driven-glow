// Edge Function: pulse-compute
// - Autentica via JWT.
// - Calcula o Pulso Financeiro do usuário no servidor a partir das tabelas reais.
// - Faz upsert idempotente de UM snapshot por dia (America/Sao_Paulo).
// - Retorna score, band, factors, next_action, week_delta e state.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { fail } from "../_shared/http.ts";

const FN = "pulse-compute";
import { computePulse, type PulseInput } from "../_shared/pulse/rules.ts";
import { computeDebtStatus, type DebtScheduleRow } from "../_shared/finance-core/debtStatus.ts";
// Verdade financeira única (finance_contract.v2): nunca reimplementar fórmulas aqui.
import {
  computeActiveDebtsTotal,
  computeBehavioralExpense,
  computeCardExposure,
  computeGoalProgressFacts,
  computeTotalCash,
  currentMonthYM,
  todaySP,
  totalCardDebtOf,
  type AccountRow,
  type CardInstallmentRow,
  type CardStatementRow,
  type TransactionRow,
} from "../_shared/finance-core/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return fail("method_not_allowed", { status: 405, functionName: FN });
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return fail("unauthorized", { status: 401, functionName: FN });
  const sbAuth = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await sbAuth.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) return fail("unauthorized", { status: 401, functionName: FN });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const cutoff14 = new Date(today); cutoff14.setDate(cutoff14.getDate() - 14);
    const cutoff30 = new Date(today); cutoff30.setDate(cutoff30.getDate() - 30);
    const cutoff90 = new Date(today); cutoff90.setDate(cutoff90.getDate() - 90);

    // Buscar dados em paralelo.
    const [txsR, accountsR, cardsR, goalsR, debtsR, contribR, emoR, recR, profileR, invR, snapR, stmtR, instR, debtPayR, pendingR, catGoalsR] = await Promise.all([
      sb.from("transactions").select("id,account_id,type,status,amount,occurred_at,category_id,credit_card_id,payment_method,settles_card_id,competence_date,transfer_group_id,movement_kind,description").eq("user_id", userId).gte("occurred_at", iso(cutoff90)),
      sb.from("accounts").select("id,opening_balance,active,type").eq("user_id", userId),
      sb.from("credit_cards").select("id,total_limit,active,closing_day,due_day").eq("user_id", userId).eq("active", true),
      sb.from("goals").select("id,target_amount,status").eq("user_id", userId).eq("status", "active"),
      sb.from("debts").select("id,name,creditor,outstanding_balance,status,installment_amount,due_day,first_due_date,start_date,installments_total,installments_paid,accounting_method").eq("user_id", userId).eq("status", "active"),
      sb.from("goal_contributions").select("goal_id,amount").eq("user_id", userId),
      sb.from("emotional_checkins").select("occurred_at,transaction_id").eq("user_id", userId).gte("occurred_at", iso(cutoff30)),
      sb.from("recurring_rules").select("id,status,amount").eq("user_id", userId).eq("status", "active"),
      sb.from("profiles").select("timezone").eq("id", userId).maybeSingle(),
      sb.from("investments").select("goal_id,current_value").eq("user_id", userId),
      sb.from("account_balance_snapshots").select("account_id,balance,balance_date,status,anchor_kind,source_document_id,reconciliation_delta").eq("user_id", userId),
      sb.from("credit_card_statements").select("id,credit_card_id,competence_month,status,total_amount,outstanding_amount,paid_amount,due_date").eq("user_id", userId),
      sb.from("credit_card_installments").select("id,credit_card_id,competence_month,amount,absorbed_by_statement_id").eq("user_id", userId),
      sb.from("debt_payments").select("debt_id,paid_at,amount,amount_applied,installments_covered").eq("user_id", userId).gte("paid_at", iso(cutoff90)),
      sb.from("pending_confirmations").select("id,status,created_at").eq("user_id", userId).eq("status", "pending"),
      sb.from("category_spending_goals").select("id,computed_limit,fixed_limit,active").eq("user_id", userId).eq("active", true),
    ]);

    const failedRead = [txsR,accountsR,cardsR,goalsR,debtsR,contribR,emoR,recR,profileR,invR,snapR,stmtR,instR,debtPayR,pendingR,catGoalsR]
      .map((r, index) => ({ index, error: r.error }))
      .find((r) => r.error);
    if (failedRead?.error) throw new Error(`pulse_read_${failedRead.index}: ${failedRead.error.message}`);

    const txs = (txsR.data ?? []) as unknown as TransactionRow[];
    const accounts = (accountsR.data ?? []) as unknown as AccountRow[];
    const cards = (cardsR.data ?? []) as Array<{ id: string; total_limit: number | string; closing_day?: number | null; due_day?: number | null }>;
    const goals = (goalsR.data ?? []) as Array<{ id: string; target_amount: number | string }>;
    const debts = (debtsR.data ?? []) as Array<{ outstanding_balance: number | string; status?: string }>;
    const debtSchedule = (debtsR.data ?? []) as unknown as DebtScheduleRow[];
    const debtPayments = ((debtPayR.data ?? []) as Array<Record<string, unknown>>).map((p) => ({
      debt_id: String(p.debt_id),
      paid_at: String(p.paid_at ?? "").slice(0, 10),
      amount: Number(p.amount ?? 0),
      installments_covered: p.installments_covered == null ? null : Number(p.installments_covered),
      amount_applied: p.amount_applied == null ? null : Number(p.amount_applied),
    }));
    const pendingRows = (pendingR.data ?? []) as Array<{ id: string; created_at: string }>;
    const categoryGoals = (catGoalsR.data ?? []) as Array<{ computed_limit: number | string; fixed_limit: number | string | null }>;
    const contribs = (contribR.data ?? []) as Array<{ goal_id: string; amount: number | string }>;
    const emos = (emoR.data ?? []) as Array<{ occurred_at: string; transaction_id: string | null }>;
    const recurring = (recR.data ?? []) as Array<{ id: string; status: string; amount: number | string }>;
    const investments = (invR.data ?? []) as Array<{ goal_id: string | null; current_value: number | string }>;
    const balanceSnapshots = (snapR.data ?? []) as unknown as Parameters<typeof computeTotalCash>[2];
    const statements = (stmtR.data ?? []) as unknown as CardStatementRow[];
    const installments = (instR.data ?? []) as unknown as CardInstallmentRow[];
    const timezone = String(profileR.data?.timezone || "America/Sao_Paulo");

    const confirmed = txs.filter((t) => t.status === "confirmed" && t.type !== "transfer");
    const last14 = confirmed.filter((t) => t.occurred_at >= iso(cutoff14));
    const last30 = confirmed.filter((t) => t.occurred_at >= iso(cutoff30));
    const distinctDays14 = new Set(last14.map((t) => t.occurred_at)).size;

    // Caixa: fonte única do core (respeita snapshots conciliados e exclusões).
    const totalCash = computeTotalCash(accounts, txs, balanceSnapshots ?? []);

    // Dívida de cartão: exposição oficial (card_exposure.v2) — nunca soma de transações.
    const todayIsoSP = todaySP(today);
    const exposures = computeCardExposure({
      cardIds: cards.map((c) => c.id),
      statements,
      installments,
      txs,
      currentYM: currentMonthYM(today),
      cards: cards.map((c) => ({ id: c.id, closing_day: c.closing_day ?? null, due_day: c.due_day ?? null })),
      todayISO: todayIsoSP,
    });
    const cardOutstanding = Math.max(0, totalCardDebtOf(exposures));
    const cardTotalLimit = cards.reduce((a, c) => a + Number(c.total_limit || 0), 0);

    // Consumo comportamental dos últimos 30 dias (mesma regra da Home/Relatórios).
    const monthlyExpense30 = computeBehavioralExpense(last30, { start: iso(cutoff30), end: iso(today) });

    // Metas — helper canônico (contribuições + investimentos vinculados).
    const goalsPct = goals.map(
      (g) => computeGoalProgressFacts(g.target_amount, g.id, contribs, investments).pct,
    );

    const outstandingToday = computeActiveDebtsTotal(debts);
    const cutoff3 = new Date(today); cutoff3.setDate(cutoff3.getDate() - 3);
    const debtStatus = computeDebtStatus({
      debts: debtSchedule,
      payments: debtPayments,
      today: todayIsoSP,
    });
    const principalPaid30d = debtPayments
      .filter((p) => p.paid_at >= iso(cutoff30))
      .reduce((acc, p) => acc + Math.abs(Number(p.amount_applied ?? p.amount ?? 0)), 0);
    const plannedMonth = Number(
      categoryGoals.reduce((acc, g) => acc + Math.abs(Number(g.fixed_limit ?? g.computed_limit ?? 0)), 0).toFixed(2),
    );

    const emoDays14 = new Set(emos.filter((e) => e.occurred_at.slice(0, 10) >= iso(cutoff14)).map((e) => e.occurred_at.slice(0, 10))).size;
    const emoTxIds = new Set(emos.filter((e) => e.transaction_id).map((e) => e.transaction_id as string));
    const expensesWithEmotion30 = last30.filter((t) => t.type === "expense" && emoTxIds.has(t.id)).length;

    // Buscar snapshot ~7 dias atrás para week_delta.
    const cutoff7start = new Date(today); cutoff7start.setDate(cutoff7start.getDate() - 8);
    const cutoff7end = new Date(today); cutoff7end.setDate(cutoff7end.getDate() - 6);
    const { data: prevSnap } = await sb
      .from("pulse_snapshots")
      .select("score")
      .eq("user_id", userId)
      .gte("computed_at", cutoff7start.toISOString())
      .lte("computed_at", cutoff7end.toISOString())
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const score7dAgo = prevSnap ? Number(prevSnap.score) : null;

    const input: PulseInput = {
      today: iso(today),
      txDaysLast14: distinctDays14,
      txLast30: last30.length,
      txLast30WithCategory: last30.filter((t) => !!t.category_id).length,
      // Pendências reais do assessor: abertas e paradas há mais de 3 dias.
      pendingOpen: pendingRows.length,
      pendingStale: pendingRows.filter((p) => String(p.created_at ?? "").slice(0, 10) < iso(cutoff3)).length,
      // Planejamento real: soma dos limites mensais das metas por categoria ativas.
      plannedMonth: plannedMonth,
      actualMonth: monthlyExpense30,
      hasPlan: plannedMonth > 0,
      cardOutstanding,
      cardTotalLimit,
      // Contas em dia: pagamentos de dívidas dos últimos 90 dias vs. atrasos
      // apurados pelo motor canônico de dívidas (debt_status.v1).
      paymentsOnTime90d: debtPayments.length > 0
        ? Math.max(0, debtPayments.length - debtStatus.facts.overdue_count)
        : 0,
      paymentsTotal90d: debtPayments.length,
      totalCash,
      avgMonthlyExpense: monthlyExpense30,
      goalsProgressPct: goalsPct,
      outstandingToday,
      // Dívida de 30 dias atrás reconstruída pelo principal amortizado no período
      // (nunca igualar ao saldo de hoje, o que zerava o fator injustamente).
      outstanding30dAgo: Number((outstandingToday + principalPaid30d).toFixed(2)),
      recurringActive: recurring.length,
      recurringWithDefinedAmount: recurring.filter((r) => Number(r.amount || 0) > 0).length,
      emotionalDaysLast14: emoDays14,
      expensesLast30WithEmotion: expensesWithEmotion30,
      score7dAgo,
    };

    const pulse = computePulse(input);
    const weekDelta = score7dAgo == null ? 0 : pulse.score - score7dAgo;

    // Upsert idempotente diário (um snapshot por dia, atualiza se já existe).
    const nowIso = new Date().toISOString();
    let todayLocal: string;
    try {
      todayLocal = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(today);
    } catch {
      todayLocal = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(today);
    }
    const { data: existing } = await sb
      .from("pulse_snapshots")
      .select("id")
      .eq("user_id", userId)
      .eq("snapshot_date", todayLocal)
      .limit(1)
      .maybeSingle();

    const factorsJson = { factors: pulse.factors, state: pulse.state, input: { totalCash, cardOutstanding, cardTotalLimit, txDaysLast14: distinctDays14, txLast30: last30.length } };
    const payload = {
      user_id: userId,
      score: pulse.score,
      band: pulse.band,
      factors: factorsJson,
      next_action: pulse.next_action.label,
      week_delta: weekDelta,
      state: pulse.state,
      computed_at: nowIso,
      snapshot_date: todayLocal,
    };
    const snapshotWrite = existing?.id
      ? await sb.from("pulse_snapshots").update(payload).eq("id", existing.id)
      : await sb.from("pulse_snapshots").insert(payload);
    if (snapshotWrite.error) throw new Error(`pulse_snapshot_write: ${snapshotWrite.error.message}`);

    return json({
      score: pulse.score,
      band: pulse.band,
      factors: pulse.factors,
      next_action: pulse.next_action,
      week_delta: weekDelta,
      state: pulse.state,
    });
  } catch (e) {
    console.error("[pulse-compute] error", (e as Error).message);
    return fail("internal", { status: 500, functionName: FN });
  }
});
