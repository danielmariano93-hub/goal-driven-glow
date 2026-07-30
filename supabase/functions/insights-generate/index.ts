// Edge function: insights-generate
// Gera UMA dica do Nino usando a política única de seleção (tipPolicy).
// - JWT obrigatório.
// - Sem short-circuit de categorização: ela concorre como qualquer outra dica.
// - "Agora não" e "não útil" viram cooldown real; diversidade por família.
// - `force` nunca gera duas dicas em sequência (janela mínima).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import {
  InsightSchema,
  candidates as buildCandidates,
  pickFallback,
  parseInsightResponse,
  type InsightFacts,
} from "../_shared/insights/fallbacks.ts";
import { computeBehavioralSignals } from "../_shared/insights/facts.ts";
import { computeAccountStatementTotals, computeMonthlyTotals, type TransactionRow } from "../_shared/engine/facts.ts";
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
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

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
  if (!uid) return json({ error: "unauthorized" }, 401);

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
      return json({ insight: usable, cached: true });
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
    return json({ insight: usable ?? null, cached: !!usable, throttled: true });
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

  // ------- seleção pela política única -------
  const fullPool = buildCandidates(facts) as TipCandidate[];
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
    return json({ insight: force ? null : (usable ?? null), cached: !force && !!usable, no_candidate: true });
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
    return json({ error: "insert_failed" }, 500);
  }

  logEvent({
    event: fallbackReason ? "fallback" : "generated",
    fallback_reason: fallbackReason,
    family: chosen.family,
    dedup_key: chosen.dedup_key,
    relaxed: selection.relaxed,
    latency_ms: Date.now() - started,
  });
  return json({ insight: inserted, cached: false, fallback: !!fallbackReason, family: chosen.family });
});

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
