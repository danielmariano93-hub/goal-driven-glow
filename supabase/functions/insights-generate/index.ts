// Edge function: insights-generate
// Gera uma dica personalizada, com validação estrita e fallback determinístico.
// - JWT obrigatório.
// - Cache: reaproveita apenas insights ativos, não vazios e recém-gerados.
// - IA opcional via Lovable Gateway; qualquer falha cai em fallback contextual.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { InsightSchema, pickFallback, parseInsightResponse, type InsightFacts } from "../_shared/insights/fallbacks.ts";
import { computeAccountStatementTotals, computeMonthlyTotals, type TransactionRow } from "../_shared/engine/facts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

const PROMPT_VERSION = "v3-behavioral";
const ACCOUNTING_SCOPE = "behavioral_v1";
const MODEL = "google/gemini-2.5-flash";
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

  // Cache reuse (6h) — only real content.
  if (!force) {
    const cutoff = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const nowIso = new Date().toISOString();
    const { data: existing } = await supa
      .from("user_insights")
      .select("*")
      .eq("user_id", uid)
      .eq("status", "active")
      .gt("expires_at", nowIso)
      .gt("generated_at", cutoff)
      .order("generated_at", { ascending: false })
      .limit(5);
    const usable = (existing ?? []).find(
      (r: any) => typeof r.title === "string" && r.title.trim() && typeof r.body === "string" && r.body.trim(),
    );
    if (usable) {
      logEvent({ event: "cached", latency_ms: Date.now() - started });
      return json({ insight: usable, cached: true });
    }
  }

  // Aggregate facts
  const ym = new Date().toISOString().slice(0, 7);
  const [
    { count: txCount },
    { data: goals },
    { data: recentTx },
    { count: cardCount },
    { data: recurring },
    { data: uncategorized },
  ] = await Promise.all([
    supa.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", uid),
    supa.from("goals").select("id,name,target_amount,status").eq("user_id", uid).eq("status", "active"),
    supa
      .from("transactions")
      .select("id,type,amount,category_id,occurred_at,status,transfer_group_id,description,account_id,payment_method,credit_card_id,settles_card_id,movement_kind")
      .eq("user_id", uid)
      .eq("status", "confirmed")
      .gte("occurred_at", `${ym}-01`)
      .order("occurred_at", { ascending: false }),
    supa.from("credit_cards").select("id", { count: "exact", head: true }).eq("user_id", uid).eq("active", true),
    supa.from("recurring_entries").select("id,next_due_date,active").eq("user_id", uid).eq("active", true),
    // Lançamento sem categoria (últimos 30 dias, prioridade máxima)
    supa
      .from("transactions")
      .select("id,description,amount,occurred_at")
      .eq("user_id", uid)
      .eq("status", "confirmed")
      .in("type", ["income", "expense"] as any)
      .is("category_id", null)
      .gte("occurred_at", new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10))
      .order("occurred_at", { ascending: false })
      .limit(20),
  ]);

  const { data: previousActive } = await supa.from("user_insights")
    .select("id,evidence,title").eq("user_id",uid).eq("status","active")
    .order("generated_at",{ascending:false}).limit(1).maybeSingle();
  const previousTxId = (previousActive?.evidence as any)?.transaction_id as string | undefined;
  const chosenUncategorized = (uncategorized ?? []).find((row: any) => row.id !== previousTxId) ?? (uncategorized ?? [])[0] ?? null;

  // Comportamental (regra canônica): exclui transferências internas, aplicação/
  // resgate/rendimento de investimento, pagamento de fatura e proceeds de
  // empréstimo. Refund abate despesa. É a base para "sobrou/faltou".
  const monthEnd = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
  const behavioral = computeMonthlyTotals((recentTx ?? []) as unknown as TransactionRow[], ym);
  const gross = computeAccountStatementTotals(
    (recentTx ?? []) as unknown as TransactionRow[],
    { start: `${ym}-01`, end: monthEnd },
  );
  const income = behavioral.income;
  const expense = behavioral.expense;
  const totalCount = txCount ?? 0;

  const in7 = Date.now() + 7 * 86400_000;
  const upcoming7 = (recurring ?? []).filter((r: any) => {
    if (!r?.next_due_date) return false;
    const d = new Date(r.next_due_date + "T00:00:00").getTime();
    return d >= Date.now() - 86400_000 && d <= in7;
  }).length;

  const uncategorized_tx = chosenUncategorized
    ? { id: chosenUncategorized.id as string, description: (chosenUncategorized.description as string) ?? null, amount: Number(chosenUncategorized.amount), occurred_at: chosenUncategorized.occurred_at as string }
    : null;

  if (force && previousActive?.id) {
    await supa.from("user_insights").update({ status: "dismissed" }).eq("id", previousActive.id).eq("user_id", uid);
  }

  const facts: InsightFacts = {
    total_tx_ever: totalCount,
    month: ym,
    income_month: Number(income.toFixed(2)),
    expense_month: Number(expense.toFixed(2)),
    balance_month: Number(behavioral.net.toFixed(2)),
    active_goals: (goals ?? []).length,
    goal_names: (goals ?? []).slice(0, 3).map((g: any) => g.name).filter(Boolean),
    has_credit_card: (cardCount ?? 0) > 0,
    upcoming_recurring_7d: upcoming7,
    top_expense_category: null,
    uncategorized_tx,
  };

  // Evidence extra (auditoria): mantém fluxo bruto separado para observabilidade.
  const evidenceExtra = {
    accounting_scope: ACCOUNTING_SCOPE,
    behavioral_income: behavioral.income,
    behavioral_expense: behavioral.expense,
    behavioral_net: behavioral.net,
    gross_account_in: gross.accountIn,
    gross_account_out: gross.accountOut,
    gross_card_out: gross.cardOut,
  };

  // Deep-link determinístico: sempre que existir uncategorized_tx, priorizamos
  // o card de categorização, mesmo com a IA disponível.
  if (uncategorized_tx) {
    const fb = pickFallback(facts);
    const now = new Date();
    const { data: inserted, error } = await supa
      .from("user_insights")
      .insert({
        user_id: uid, type: fb.type, title: fb.title, body: fb.body,
        cta_label: fb.cta_label, cta_route: fb.cta_route, model: fb.model,
        evidence: { ...facts, ...evidenceExtra, transaction_id: uncategorized_tx.id },
        prompt_version: PROMPT_VERSION,
        generated_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
        status: "active",
      })
      .select("*")
      .single();
    if (error) {
      logEvent({ event: "insert_error_categorize", err: error.message });
      return json({ error: "insert_failed" }, 500);
    }
    logEvent({ event: "categorize_priority", latency_ms: Date.now() - started });
    return json({ insight: inserted, cached: false, fallback: false, prioritized: true });
  }


  // Try AI
  let insight: any = null;
  let fallbackReason: string | null = null;

  if (LOVABLE_API_KEY) {
    const system = `Você é o assistente do NoControle.ia. Escreva UMA dica curta em português brasileiro baseada estritamente nos dados fornecidos. Regras rígidas:
- Métricas em income_month/expense_month/balance_month são COMPORTAMENTAIS: já excluem transferências internas, aplicações/resgates/rendimentos de investimento, pagamento de fatura e crédito de empréstimo. NUNCA diga "gastou mais do que recebeu" comparando com fluxo bancário bruto. Se balance_month >= 0, não é déficit.
- title: 4 a 80 caracteres, não vazio, sem "null"/"undefined".
- body: 10 a 240 caracteres, não vazio.
- type: um de habit, alert, celebration, onboarding, opportunity.
- cta_label: 2 a 40 caracteres.
- cta_route: começa com /app/ (ex: /app/lancamentos, /app/metas, /app/relatorios, /app/cartoes, /app/recorrencias).
- Tom caloroso, direto, aliado. Sem julgamento. Sem promessa de retorno financeiro. Sem conselho de investimento regulado. Não invente valores.
Responda SOMENTE em JSON com chaves type, title, body, cta_label, cta_route.`;
    const userMsg = `Dados (JSON): ${JSON.stringify(facts)}. Gere UMA dica.`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMsg },
          ],
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
          insight = {
            type: validated.type ?? (facts.total_tx_ever < 3 ? "onboarding" : "habit"),
            title: validated.title,
            body: validated.body,
            cta_label: validated.cta_label ?? "Ver detalhes",
            cta_route: validated.cta_route ?? "/app/lancamentos",
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
    fallbackReason = "no_api_key";
  }

  if (!insight) {
    insight = pickFallback(facts);
  }

  // Defensive revalidation before insert
  const finalCheck = InsightSchema.safeParse(insight);
  if (!finalCheck.success) {
    insight = pickFallback(facts);
    fallbackReason = (fallbackReason ?? "") + "|final_invalid";
  }

  const now = new Date();
  const { data: inserted, error } = await supa
    .from("user_insights")
    .insert({
      user_id: uid,
      type: insight.type,
      title: insight.title,
      body: insight.body,
      cta_label: insight.cta_label,
      cta_route: insight.cta_route,
      model: insight.model,
      evidence: { ...facts, ...evidenceExtra },
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
    model: insight.model,
    latency_ms: Date.now() - started,
  });
  return json({ insight: inserted, cached: false, fallback: !!fallbackReason });
});

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
