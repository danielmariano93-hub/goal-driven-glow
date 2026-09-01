// Edge function: insights-generate
// Gera as dicas do Nino usando UM único motor: o catálogo determinístico
// (insights_catalog.v1) + política única de seleção (tipPolicy).
// - O motor antigo de candidatos genéricos foi removido (nada de dica sem evidência).
// - Modo usuário: JWT obrigatório, devolve um lote de até 5 dicas ativas.
// - Modo cron: cabeçalho x-cron-secret, varre usuários ativos e grava heartbeat
//   real (sucesso e falha) em job_heartbeats.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { fail, respond } from "../_shared/http.ts";

const FN = "insights-generate";
import {
  InsightSchema,
  parseInsightResponse,
  type InsightFacts,
} from "../_shared/insights/fallbacks.ts";
import { computeBehavioralSignals } from "../_shared/insights/facts.ts";
import { computeAccountStatementTotals, computeMonthlyTotals, type TransactionRow } from "../_shared/engine/facts.ts";
import {
  computeActiveDebtsTotal,
  computeCardExposure,
  computeCommitmentAgenda,
  currentMonthYM,
  todaySP,
  totalCardDebtOf,
  totalFutureInstallmentsOf,
  type CardInstallmentRow,
  type CardStatementRow,
} from "../_shared/finance-core/index.ts";
import { computeAgentSnapshot } from "../_shared/engine/metrics.ts";
import { deterministicCandidates } from "../_shared/insights/detectors.ts";
import { unsupportedNumbers } from "../_shared/insights/contracts.ts";
import { writeJobHeartbeat } from "../_shared/heartbeats.ts";
import { insightLogicalKey } from "../_shared/intelligence/logicalDedup.ts";
import { getAiBlock, pauseAiCircuit } from "../_shared/aiCircuit.ts";
import { recordGatewayCall } from "../_shared/aiUsageLedger.ts";



import { canGenerateNow, dedupKeyForTip, selectTip, type LedgerRow, type TipCandidate } from "../_shared/intelligence/tipPolicy.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const CRON_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

const PROMPT_VERSION = "v7-catalog-only";
const ACCOUNTING_SCOPE = "behavioral_v1";
// Insights exigem raciocínio e síntese; extração continua no modelo rápido.
// O modelo é configurável para permitir troca controlada e rollback sem deploy.
const MODEL = Deno.env.get("AI_MODEL_REASONING") ?? "openai/gpt-5.6-sol";
/** Quantas dicas o lote entrega por vez (carrossel do app). */
const BATCH_SIZE = 5;

function logEvent(event: Record<string, unknown>) {
  try { console.log(JSON.stringify({ fn: FN, ...event })); } catch { /* noop */ }
}

type InsightRow = Record<string, unknown>;
type RunResult = {
  insights: InsightRow[];
  cached: boolean;
  throttled?: boolean;
  no_candidate?: boolean;
  fallback?: boolean;
  created: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  const isCron = CRON_SECRET !== "" && cronHeader === CRON_SECRET;
  const auth = req.headers.get("Authorization") ?? "";
  if (!isCron && !auth.startsWith("Bearer ")) return fail("unauthorized", { status: 401, functionName: FN });

  const started = Date.now();
  let body: { force?: boolean; user_id?: string } = {};
  try { body = (await req.json()) ?? {}; } catch { /* empty body ok */ }
  const force = body.force === true;

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // -------------------- modo cron (lote) --------------------
  if (isCron) {
    let processed = 0;
    let failed = 0;
    try {
      const targets = await activeUserIds(supa, body.user_id ?? null);
      for (const uid of targets) {
        try {
          await runForUser(supa, uid, false);
          processed++;
        } catch (e) {
          failed++;
          logEvent({ event: "cron_user_error", user_id: uid, err: (e as Error).message });
        }
      }
      await writeJobHeartbeat({
        jobKey: FN,
        ok: failed === 0,
        processed,
        failed,
        errorCode: failed > 0 ? "partial_user_failures" : null,
        nextRunAt: new Date(Date.now() + 3600_000).toISOString(),
        sb: supa,
      });
      logEvent({ event: "cron_done", processed, failed, latency_ms: Date.now() - started });
      return respond({ processed, failed });
    } catch (e) {
      await writeJobHeartbeat({
        jobKey: FN,
        ok: false,
        processed,
        failed: failed + 1,
        errorCode: ((e as Error).message ?? "cron_error").slice(0, 120),
        sb: supa,
      });
      return fail("cron_failed", { status: 500, functionName: FN });
    }
  }

  // -------------------- modo usuário --------------------
  const supaUser = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData } = await supaUser.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return fail("unauthorized", { status: 401, functionName: FN });

  try {
    const result = await runForUser(supa, uid, force);
    logEvent({ event: "user_done", created: result.created, latency_ms: Date.now() - started });
    return respond({
      insight: result.insights[0] ?? null,
      insights: result.insights,
      cached: result.cached,
      throttled: result.throttled ?? false,
      no_candidate: result.no_candidate ?? false,
      fallback: result.fallback ?? false,
    });
  } catch (e) {
    logEvent({ event: "user_error", err: (e as Error).message });
    return fail("insights_failed", { status: 500, functionName: FN });
  }
});

/** Usuários com atividade recente (base do lote do cron). */
async function activeUserIds(supa: SupabaseClient, only: string | null): Promise<string[]> {
  if (only) return [only];
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const { data } = await supa
    .from("transactions")
    .select("user_id")
    .gte("occurred_at", since)
    // Amostra de audiência do cron (não é número exibido): a Data API entrega no
    // máximo 1.000 linhas, então o limite fica explícito em vez de fingir 2.000.
    .limit(1000);
  const set = new Set<string>();
  for (const row of ((data ?? []) as Array<{ user_id?: string }>)) {
    if (row?.user_id) set.add(row.user_id);
  }
  return Array.from(set).slice(0, 50);
}

async function runForUser(supa: SupabaseClient, uid: string, force: boolean): Promise<RunResult> {
  const aiBlocked = await getAiBlock(supa);
  const nowIso = new Date().toISOString();

  // Dicas ativas (cache e controle de janela mínima).
  const { data: activeRows } = await supa
    .from("user_insights")
    .select("*")
    .eq("user_id", uid)
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .order("generated_at", { ascending: false })
    .limit(BATCH_SIZE);
  const active = (activeRows ?? []) as InsightRow[];
  const renderable = active.filter(
    (r) => typeof r.title === "string" && r.title.trim() && typeof r.body === "string" && r.body.trim(),
  );
  const usable = renderable[0];

  // Já existe carrossel cheio e recente: devolve o cache.
  if (!force && renderable.length >= 3 && usable) {
    const cutoff = Date.now() - 6 * 3600 * 1000;
    if (new Date(String(usable.generated_at)).getTime() > cutoff) {
      return { insights: renderable, cached: true, created: 0 };
    }
  }

  const { data: lastRow } = await supa
    .from("user_insights")
    .select("generated_at")
    .eq("user_id", uid)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const minGapConfig = force ? { minGapMinutes: 0 } : undefined;
  if (
    renderable.length > 0 &&
    !canGenerateNow((lastRow as { generated_at?: string } | null)?.generated_at ?? null, { config: minGapConfig })
  ) {
    return { insights: renderable, cached: true, throttled: true, created: 0 };
  }

  // Histórico unificado (dicas + entregas proativas) para a política.
  const since = new Date(Date.now() - 60 * 86400_000).toISOString();
  const [{ data: ledgerRows }, { data: feedbackRows }] = await Promise.all([
    supa.from("v_communication_ledger")
      .select("kind,family,dedup_key,created_at,feedback,status")
      .eq("user_id", uid).gte("created_at", since).limit(300),
    supa.from("communication_feedback")
      .select("kind,family,dedup_key,created_at,feedback")
      .eq("user_id", uid).gte("created_at", since).limit(300),
  ]);
  const ledger: LedgerRow[] = [
    ...(((ledgerRows as LedgerRow[] | null) ?? [])),
    ...(((feedbackRows as LedgerRow[] | null) ?? []).map((row) => ({ ...row, status: row.feedback ?? null }))),
  ];

  // ------- fatos -------
  const now0 = new Date();
  const ym = now0.toISOString().slice(0, 7);
  const prevYm = new Date(now0.getFullYear(), now0.getMonth() - 1, 1).toISOString().slice(0, 7);
  const [
    { count: txCount },
    { data: goals },
    { data: contribs },
    { data: recentTx },
    { data: prevMonthTx },
    { count: cardCount },
    { data: recurring },
    { data: uncategorized },
    { data: categoriesRows },
    { data: cardRows },
    { data: statementRows },
    { data: installmentRows },
    { data: debtRows },
    { data: recurringRules },
  ] = await Promise.all([
    supa.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", uid),
    supa.from("goals").select("id,name,target_amount,target_date,status").eq("user_id", uid).eq("status", "active"),
    supa.from("goal_contributions").select("goal_id,amount").eq("user_id", uid),
    supa
      .from("transactions")
      .select("id,type,amount,category_id,occurred_at,status,transfer_group_id,description,account_id,payment_method,credit_card_id,settles_card_id,movement_kind")
      .eq("user_id", uid)
      .eq("status", "confirmed")
      .gte("occurred_at", `${ym}-01`)
      .order("occurred_at", { ascending: false }),
    supa
      .from("transactions")
      .select("id,type,amount,category_id,occurred_at,status,transfer_group_id,description,account_id,payment_method,credit_card_id,settles_card_id,movement_kind")
      .eq("user_id", uid)
      .eq("status", "confirmed")
      .gte("occurred_at", `${prevYm}-01`)
      .lt("occurred_at", `${ym}-01`),
    supa.from("credit_cards").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("active", true),
    supa.from("recurring_entries").select("id,next_due_date,active").eq("user_id", uid).eq("active", true),
    supa
      .from("transactions")
      .select("id,description,amount,occurred_at,movement_kind")
      .eq("user_id", uid)
      .eq("status", "confirmed")
      .in("type", ["income", "expense"] as never)
      .is("category_id", null)
      .gte("occurred_at", new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10))
      .order("occurred_at", { ascending: false })
      .limit(20),
    supa.from("categories").select("id,name").or(`user_id.eq.${uid},user_id.is.null`),
    supa.from("credit_cards").select("id,closing_day,due_day").eq("user_id", uid).eq("active", true),
    supa.from("credit_card_statements").select("id,credit_card_id,competence_month,status,stated_total,outstanding_amount,paid_amount,due_date").eq("user_id", uid),
    supa.from("credit_card_installments").select("id,credit_card_id,competence_month,amount,status,absorbed_by_statement_id,legacy_transaction_id").eq("user_id", uid),
    supa.from("debts").select("id,name,outstanding_balance,status,installment_amount,due_day").eq("user_id", uid).eq("status", "active"),
    supa.from("recurring_rules").select("id,status,amount,frequency,day_of_month,weekday,start_date,end_date,kind,category_id,account_id,name").eq("user_id", uid).eq("status", "active"),
  ]);

  const monthEnd = new Date(now0.getFullYear(), now0.getMonth() + 1, 0).toISOString().slice(0, 10);
  const allTx = [...((recentTx ?? []) as unknown[]), ...((prevMonthTx ?? []) as unknown[])] as TransactionRow[];
  const behavioral = computeMonthlyTotals((recentTx ?? []) as unknown as TransactionRow[], ym);
  const gross = computeAccountStatementTotals(
    (recentTx ?? []) as unknown as TransactionRow[],
    { start: `${ym}-01`, end: monthEnd },
  );

  const in7 = Date.now() + 7 * 86400_000;
  const upcoming7 = ((recurring ?? []) as Array<{ next_due_date?: string }>).filter((r) => {
    if (!r?.next_due_date) return false;
    const d = new Date(r.next_due_date + "T00:00:00").getTime();
    return d >= Date.now() - 86400_000 && d <= in7;
  }).length;

  // Apenas movimentos comuns podem virar dica de categorização.
  const categorizable = ((uncategorized ?? []) as Array<Record<string, unknown>>).filter(
    (row) => (String(row.movement_kind ?? "transaction")) === "transaction",
  );
  const uncategorized_tx = categorizable[0]
    ? {
      id: String(categorizable[0].id),
      description: (categorizable[0].description as string) ?? null,
      amount: Number(categorizable[0].amount),
      occurred_at: String(categorizable[0].occurred_at),
    }
    : null;

  const catNames = new Map<string, string>();
  for (const c of (categoriesRows ?? []) as Array<{ id: string; name: string }>) catNames.set(c.id, c.name);
  const signals = computeBehavioralSignals(
    allTx,
    catNames,
    (goals ?? []) as never[],
    (contribs ?? []) as never[],
    now0,
  );

  const facts: InsightFacts = {
    total_tx_ever: txCount ?? 0,
    month: ym,
    income_month: Number(behavioral.income.toFixed(2)),
    expense_month: Number(behavioral.expense.toFixed(2)),
    balance_month: Number(behavioral.net.toFixed(2)),
    active_goals: (goals ?? []).length,
    goal_names: ((goals ?? []) as Array<{ name?: string }>).slice(0, 3).map((g) => g.name ?? "").filter(Boolean),
    has_credit_card: (cardCount ?? 0) > 0,
    upcoming_recurring_7d: upcoming7,
    top_expense_category: signals.top_expense_category,
    top_expense_category_pct: signals.top_expense_category_pct,
    category_growth: signals.category_growth,
    weekday_hotspot: signals.weekday_hotspot,
    merchant_repeat: signals.merchant_repeat,
    days_without_entry: signals.days_without_entry,
    goal_pace: signals.goal_pace,
    uncategorized_tx,
  };

  // ------- catálogo determinístico (insights_catalog.v1) -------
  const cards = ((cardRows ?? []) as Array<{ id: string; closing_day?: number | null; due_day?: number | null }>);
  const exposures = computeCardExposure({
    cardIds: cards.map((c) => c.id),
    statements: (statementRows ?? []) as unknown as CardStatementRow[],
    installments: (installmentRows ?? []) as unknown as CardInstallmentRow[],
    txs: allTx,
    currentYM: currentMonthYM(now0),
    cards: cards.map((c) => ({ id: c.id, closing_day: c.closing_day ?? null, due_day: c.due_day ?? null })),
    todayISO: todaySP(now0),
  });
  const todayIsoSP = todaySP(now0);
  const in7Iso = new Date(now0.getTime() + 7 * 86400_000).toISOString().slice(0, 10);
  const statementsDueIn7d = ((statementRows ?? []) as unknown as CardStatementRow[])
    .filter((st) => {
      const dueDate = (st as unknown as { due_date?: string | null }).due_date ?? "";
      const outstanding = Number((st as unknown as { outstanding_amount?: number | string }).outstanding_amount ?? 0);
      return !!dueDate && dueDate >= todayIsoSP && dueDate <= in7Iso && outstanding > 0;
    })
    .map((st) => ({
      cardId: st.credit_card_id,
      dueDate: String((st as unknown as { due_date?: string }).due_date),
      amount: Number((st as unknown as { outstanding_amount?: number | string }).outstanding_amount ?? 0),
    }));
  const normalizedRecurringRules = ((recurringRules ?? []) as Array<Record<string, unknown>>).map((rule) => ({
    id: String(rule.id),
    name: String(rule.name ?? "Compromisso"),
    type: rule.kind === "income" ? "income" : "expense",
    amount: Number(rule.amount ?? 0),
    frequency: String(rule.frequency ?? "monthly"),
    next_due_date: String(rule.start_date ?? todayIsoSP),
    active: rule.status === "active",
  }));
  // Agenda canônica (commitment_agenda.v2) — faturas, parcelas, recorrências,
  // planejados e dívidas, com deduplicação. Mesma fonte da Home.
  const agendaBase = {
    recurring: normalizedRecurringRules as never,
    txs: allTx,
    statements: (statementRows ?? []) as never,
    installments: (installmentRows ?? []) as never,
    cards: (cardRows ?? []) as never,
    debts: (debtRows ?? []) as never,
  };
  const commitments7d = computeCommitmentAgenda({ ...agendaBase, horizonDays: 7 });
  const commitments30d = computeCommitmentAgenda({ ...agendaBase, horizonDays: 30 });

  // ---- sinais adicionais do catálogo (todos derivados de evidência real) ----
  const prevYM = (() => {
    const d = new Date(now0.getFullYear(), now0.getMonth() - 1, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  })();
  const monthExpenses = allTx.filter((t) =>
    (t as unknown as { type?: string }).type === "expense" &&
    String((t as unknown as { occurred_at?: string }).occurred_at ?? "").slice(0, 7) === ym
  ) as Array<Record<string, unknown>>;

  let categoryGrowth: { name: string; current: number; previous: number; growthPct: number } | null = null;
  if (signals.category_growth) {
    const target = signals.category_growth.name;
    const sumFor = (month: string) =>
      allTx.reduce((acc, t) => {
        const row = t as unknown as { type?: string; occurred_at?: string; category_id?: string | null; amount?: number | string };
        if (row.type !== "expense") return acc;
        if (String(row.occurred_at ?? "").slice(0, 7) !== month) return acc;
        if ((catNames.get(String(row.category_id ?? "")) ?? "") !== target) return acc;
        return acc + Math.abs(Number(row.amount ?? 0));
      }, 0);
    const current = Number(sumFor(ym).toFixed(2));
    const previous = Number(sumFor(prevYM).toFixed(2));
    if (current > 0 && previous > 0) {
      categoryGrowth = {
        name: target,
        current,
        previous,
        growthPct: Number((((current - previous) / previous) * 100).toFixed(1)),
      };
    }
  }

  let amountAnomaly: { description: string; amount: number; typicalAmount: number; occurredAt: string } | null = null;
  if (monthExpenses.length >= 5) {
    const values = monthExpenses.map((r) => Math.abs(Number(r.amount ?? 0))).sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)] ?? 0;
    const top = monthExpenses.reduce((best, r) =>
      Math.abs(Number(r.amount ?? 0)) > Math.abs(Number(best.amount ?? 0)) ? r : best, monthExpenses[0]);
    const topAmount = Number(Math.abs(Number(top.amount ?? 0)).toFixed(2));
    if (median > 0 && topAmount >= median * 3) {
      amountAnomaly = {
        description: String(top.description ?? "Um lançamento"),
        amount: topAmount,
        typicalAmount: Number(median.toFixed(2)),
        occurredAt: String(top.occurred_at ?? todayIsoSP),
      };
    }
  }

  const dayOfMonth = Number(todayIsoSP.slice(8, 10));
  const daysInMonth = new Date(now0.getFullYear(), now0.getMonth() + 1, 0).getDate();
  // Ritmo, projeção e caixa do mês: MESMO snapshot canônico da Home/Assessor
  // (finance_truth.v1). Nada de regra linear ou soma de current_balance aqui.
  const canonicalSnapshot = await computeAgentSnapshot(supa, uid);
  const canonicalRhythmSnapshot = canonicalSnapshot;
  const rhythm = behavioral.expense > 0 && dayOfMonth >= 3
    ? {
      dailyTypical: Number(canonicalRhythmSnapshot.typical_daily_pace.toFixed(2)),
      daysLeft: canonicalRhythmSnapshot.days_remaining,
      projectedExpense: Number((
        canonicalRhythmSnapshot.current_month_expense
        + canonicalRhythmSnapshot.projected_remaining_consumption
      ).toFixed(2)),
    }
    : null;

  const subscriptionRules = ((recurring ?? []) as Array<{ type?: string; frequency?: string; amount?: number | string }>)
    .filter((r) => r?.type === "expense" && (r.frequency ?? "monthly") === "monthly");
  const subscriptions = subscriptionRules.length > 0
    ? {
      count: subscriptionRules.length,
      total: Number(subscriptionRules.reduce((a, r) => a + Math.abs(Number(r.amount ?? 0)), 0).toFixed(2)),
    }
    : null;

  const availableToday = Number(canonicalSnapshot.available_today.toFixed(2));
  const projectedBalance = Number(canonicalSnapshot.projected_month_end_available.toFixed(2));

  const evidenceExtra = {
    accounting_scope: ACCOUNTING_SCOPE,
    behavioral_income: behavioral.income,
    behavioral_expense: behavioral.expense,
    behavioral_net: behavioral.net,
    gross_account_in: gross.accountIn,
    gross_account_out: gross.accountOut,
    gross_card_out: gross.cardOut,
    available_today: availableToday,
    projected_balance: projectedBalance,
    commitments_next_30d: Number(commitments30d.totalExpense ?? 0),
  };

  const deterministic = deterministicCandidates({
    cardDebtToday: totalCardDebtOf(exposures),
    cardFutureInstallments: totalFutureInstallmentsOf(exposures),
    cardDebtIsEstimated: Object.values(exposures).some((e) => e.currentStatement.source !== "official"),
    statementsDueIn7d,
    activeDebtTotal: computeActiveDebtsTotal((debtRows ?? []) as never),
    expenseMonth: behavioral.expense,
    incomeMonth: behavioral.income,
    upcomingCommitments7d: Number(commitments7d.totalExpense ?? 0),
    upcomingCommitments30d: Number(commitments30d.totalExpense ?? 0),
    availableToday,
    projectedBalance,
    categoryGrowth,
    amountAnomaly,
    rhythm,
    recurringMerchant: signals.merchant_repeat
      ? {
        name: signals.merchant_repeat.name,
        occurrences: signals.merchant_repeat.occurrences,
        total: Number(Number(signals.merchant_repeat.total).toFixed(2)),
      }
      : null,
    subscriptions,
    daysWithoutEntry: signals.days_without_entry,
    uncategorizedCount: categorizable.length,
  });

  // ------- seleção pela política única (motor único, sem pool genérico) -------
  const activeKeys = new Set(renderable.map((r) => String(r.dedup_key ?? "")).filter(Boolean));
  let remaining = (deterministic as TipCandidate[]).filter((c) => !activeKeys.has(dedupKeyForTip(c)));
  if (remaining.length === 0) {
    return {
      insights: renderable,
      cached: renderable.length > 0,
      no_candidate: true,
      created: 0,
    };
  }

  const missingSlots = Math.max(0, BATCH_SIZE - renderable.length);
  const wanted = force ? Math.max(1, missingSlots) : (missingSlots > 0 ? missingSlots : 1);
  const created: InsightRow[] = [];
  let anyFallback = false;

  for (let slot = 0; slot < wanted && remaining.length > 0; slot++) {
    const selection = selectTip(remaining, ledger);
    const chosen = selection.chosen;
    if (!chosen) break;
    remaining = remaining.filter((c) => dedupKeyForTip(c) !== chosen.dedup_key);

    let payload = { ...chosen.candidate };
    let fallbackReason: string | null = null;
    // A IA só reescreve a dica principal do lote (custo e latência controlados).
    const allowAi = !!LOVABLE_API_KEY && !aiBlocked && chosen.family !== "categorizacao" && slot === 0;

    if (allowAi) {
      const system = `Você é o assistente do MeuNino. Reescreva UMA dica curta em português brasileiro, mantendo EXATAMENTE o mesmo assunto da dica base. Regras rígidas:
- Métricas em income_month/expense_month/balance_month são COMPORTAMENTAIS: já excluem transferências internas, aplicações/resgates/rendimentos, pagamento de fatura e crédito de empréstimo. Se balance_month >= 0, não é déficit.
- VOCABULÁRIO PROIBIDO: "fechou negativo", "fechou no negativo", "déficit", "no vermelho", "saldo negativo do mês". Quando os gastos superam as receitas, escreva "você gastou R$ X acima do que recebeu" (valor absoluto). Quando sobra, escreva "sobraram R$ X".
- Patrimônio líquido JÁ desconta fatura de cartão em aberto e outras dívidas. Nunca diga que ele ignora dívidas.
- Não mude o assunto nem o cta_route da dica base. Transforme o fato em uma leitura específica e uma ação realizável em até 10 minutos.
- Evite frases genéricas como "acompanhe seus gastos", "continue assim" e "reveja seu orçamento". Cite a evidência mais relevante e diga por que ela importa agora.
- Nunca invente valores fora dos fatos.
- title: 4 a 80 caracteres. body: 10 a 240 caracteres. cta_label: 2 a 40 caracteres.
- type deve ser "${payload.type}".
- Tom caloroso, direto, aliado. Sem julgamento, sem promessa de retorno e sem conselho de investimento regulado.
Responda SOMENTE em JSON com chaves type, title, body, cta_label, cta_route.`;
      const userMsg = `Dica base: ${JSON.stringify(payload)}. Fatos: ${JSON.stringify(facts)}.`;

      const aiStarted = Date.now();
      try {
        const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LOVABLE_API_KEY}` },
          body: JSON.stringify({
            model: MODEL,
            // Redação curta não precisa de raciocínio: sem isso a chamada roda
            // por minutos, é cancelada pela plataforma e ainda é cobrada.
            reasoning_effort: "none",
            messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
            response_format: { type: "json_object" },
          }),
        });
        if (!resp.ok) {
          const raw = await resp.text().catch(() => "");
          if (resp.status === 402 || resp.status === 403) await pauseAiCircuit(supa, resp.status, raw);
          fallbackReason = `ai_status_${resp.status}`;
          await recordGatewayCall(supa, {
            workload: "INSIGHTS", function_name: "insights-generate", operation: "rewrite_tip",
            user_id: uid, model: MODEL, operation_type: "chat", success: false,
            http_status: resp.status, error_code: `gateway_${resp.status}`,
            latency_ms: Date.now() - aiStarted, reason_for_ai_call: "insight_copy_rewrite",
          }, null);
        } else {
          const j = await resp.json();
          await recordGatewayCall(supa, {
            workload: "INSIGHTS", function_name: "insights-generate", operation: "rewrite_tip",
            user_id: uid, model: MODEL, operation_type: "chat", success: true,
            http_status: 200, latency_ms: Date.now() - aiStarted,
            reason_for_ai_call: "insight_copy_rewrite",
          }, j);
          const content = j?.choices?.[0]?.message?.content;
          const parsed = typeof content === "string" ? safeJson(content) : content;
          const validated = parseInsightResponse(parsed);
          if (!validated) {
            fallbackReason = "ai_invalid_schema";
          } else {
            payload = {
              ...payload,
              title: validated.title,
              body: validated.body,
              cta_label: validated.cta_label ?? payload.cta_label,
              model: MODEL,
            };
          }
        }
      } catch (_e) {
        fallbackReason = "ai_error";
        await recordGatewayCall(supa, {
          workload: "INSIGHTS", function_name: "insights-generate", operation: "rewrite_tip",
          user_id: uid, model: MODEL, operation_type: "chat", success: false,
          error_code: "network_error", latency_ms: Date.now() - aiStarted,
          reason_for_ai_call: "insight_copy_rewrite",
        }, null);
      }

    } else {
      fallbackReason = LOVABLE_API_KEY ? "deterministic_only" : "no_api_key";
    }

    const finalCheck = InsightSchema.safeParse(payload);
    if (!finalCheck.success) {
      payload = { ...chosen.candidate };
      fallbackReason = `${fallbackReason ?? ""}|final_invalid`;
    }

    // Guardrail numérico: nenhum número pode aparecer no texto sem existir na
    // evidência determinística. Se aparecer, volta ao candidato do catálogo.
    {
      const evidencePool = { ...facts, ...evidenceExtra, candidate: chosen.candidate };
      const bad = unsupportedNumbers(`${payload.title} ${payload.body}`, evidencePool);
      if (bad.length > 0) {
        payload = { ...chosen.candidate };
        fallbackReason = `${fallbackReason ?? ""}|numeric_guard`;
      }
    }
    if (fallbackReason) anyFallback = true;

    const now = new Date();
    const detector = (chosen.candidate as { detector?: string }).detector ?? null;
    const { data: inserted, error } = await supa
      .from("user_insights")
      .insert({
        user_id: uid,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        cta_label: payload.cta_label,
        cta_route: payload.cta_route,
        model: payload.model,
        family: chosen.family,
        dedup_key: chosen.dedup_key,
        logical_dedup_key: insightLogicalKey(uid, chosen.family, chosen.dedup_key),

        evidence: {
          ...facts,
          ...evidenceExtra,
          detector,
          catalog: "insights_catalog.v1",
          ...((chosen.candidate as { evidence?: Record<string, unknown> }).evidence ?? {}),
          ...(uncategorized_tx && chosen.family === "categorizacao" ? { transaction_id: uncategorized_tx.id } : {}),
          selection: { score: chosen.score, relaxed: selection.relaxed, family: chosen.family },
        },
        prompt_version: PROMPT_VERSION,
        generated_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
        status: "active",
      })
      .select("*")
      .single();

    if (error) {
      logEvent({ event: "insert_error", err: error.message, detector, fallbackReason });
      continue;
    }
    created.push(inserted as InsightRow);
    logEvent({
      event: fallbackReason ? "fallback" : "generated",
      fallback_reason: fallbackReason,
      family: chosen.family,
      detector,
      dedup_key: chosen.dedup_key,
    });
  }

  const merged = [...created, ...renderable].slice(0, BATCH_SIZE);
  return {
    insights: merged,
    cached: created.length === 0 && renderable.length > 0,
    no_candidate: created.length === 0,
    fallback: anyFallback,
    created: created.length,
  };
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
