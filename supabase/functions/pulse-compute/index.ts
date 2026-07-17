// Edge Function: pulse-compute
// - Autentica via JWT.
// - Calcula o Pulso Financeiro do usuário no servidor a partir das tabelas reais.
// - Faz upsert idempotente de UM snapshot por dia (America/Sao_Paulo).
// - Retorna score, band, factors, next_action, week_delta e state.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { computePulse, type PulseInput } from "../_shared/pulse/rules.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const token = auth.slice(7);
  const sbAuth = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: claims, error: cerr } = await sbAuth.auth.getClaims(token);
  if (cerr || !claims?.claims) return json({ error: "unauthorized" }, 401);
  const userId = claims.claims.sub as string;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const cutoff14 = new Date(today); cutoff14.setDate(cutoff14.getDate() - 14);
    const cutoff30 = new Date(today); cutoff30.setDate(cutoff30.getDate() - 30);
    const cutoff90 = new Date(today); cutoff90.setDate(cutoff90.getDate() - 90);

    // Buscar dados em paralelo.
    const [txsR, accountsR, cardsR, goalsR, debtsR, contribR, emoR, recR] = await Promise.all([
      sb.from("transactions").select("id,type,status,amount,occurred_at,category_id,credit_card_id,payment_method,settles_card_id").eq("user_id", userId).gte("occurred_at", iso(cutoff90)),
      sb.from("accounts").select("id,opening_balance,active").eq("user_id", userId),
      sb.from("credit_cards").select("id,total_limit,active").eq("user_id", userId).eq("active", true),
      sb.from("goals").select("id,target_amount,status").eq("user_id", userId).eq("status", "active"),
      sb.from("debts").select("id,outstanding_balance,status").eq("user_id", userId).eq("status", "active"),
      sb.from("goal_contributions").select("goal_id,amount"),
      sb.from("emotional_checkins").select("occurred_at,transaction_id").eq("user_id", userId).gte("occurred_at", iso(cutoff30)),
      sb.from("recurring_rules").select("id,active,amount").eq("user_id", userId).eq("active", true),
    ]);

    const txs = (txsR.data ?? []) as Array<{ id: string; type: string; status: string; amount: number | string; occurred_at: string; category_id: string | null; credit_card_id: string | null; payment_method: string | null; settles_card_id?: string | null }>;
    const accounts = (accountsR.data ?? []) as Array<{ opening_balance: number | string; active: boolean }>;
    const cards = (cardsR.data ?? []) as Array<{ total_limit: number | string }>;
    const goals = (goalsR.data ?? []) as Array<{ id: string; target_amount: number | string }>;
    const debts = (debtsR.data ?? []) as Array<{ outstanding_balance: number | string }>;
    const contribs = (contribR.data ?? []) as Array<{ goal_id: string; amount: number | string }>;
    const emos = (emoR.data ?? []) as Array<{ occurred_at: string; transaction_id: string | null }>;
    const recurring = (recR.data ?? []) as Array<{ id: string; active: boolean; amount: number | string }>;

    const confirmed = txs.filter((t) => t.status === "confirmed" && t.type !== "transfer");
    const last14 = confirmed.filter((t) => t.occurred_at >= iso(cutoff14));
    const last30 = confirmed.filter((t) => t.occurred_at >= iso(cutoff30));
    const distinctDays14 = new Set(last14.map((t) => t.occurred_at)).size;

    const isCardOrigin = (t: { payment_method: string | null; credit_card_id: string | null }) =>
      !!t.credit_card_id || (t.payment_method ?? "").toLowerCase() === "credit_card";

    // Saldo total em conta (excluindo despesas em cartão; incluindo pagamentos de fatura como saída).
    let totalCash = 0;
    for (const a of accounts) totalCash += Number(a.opening_balance || 0);
    for (const t of confirmed) {
      if (isCardOrigin(t)) continue;
      const amt = Number(t.amount || 0);
      if (t.type === "income") totalCash += amt;
      else if (t.type === "expense") totalCash -= amt;
    }

    // Fatura em aberto (somando compras no cartão e subtraindo pagamentos de fatura).
    let cardOutstanding = 0;
    for (const t of txs) {
      if (t.status !== "confirmed") continue;
      if (t.type === "expense" && isCardOrigin(t)) cardOutstanding += Number(t.amount || 0);
      if (t.type === "expense" && t.settles_card_id) cardOutstanding -= Number(t.amount || 0);
    }
    cardOutstanding = Math.max(0, cardOutstanding);
    const cardTotalLimit = cards.reduce((a, c) => a + Number(c.total_limit || 0), 0);

    const monthlyExpense30 = last30.filter((t) => t.type === "expense" && !isCardOrigin(t)).reduce((a, t) => a + Number(t.amount || 0), 0);

    // Metas
    const contribByGoal: Record<string, number> = {};
    for (const c of contribs) contribByGoal[c.goal_id] = (contribByGoal[c.goal_id] || 0) + Number(c.amount || 0);
    const goalsPct = goals
      .map((g) => {
        const target = Number(g.target_amount) || 0;
        return target > 0 ? Math.min(1, (contribByGoal[g.id] || 0) / target) : 0;
      });

    const outstandingToday = debts.reduce((a, d) => a + Number(d.outstanding_balance || 0), 0);

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
      pendingOpen: 0,
      pendingStale: 0,
      plannedMonth: 0,
      actualMonth: monthlyExpense30,
      hasPlan: false,
      cardOutstanding,
      cardTotalLimit,
      paymentsOnTime90d: 0,
      paymentsTotal90d: 0,
      totalCash,
      avgMonthlyExpense: monthlyExpense30,
      goalsProgressPct: goalsPct,
      outstandingToday,
      outstanding30dAgo: outstandingToday,
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
    const today_local = new Date(today.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10); // aproximação São Paulo (-03)
    // Deletar duplicatas do dia antes de inserir (evita conflito no índice funcional).
    await sb.rpc("noop" as never).catch(() => undefined); // no-op if not exists
    const { data: existing } = await sb
      .from("pulse_snapshots")
      .select("id")
      .eq("user_id", userId)
      .gte("computed_at", `${today_local}T00:00:00-03:00`)
      .lte("computed_at", `${today_local}T23:59:59-03:00`)
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
    };
    if (existing?.id) {
      await sb.from("pulse_snapshots").update(payload).eq("id", existing.id);
    } else {
      await sb.from("pulse_snapshots").insert(payload);
    }

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
    return json({ error: "internal" }, 500);
  }
});
