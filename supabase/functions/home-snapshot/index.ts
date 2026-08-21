// Edge Function: home-snapshot (`home_snapshot.v1`)
// ================================================
// Materializa a VERDADE FINANCEIRA DO PERÍODO no servidor.
//
// Antes, a Home baixava todo o histórico de transações (paginado de 1.000 em
// 1.000) para o navegador/iPhone e rodava `computeFinancialSnapshot` no cliente.
// Aqui o mesmo motor determinístico (`finance-core`, espelho byte-a-byte de
// `src/lib/engine`) roda perto do banco e devolve SÓ o snapshot pronto.
//
// Regras:
//  - o motor é o mesmo do app: nenhuma fórmula é reimplementada nesta função;
//  - fonte crítica que falha ⇒ erro explícito (nunca snapshot parcial mudo);
//  - fonte opcional que falha ⇒ entra em `missing_sources` e a Home degrada
//    honestamente a superfície correspondente.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { fail } from "../_shared/http.ts";
import { computeFinancialSnapshot } from "../_shared/finance-core/metrics.ts";
import { nextOccurrenceFor } from "../_shared/finance-core/index.ts";
import { TX_COLUMNS, fetchAllTransactions } from "../_shared/derived/txColumns.ts";
import { buildCompactLedger, resolveWindow } from "../_shared/derived/compactLedger.ts";
import { getLedgerVersion, readDerivedCache, writeDerivedCache } from "../_shared/derived/cache.ts";

const FN = "home-snapshot";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ISO = /^\d{4}-\d{2}-\d{2}$/;


// deno-lint-ignore no-explicit-any
type Any = any;

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", { status: 405, functionName: FN });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return fail("unauthorized", { status: 401, functionName: FN });

  const sbAuth = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await sbAuth.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) return fail("unauthorized", { status: 401, functionName: FN });

  let body: { start?: string; end?: string; today?: string; bootstrap?: boolean } = {};
  try { body = await req.json(); } catch { body = {}; }
  if (!ISO.test(String(body.start ?? "")) || !ISO.test(String(body.end ?? ""))) {
    return json({ error: "invalid_period", message: "Informe start e end no formato YYYY-MM-DD." }, 400);
  }
  const start = String(body.start);
  const end = String(body.end);
  const today = ISO.test(String(body.today ?? "")) ? String(body.today) : new Date().toISOString().slice(0, 10);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const missing: string[] = [];

  try {
    // Memoização por versão do ledger: enquanto nada financeiro é escrito,
    // reabrir a Home não recalcula o snapshot (perf_derived.v1).
    const ledgerVersion = await getLedgerVersion(sb, userId);
    const cacheKey = `home_snapshot|${start}|${end}|${today}`;
    const cached = await readDerivedCache<Any>(sb, userId, cacheKey, ledgerVersion);
    if (cached) {
      return json({
        ok: true,
        formula_version: "home_snapshot.v1",
        period: { start, end },
        today,
        missing_sources: cached.payload?.missing_sources ?? [],
        transactions_considered: cached.payload?.transactions_considered ?? null,
        ledger_version: ledgerVersion,
        computed_at: cached.computed_at,
        cache_hit: true,
        snapshot: cached.payload?.snapshot ?? cached.payload,
      });
    }
    const startedAt = Date.now();

    const q = <T,>(p: PromiseLike<{ data: T | null; error: Any }>, source: string, critical: boolean) =>
      Promise.resolve(p).then((r) => {
        if (r.error) {
          if (critical) throw Object.assign(new Error(r.error.message), { source });
          missing.push(source);
          return null;
        }
        return r.data;
      });

    const [
      accounts, snapshots, investments, debts, categories, categoryGoals,
      goals, contributions, recurring, settings, statements, installments, cards, invMovements,
    ] = await Promise.all([
      q(sb.from("accounts").select("id,name,type,opening_balance,active").eq("user_id", userId), "accounts", true),
      // Mesmo contrato do app (`bank_cash_truth.v1`): só snapshot CONFIRMADO
      // ancora, e `balance_date` é a data de corte.
      q(sb.from("account_balance_snapshots")
        .select("account_id,balance_date,balance,status,anchor_kind,source_document_id,reconciliation_delta")
        .eq("user_id", userId).eq("status", "confirmed")
        .order("balance_date", { ascending: true }), "accountSnapshots", true),
      q(sb.from("investments").select("id,name,invested_amount,current_value,goal_id").eq("user_id", userId), "investments", false),
      q(sb.from("debts").select("id,name,outstanding_balance,original_amount,status,installment_amount,due_day").eq("user_id", userId), "debts", false),
      q(sb.from("categories").select("id,name,type").eq("user_id", userId), "categories", false),
      q(sb.from("category_spending_goals").select("*").eq("user_id", userId), "categoryGoals", false),
      q(sb.from("goals").select("*").eq("user_id", userId), "goals", false),
      q(sb.from("goal_contributions").select("goal_id,amount,occurred_at").eq("user_id", userId), "goalContributions", false),
      q(sb.from("recurring_rules").select("id,name,kind,amount,frequency,start_date,end_date,day_of_month,weekday,status").eq("user_id", userId), "recurringRules", false),
      q(sb.from("user_financial_settings").select("approximate_monthly_income,income_frequency,income_day").eq("user_id", userId).maybeSingle(), "financialSettings", false),
      q(sb.from("credit_card_statements").select("id,credit_card_id,competence_month,due_date,stated_total,paid_amount,outstanding_amount,reconciliation_difference,status").eq("user_id", userId), "cardStatements", false),
      q(sb.from("credit_card_installments").select("id,credit_card_id,competence_month,amount,status,absorbed_by_statement_id,legacy_transaction_id").eq("user_id", userId), "cardInstallments", false),
      q(sb.from("credit_cards").select("id,name,closing_day,due_day").eq("user_id", userId), "creditCards", false),
      q(sb.from("investment_movements").select("kind,amount,occurred_at").eq("user_id", userId), "investmentMovements", false),
    ]);

    // CAMINHO NORMAL (`perf_facts.v1`): a Home lê a JANELA do período + os
    // fatos mensais consolidados. O ledger inteiro só entra em bootstrap ou
    // rebuild administrativo — nunca na abertura normal.
    const bootstrap = body.bootstrap === true;
    const window = resolveWindow({ start, end }, today);
    const factsReadStarted = Date.now();
    let compact: Awaited<ReturnType<typeof buildCompactLedger>> | null = null;
    let txs: Any[];
    if (bootstrap) {
      txs = await fetchAllTransactions(sb, userId);
    } else {
      compact = await buildCompactLedger(sb, userId, TX_COLUMNS, window, (accounts ?? []) as Any[], {
        hardAnchors: ((snapshots ?? []) as Any[])
          .filter((s) => s.anchor_kind === "bank_confirmed" && s.status === "confirmed")
          .map((s) => ({ account_id: String(s.account_id), balance_date: String(s.balance_date) })),
      });
      txs = compact.txs;
      // Materialização pendente: a superfície degrada honestamente em vez de
      // servir número velho ou baixar a vida inteira.
      if (!compact.carryApplied) missing.push("monthlyFactsPending");
    }
    const derivedFactReadMs = Date.now() - factsReadStarted;

    const categoryNameById: Record<string, string> = {};
    for (const c of (categories ?? []) as Any[]) categoryNameById[c.id] = c.name;

    const snapshot = computeFinancialSnapshot({
      accounts: ((accounts ?? []) as Any[]).map((a) => ({
        id: a.id, name: a.name, type: a.type, opening_balance: num(a.opening_balance), active: a.active,
      })),
      txs: ((txs ?? []) as Any[]).map((t) => ({ ...t, amount: num(t.amount) })) as Any,
      // Âncora de caixa sintética (`perf_facts.v1`): substitui o histórico
      // anterior à janela por um saldo consolidado por conta, sem mudar
      // fórmula nenhuma — o motor já sabe ancorar.
      snapshots: [
        ...((snapshots ?? []) as Any[]).map((s) => ({ ...s, balance: num(s.balance) })),
        ...(compact?.syntheticAnchors ?? []),
      ] as Any,
      recurring: ((recurring ?? []) as Any[])
        .filter((r) => r.status === "active")
        .map((r) => ({
          id: r.id, name: r.name,
          type: r.kind === "income" ? "income" : "expense",
          amount: num(r.amount),
          frequency: ["daily", "weekly", "monthly", "yearly"].includes(r.frequency) ? r.frequency : "monthly",
          next_due_date: nextOccurrenceFor(r, today) ?? r.start_date,
          active: true,
        })) as Any,
      investments: ((investments ?? []) as Any[]).map((i) => ({
        id: i.id, name: i.name, invested_amount: num(i.invested_amount),
        current_value: num(i.current_value), goal_id: i.goal_id,
      })),
      debts: ((debts ?? []) as Any[]).map((d) => ({
        id: d.id, name: d.name,
        outstanding_balance: num(d.outstanding_balance),
        original_amount: num(d.original_amount),
        status: d.status,
        installment_amount: d.installment_amount == null ? null : num(d.installment_amount),
        due_day: d.due_day == null ? null : num(d.due_day),
      })),
      categoryGoals: ((categoryGoals ?? []) as Any[]).map((g) => ({
        ...g,
        reduction_pct: g.reduction_pct == null ? null : num(g.reduction_pct),
        fixed_limit: g.fixed_limit == null ? null : num(g.fixed_limit),
        baseline_value: g.baseline_value == null ? null : num(g.baseline_value),
        computed_limit: num(g.computed_limit),
      })) as Any,
      categoryNameById,
      categories: ((categories ?? []) as Any[]).map((c) => ({ id: c.id, name: c.name, type: c.type })),
      goals: ((goals ?? []) as Any[]).map((g) => ({
        id: g.id, name: g.name, target_amount: num(g.target_amount),
        target_date: g.target_date, status: g.status,
        kind: g.kind ?? "savings",
        donation_mode: g.donation_mode ?? null,
        donation_percent: g.donation_percent == null ? null : num(g.donation_percent),
        monthly_target: g.monthly_target == null ? null : num(g.monthly_target),
        donation_income_scope: g.donation_income_scope ?? "all",
        donation_income_category_ids: g.donation_income_category_ids ?? [],
        donation_due_day: num(g.donation_due_day ?? 25),
        donation_end_date: g.donation_end_date ?? null,
      })) as Any,
      goalContributions: ((contributions ?? []) as Any[]).map((c) => ({
        goal_id: c.goal_id, amount: num(c.amount), occurred_at: c.occurred_at,
      })),
      period: { start, end },
      cardStatements: ((statements ?? []) as Any[]).map((s) => ({
        ...s,
        stated_total: num(s.stated_total),
        paid_amount: num(s.paid_amount),
        outstanding_amount: s.outstanding_amount == null ? null : num(s.outstanding_amount),
        reconciliation_difference: s.reconciliation_difference == null ? null : num(s.reconciliation_difference),
      })) as Any,
      cardInstallments: ((installments ?? []) as Any[]).map((i) => ({ ...i, amount: num(i.amount) })) as Any,
      cardIds: ((cards ?? []) as Any[]).map((c) => c.id),
      cards: ((cards ?? []) as Any[]).map((c) => ({ id: c.id, name: c.name, closing_day: c.closing_day, due_day: c.due_day })),
      investmentMovements: ((invMovements ?? []) as Any[]).map((m) => ({
        type: String(m.kind), amount: num(m.amount), occurred_at: m.occurred_at,
      })),
      incomeSettings: settings
        ? {
          approximate_monthly_income: (settings as Any).approximate_monthly_income == null
            ? null
            : num((settings as Any).approximate_monthly_income),
          income_frequency: (settings as Any).income_frequency ?? null,
          income_day: (settings as Any).income_day == null ? null : num((settings as Any).income_day),
        }
        : null,
      // O motor exige `Date` aqui (ele mesmo converte para a âncora America/Sao_Paulo).
      today: new Date(`${today}T12:00:00-03:00`),

    } as Any);

    const payload = {
      missing_sources: missing,
      transactions_considered: ((txs ?? []) as Any[]).length,
      snapshot,
    };
    const computeMs = Date.now() - startedAt;
    // Só memoiza snapshot completo: parcial não vira verdade guardada.
    // Nem parcial nem desatualizado viram verdade guardada.
    if (missing.length === 0 && (compact?.staleMonths?.length ?? 0) === 0) {
      await writeDerivedCache(sb, userId, cacheKey, ledgerVersion, payload, computeMs).catch(() => undefined);
    }

    return json({
      ok: true,
      formula_version: "home_snapshot.v1",
      period: { start, end },
      today,
      // A Home usa isto para degradar a superfície certa, e nunca para inventar.
      missing_sources: missing,
      transactions_considered: payload.transactions_considered,
      ledger_version: ledgerVersion,
      computed_at: new Date().toISOString(),
      cache_hit: false,
      compute_ms: computeMs,
      // Observabilidade do caminho de rebuild (`perf_facts.v1`).
      read_path: bootstrap ? "full_ledger_bootstrap" : "monthly_facts_window",
      window: compact ? { start: compact.windowStart, end: compact.windowEnd } : null,
      months_materialized: compact?.monthsMaterialized ?? null,
      transactions_read: compact?.transactionsRead ?? payload.transactions_considered,
      derived_fact_read_ms: derivedFactReadMs,
      dirty_months_pending: [...(compact?.missingMonths ?? []), ...(compact?.staleMonths ?? [])],
      freshness: (compact?.staleMonths?.length ?? 0) > 0 ? "stale_recomputing" : "fresh",
      snapshot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const source = (error as Any)?.source ?? null;
    console.error("[home-snapshot] falha", message, error instanceof Error ? error.stack : null);
    // Fonte crítica indisponível: a Home mostra erro e oferece "tentar de novo".
    return json({ ok: false, error: "snapshot_unavailable", source, message }, 502);
  }
});
