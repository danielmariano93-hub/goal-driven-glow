// Edge Function: finance-facts-worker (`perf_facts.v1`)
// =====================================================
// CONSUMIDOR REAL da fila `financial_dirty_periods`.
//
// Uma escrita financeira marca o mês afetado; este worker recomputa SOMENTE
// esses meses e materializa `financial_monthly_facts`. Alterar um lançamento de
// março recomputa março — nunca a vida inteira.
//
// Propriedades: bounded (teto por rodada), idempotente (upsert por
// user+mês), resumable (lease + retry com tentativas) e observável (métricas
// por rodada e `last_error` por mês).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { TX_COLUMNS } from "../_shared/derived/txColumns.ts";
import {
  computeMonthlyFacts,
  FACTS_FORMULA_VERSION,
  fetchMonthRows,
} from "../_shared/derived/monthlyFacts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// deno-lint-ignore no-explicit-any
type Any = any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Aceita o mesmo segredo usado pelos outros workers do projeto (o cron manda
  // `x-cron-secret`) ou uma chamada autenticada (bootstrap administrativo).
  const secrets = ["CRON_SECRET", "INTERNAL_CRON_SECRET"]
    .map((k) => Deno.env.get(k) ?? "")
    .filter((v) => v.length > 0);
  const provided = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  if (secrets.length > 0 && !secrets.includes(provided) && !authHeader) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  let body: { limit?: number; bootstrap_user_id?: string } = {};
  try { body = await req.json(); } catch { body = {}; }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const startedAt = Date.now();

  // Bootstrap/rebuild administrativo: enfileira o histórico da pessoa.
  let enqueued = 0;
  if (body.bootstrap_user_id) {
    const { data, error } = await sb.rpc("finance_facts_enqueue_history", {
      p_user: body.bootstrap_user_id,
    });
    if (error) return json({ ok: false, error: "enqueue_failed", message: error.message }, 500);
    enqueued = Number(data ?? 0);
  }

  const limit = Math.max(1, Math.min(Number(body.limit ?? 40), 200));
  const { data: claimed, error: claimError } = await sb.rpc("finance_facts_claim", {
    p_limit: limit,
    p_lease_seconds: 300,
  });
  if (claimError) return json({ ok: false, error: "claim_failed", message: claimError.message }, 500);

  const results: Array<{
    user_id: string;
    month: string;
    ok: boolean;
    rows?: number;
    compute_ms?: number;
    error?: string;
  }> = [];

  for (const item of ((claimed ?? []) as Any[])) {
    const userId = String(item.user_id);
    const monthDate = String(item.competence_month).slice(0, 10);
    const month = monthDate.slice(0, 7);
    const t0 = Date.now();
    try {
      const rows = await fetchMonthRows(sb, userId, month, TX_COLUMNS);
      const normalized = rows.map((r: Any) => ({ ...r, amount: Number(r.amount ?? 0) }));
      const facts = computeMonthlyFacts(month, normalized as Any);
      const { data: version } = await sb
        .from("financial_ledger_versions")
        .select("version")
        .eq("user_id", userId)
        .maybeSingle();

      const computeMs = Date.now() - t0;
      const { error: upsertError } = await sb.from("financial_monthly_facts").upsert({
        user_id: userId,
        competence_month: `${month}-01`,
        formula_version: FACTS_FORMULA_VERSION,
        ledger_version: Number((version as Any)?.version ?? 0),
        income: facts.income,
        behavioral_expense: facts.behavioral_expense,
        refunds: facts.refunds,
        account_in: facts.account_in,
        account_out: facts.account_out,
        card_out: facts.card_out,
        internal_transfers: facts.internal_transfers,
        external_transfers_in: facts.external_transfers_in,
        external_transfers_out: facts.external_transfers_out,
        investment_applications: facts.investment_applications,
        investment_redemptions: facts.investment_redemptions,
        loan_proceeds: facts.loan_proceeds,
        debt_payments: facts.debt_payments,
        card_payments: facts.card_payments,
        transaction_count: facts.transaction_count,
        days_with_expense: facts.days_with_expense,
        account_deltas: facts.account_deltas,
        card_deltas: facts.card_deltas,
        category_breakdown: facts.category_breakdown,
        merchant_breakdown: facts.merchant_breakdown,
        completeness: facts.completeness,
        computed_at: new Date().toISOString(),
        compute_ms: computeMs,
        transactions_read: rows.length,
      }, { onConflict: "user_id,competence_month" });
      if (upsertError) throw new Error(upsertError.message);

      await sb.rpc("finance_facts_mark_processed", { p_user: userId, p_month: monthDate });
      results.push({ user_id: userId, month, ok: true, rows: rows.length, compute_ms: computeMs });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await sb.rpc("finance_facts_mark_failed", {
        p_user: userId,
        p_month: monthDate,
        p_error: message,
      });
      results.push({ user_id: userId, month, ok: false, error: message });
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  return json({
    ok: true,
    contract_version: FACTS_FORMULA_VERSION,
    enqueued,
    claimed: results.length,
    processed: okCount,
    failed: results.length - okCount,
    transactions_read: results.reduce((a, r) => a + (r.rows ?? 0), 0),
    rebuild_ms: Date.now() - startedAt,
    months: results,
  });
});
