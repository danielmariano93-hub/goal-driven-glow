// Edge function: insights-generate
// Gera UMA dica do Nino usando a política única de seleção (tipPolicy).
// - JWT obrigatório.
// - Sem short-circuit de categorização: ela concorre como qualquer outra dica.
// - "Agora não" e "não útil" viram cooldown real; diversidade por família.
// - `force` nunca gera duas dicas em sequência (janela mínima).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { fail, respond } from "../_shared/http.ts";

const FN = "insights-generate";
import {
  InsightSchema,
  candidates as buildCandidates,
  pickFallback,
  parseInsightResponse,
  type InsightFacts,
} from "../_shared/insights/fallbacks.ts";
import { computeBehavioralSignals } from "../_shared/insights/facts.ts";
import { computeAccountStatementTotals, computeMonthlyTotals, type TransactionRow } from "../_shared/engine/facts.ts";
import {
  computeActiveDebtsTotal,
  computeCardExposure,
  computeUpcomingCommitments,
  currentMonthYM,
  todaySP,
  totalCardDebtOf,
  totalFutureInstallmentsOf,
  type CardInstallmentRow,
  type CardStatementRow,
} from "../_shared/finance-core/index.ts";
import { deterministicCandidates } from "../_shared/insights/detectors.ts";
import { unsupportedNumbers } from "../_shared/insights/contracts.ts";

import { canGenerateNow, dedupKeyForTip, selectTip, type LedgerRow, type TipCandidate } from "../_shared/intelligence/tipPolicy.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

const PROMPT_VERSION = "v6-evidence-action";
const ACCOUNTING_SCOPE = "behavioral_v1";
// Insights exigem raciocínio e síntese; extração continua no modelo rápido.
// O modelo é configurável para permitir troca controlada e rollback sem deploy.
const MODEL = Deno.env.get("AI_MODEL_REASONING") ?? "google/gemini-2.5-pro";
const AI_TIMEOUT_MS = 8000;

function logEvent(event: Record<string, unknown>) {
  try { console.log(JSON.stringify({ fn: "insights-generate", ...event })); } catch { /* noop */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return fail("unauthorized", { status: 401, functionName: FN });

  const started = Date.now();
  let body: { force?: boolean } = {};
  try { body = (await req.json()) ?? {}; } catch { /* empty body ok */ }
  const force = body.force === true;

  const supaUser = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData } = await supaUser.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return fail("unauthorized", { status: 401, functionName: FN });

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const nowIso = new Date().toISOString();

  // Insight ativo mais recente (cache e controle de janela mínima).
  const { data: activeRows } = await supa
    .from("user_insights")
    .select("*")
    .eq("user_id", uid)
    .eq("status", "active")
    .gt("expires_at", nowIso)
    .order("generated_at", { ascending: false })
    .limit(5);
  const active = (activeRows ?? []) as Record<string, unknown>[];
  const usable = active.find(
    (r) => typeof r.title === "string" && r.title.trim() && typeof r.body === "string" && r.body.trim(),
  );

  if (!force && usable) {
    const cutoff = Date.now() - 6 * 3600 * 1000;
    if (new Date(String(usable.generated_at)).getTime() > cutoff) {
      logEvent({ event: "cached", latency_ms: Date.now() - started });
      return respond({ insight: usable, cached: true });
    }
  }

  // Janela mínima entre gerações. Quando o usuário pede outro assunto
  // ("Agora não"), a janela é dispensada — os cooldowns de feedback seguem
  // valendo e continuam impedindo repetir o mesmo tema.
  const { data: lastRow } = await supa
    .from("user_insights")
    .select("generated_at")
    .eq("user_id", uid)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const minGapConfig = force ? { minGapMinutes: 0 } : undefined;
  if (!canGenerateNow((lastRow as { generated_at?: string } | null)?.generated_at ?? null, { config: minGapConfig })) {
    logEvent({ event: "throttled" });
    return respond({ insight: usable ?? null, cached: !!usable, throttled: true });
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
    supa.from("credit_card_statements").select("id,credit_card_id,competence_month,status,total_amount,outstanding_amount,paid_amount,due_date").eq("user_id", uid),
    supa.from("credit_card_installments").select("id,credit_card_id,competence_month,amount,absorbed_by_statement_id").eq("user_id", uid),
    supa.from("debts").select("outstanding_balance,status").eq("user_id", uid).eq("status", "active"),
    supa.from("recurring_rules").select("id,status,amount,frequency,day_of_month,weekday,start_date,end_date,next_due_date,type,category_id,account_id,description").eq("user_id", uid).eq("status", "active"),
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

  const evidenceExtra = {
    accounting_scope: ACCOUNTING_SCOPE,
    behavioral_income: behavioral.income,
    behavioral_expense: behavioral.expense,
    behavioral_net: behavioral.net,
    gross_account_in: gross.accountIn,
    gross_account_out: gross.accountOut,
    gross_card_out: gross.cardOut,
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
  const commitments7d = computeUpcomingCommitments(
    (recurringRules ?? []) as never,
    allTx,
    7,
  );
  const commitments30d = computeUpcomingCommitments(
    (recurringRules ?? []) as never,
    allTx,
    30,
  );

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
  const rhythm = behavioral.expense > 0 && dayOfMonth >= 3
    ? {
      dailyTypical: Number((behavioral.expense / dayOfMonth).toFixed(2)),
      daysLeft: Math.max(0, daysInMonth - dayOfMonth),
      projectedExpense: Number(((behavioral.expense / dayOfMonth) * daysInMonth).toFixed(2)),
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


  // ------- seleção pela política única -------
  const fullPool = [...deterministic, ...buildCandidates(facts)] as TipCandidate[];
  // Em "Agora não", nunca reapresentamos o assunto que está ativo agora.
  const activeKeys = new Set(
    active.map((r) => String(r.dedup_key ?? "")).filter(Boolean),
  );
  const pool = force && activeKeys.size > 0
    ? fullPool.filter((c) => !activeKeys.has(dedupKeyForTip(c)))
    : fullPool;
  const selection = selectTip(pool.length > 0 ? pool : fullPool, ledger);
  const chosen = selection.chosen;

  if (!chosen) {
    logEvent({ event: "no_eligible_tip", force });
    // Com force, devolver o cache reapresentaria a dica dispensada.
    return respond({ insight: force ? null : (usable ?? null), cached: !force && !!usable, no_candidate: true });
  }


  let payload = { ...chosen.candidate };
  let fallbackReason: string | null = null;
  const allowAi = LOVABLE_API_KEY && chosen.family !== "categorizacao";

  if (allowAi) {
    const system = `Você é o assistente do MeuNino. Reescreva UMA dica curta em português brasileiro, mantendo EXATAMENTE o mesmo assunto da dica base. Regras rígidas:
- Métricas em income_month/expense_month/balance_month são COMPORTAMENTAIS: já excluem transferências internas, aplicações/resgates/rendimentos, pagamento de fatura e crédito de empréstimo. Se balance_month >= 0, não é déficit.
- Não mude o assunto nem o cta_route da dica base. Transforme o fato em uma leitura específica e uma ação realizável em até 10 minutos.
- Evite frases genéricas como "acompanhe seus gastos", "continue assim" e "reveja seu orçamento". Cite a evidência mais relevante e diga por que ela importa agora.
- Nunca invente valores fora dos fatos.
- title: 4 a 80 caracteres. body: 10 a 240 caracteres. cta_label: 2 a 40 caracteres.
- type deve ser "${payload.type}".
- Tom caloroso, direto, aliado. Sem julgamento, sem promessa de retorno e sem conselho de investimento regulado.
Responda SOMENTE em JSON com chaves type, title, body, cta_label, cta_route.`;
    const userMsg = `Dica base: ${JSON.stringify(payload)}. Fatos: ${JSON.stringify(facts)}.`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LOVABLE_API_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: "system", content: system }, { role: "user", content: userMsg }],
          response_format: { type: "json_object" },
        }),
      });
      if (!resp.ok) {
        fallbackReason = `ai_status_${resp.status}`;
      } else {
        const j = await resp.json();
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
    } catch (e) {
      fallbackReason = (e as Error)?.name === "AbortError" ? "ai_timeout" : "ai_error";
    } finally {
      clearTimeout(timer);
    }
  } else {
    fallbackReason = LOVABLE_API_KEY ? "deterministic_family" : "no_api_key";
  }

  const finalCheck = InsightSchema.safeParse(payload);
  if (!finalCheck.success) {
    payload = { ...chosen.candidate };
    fallbackReason = `${fallbackReason ?? ""}|final_invalid`;
    const guard = InsightSchema.safeParse(payload);
    if (!guard.success) payload = pickFallback(facts);
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


  const now = new Date();
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
      evidence: {
        ...facts,
        ...evidenceExtra,
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
    logEvent({ event: "insert_error", err: error.message, fallbackReason });
    return fail("insert_failed", { status: 500, functionName: FN });
  }

  logEvent({
    event: fallbackReason ? "fallback" : "generated",
    fallback_reason: fallbackReason,
    family: chosen.family,
    dedup_key: chosen.dedup_key,
    relaxed: selection.relaxed,
    latency_ms: Date.now() - started,
  });
  return respond({ insight: inserted, cached: false, fallback: !!fallbackReason, family: chosen.family });
});

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
