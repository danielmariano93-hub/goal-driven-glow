// Edge Function: finance-bridges-backfill
// ---------------------------------------
// Persiste as pontes canônicas (`finance_contract.v4`) dos últimos N meses.
// - Usa EXCLUSIVAMENTE o núcleo compartilhado (_shared/finance-core/bridges.ts):
//   nenhuma fórmula é reimplementada aqui.
// - Idempotente: as RPCs upsert_cash_bridge/upsert_net_worth_bridge substituem
//   a linha do mesmo (user, período, formula_version).
// - Nunca altera transações, faturas ou dados editados pelo usuário: apenas
//   grava agregados derivados, com confiança e evidência.
//
// Modos:
//  - JWT do usuário: faz backfill do próprio usuário.
//  - x-internal-secret == INTERNAL_CRON_SECRET: faz backfill de todos os usuários
//    com transações (uso por cron).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { fail } from "../_shared/http.ts";
import {
  BRIDGE_FORMULA_VERSION,
  NET_WORTH_FORMULA_VERSION,
  computeCashBridge,
  computeNetWorthBridge,
  type AccountBalanceSnapshotRow,
  type AccountRow,
  type DebtRow,
  type InvestmentRow,
  type TransactionRow,
} from "../_shared/finance-core/index.ts";

const FN = "finance-bridges-backfill";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";
const DEFAULT_MONTHS = 13;

function monthWindows(months: number): Array<{ start: string; end: string }> {
  const now = new Date();
  const out: Array<{ start: string; end: string }> = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const ref = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const y = ref.getUTCFullYear();
    const m = ref.getUTCMonth();
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const mm = String(m + 1).padStart(2, "0");
    out.push({ start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(last).padStart(2, "0")}` });
  }
  return out;
}

async function backfillUser(
  sb: ReturnType<typeof createClient>,
  userId: string,
  months: number,
): Promise<{ user_id: string; periods: number; pending_reconciliation: number }> {
  const [txsR, accountsR, snapsR, invR, debtsR, movR] = await Promise.all([
    sb.from("transactions")
      .select("id,account_id,type,status,amount,occurred_at,posted_at,competence_date,category_id,credit_card_id,payment_method,settles_card_id,transfer_group_id,movement_kind,description")
      .eq("user_id", userId),
    sb.from("accounts").select("id,name,type,opening_balance,active").eq("user_id", userId),
    sb.from("account_balance_snapshots").select("account_id,balance,balance_date,status,anchor_kind,source_document_id,reconciliation_delta").eq("user_id", userId),
    sb.from("investments").select("id,name,invested_amount,current_value,goal_id").eq("user_id", userId),
    sb.from("debts").select("id,name,outstanding_balance,original_amount,status").eq("user_id", userId),
    sb.from("investment_movements").select("kind,amount,occurred_at").eq("user_id", userId),
  ]);

  const firstError = [txsR, accountsR, snapsR, invR, debtsR, movR].find((r) => r.error)?.error;
  if (firstError) throw new Error(`read_failed: ${firstError.message}`);

  const txs = (txsR.data ?? []) as unknown as TransactionRow[];
  const accounts = ((accountsR.data ?? []) as unknown as AccountRow[]).map((a) => ({
    ...a, opening_balance: Number(a.opening_balance || 0),
  }));
  const snapshots = ((snapsR.data ?? []) as unknown as AccountBalanceSnapshotRow[]).map((s) => ({
    ...s, balance: Number(s.balance || 0),
  }));
  const investments = ((invR.data ?? []) as unknown as InvestmentRow[]).map((i) => ({
    ...i, invested_amount: Number(i.invested_amount || 0), current_value: Number(i.current_value || 0),
  }));
  const debts = ((debtsR.data ?? []) as unknown as DebtRow[]).map((d) => ({
    ...d, outstanding_balance: Number(d.outstanding_balance || 0), original_amount: Number(d.original_amount || 0),
  }));
  // A coluna canônica é `kind`; o contrato da ponte usa `type`.
  const investmentMovements = ((movR.data ?? []) as unknown as Array<{ kind: string; amount: number | string; occurred_at: string }>)
    .map((m) => ({ type: String(m.kind), amount: Number(m.amount || 0), occurred_at: m.occurred_at }));

  let pending = 0;
  const windows = monthWindows(months);
  for (const period of windows) {
    const cash = computeCashBridge({ accounts, txs, snapshots, period });
    const nw = computeNetWorthBridge({ accounts, txs, snapshots, period, investments, debts, investmentMovements });
    if (Math.abs(cash.reconciliationDifference) > 0.01) pending += 1;

    const cashPayload = {
      user_id: userId,
      account_id: null,
      period_start: period.start,
      period_end: period.end,
      opening_cash: cash.openingCash,
      operational_income: cash.operationalIncome,
      operational_account_expense: cash.operationalAccountExpense,
      investment_redemptions: cash.investmentRedemptions,
      investment_applications: cash.investmentApplications,
      external_transfers_in: cash.externalTransfersIn,
      external_transfers_out: cash.externalTransfersOut,
      internal_transfers_net: cash.internalTransfersNet,
      loan_proceeds: cash.loanProceeds,
      debt_principal_payments: cash.debtPrincipalPayments,
      debt_interest_and_fees: cash.debtInterestAndFees,
      card_payments: cash.cardPayments,
      refunds_and_reimbursements: cash.refundsAndReimbursements,
      adjustments: cash.adjustments,
      calculated_closing_cash: cash.calculatedClosingCash,
      confirmed_closing_cash: cash.confirmedClosingCash,
      reconciliation_difference: cash.reconciliationDifference,
      confidence: cash.confidence,
      formula_version: BRIDGE_FORMULA_VERSION,
      evidence: { ...cash.evidence, source: "backfill", lines: cash.lines },
    };

    const nwPayload = {
      user_id: userId,
      period_start: period.start,
      period_end: period.end,
      opening_cash: nw.openingCash,
      opening_investments: nw.openingInvestments,
      opening_debts: nw.openingDebts,
      opening_net_worth: nw.openingNetWorth,
      operational_result: nw.operationalResult,
      investment_return: nw.investmentReturn,
      investment_applications: nw.investmentApplications,
      investment_redemptions: nw.investmentRedemptions,
      debt_principal_change: nw.debtPrincipalChange,
      interest_and_fees: nw.interestAndFees,
      valuation_adjustments: nw.valuationAdjustments,
      closing_cash: nw.closingCash,
      closing_investments: nw.closingInvestments,
      closing_debts: nw.closingDebts,
      closing_net_worth: nw.closingNetWorth,
      confidence: nw.confidence,
      formula_version: NET_WORTH_FORMULA_VERSION,
      evidence: { source: "backfill", inference: "reconstructed_from_movements" },
    };

    const [c, n] = await Promise.all([
      sb.rpc("upsert_cash_bridge", { p_bridge: cashPayload }),
      sb.rpc("upsert_net_worth_bridge", { p_bridge: nwPayload }),
    ]);
    if (c.error) throw new Error(`cash_bridge_upsert: ${c.error.message}`);
    if (n.error) throw new Error(`net_worth_bridge_upsert: ${n.error.message}`);
  }

  return { user_id: userId, periods: windows.length, pending_reconciliation: pending };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", { status: 405, functionName: FN });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  let body: { months?: number } = {};
  try { body = await req.json(); } catch { body = {}; }
  const months = Math.min(36, Math.max(1, Number(body.months ?? DEFAULT_MONTHS)));

  const internal = req.headers.get("x-internal-secret") ?? "";
  const isInternal = INTERNAL_SECRET.length > 0 && internal === INTERNAL_SECRET;

  try {
    if (isInternal) {
      const { data, error } = await sb.from("accounts").select("user_id");
      if (error) throw new Error(error.message);
      const ids = Array.from(new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)));
      const results = [];
      for (const id of ids) results.push(await backfillUser(sb, id, months));
      return json({ ok: true, scope: "all_users", users: results.length, results });
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

    const result = await backfillUser(sb, userId, months);
    return json({ ok: true, scope: "self", ...result });
  } catch (e) {
    return fail("bridge_backfill_failed", {
      status: 500, functionName: FN, details: { message: e instanceof Error ? e.message : String(e) },
    });
  }
});
