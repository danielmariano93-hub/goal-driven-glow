// Edge Function: finance-derived (`perf_derived.v1`)
// =================================================
// Serve VISÕES DERIVADAS compactas para as telas do app. O dispositivo deixa
// de baixar o ledger para calcular acompanhamento/comparações: o motor
// canônico (`finance-core`, espelho byte-a-byte de `src/lib/engine`) roda
// perto do banco e devolve dezenas de campos, não milhares de linhas.
//
// Regras:
//  - nenhuma fórmula é reimplementada aqui;
//  - o resultado é memoizado por versão do ledger (`perf_derived.v1`);
//  - nada é escrito no ledger.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { fail } from "../_shared/http.ts";
import { computeFinancialPerformance } from "../_shared/finance-core/financialPerformance.ts";
import { getLedgerVersion, readDerivedCache, writeDerivedCache } from "../_shared/derived/cache.ts";

const FN = "finance-derived";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const TX_COLUMNS =
  "id,account_id,type,status,amount,occurred_at,posted_at,competence_date,category_id,description,credit_card_id,payment_method,settles_card_id,transfer_group_id,transfer_direction,movement_kind,refund_of_transaction_id,superseded_by,installment_total,installment_number,origin";

// deno-lint-ignore no-explicit-any
type Any = any;

const MODES = ["MTD_EQUIVALENT", "FULL_MONTH", "LAST_30_DAYS"];

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

  let body: { view?: string; as_of?: string; mode?: string; materiality_floor?: number } = {};
  try { body = await req.json(); } catch { body = {}; }

  const view = String(body.view ?? "performance");
  if (view !== "performance") {
    return json({ ok: false, error: "unknown_view", view }, 400);
  }
  const asOf = ISO.test(String(body.as_of ?? "")) ? String(body.as_of) : new Date().toISOString().slice(0, 10);
  const mode = MODES.includes(String(body.mode)) ? String(body.mode) : "MTD_EQUIVALENT";
  const floor = Number.isFinite(Number(body.materiality_floor)) ? Number(body.materiality_floor) : 50;

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    const ledgerVersion = await getLedgerVersion(sb, userId);
    const cacheKey = `performance|${mode}|${asOf}|${floor}`;
    const cached = await readDerivedCache<Any>(sb, userId, cacheKey, ledgerVersion);
    if (cached) {
      return json({
        ok: true,
        view,
        contract_version: "perf_derived.v1",
        ledger_version: ledgerVersion,
        computed_at: cached.computed_at,
        freshness: "fresh",
        cache_hit: true,
        result: cached.payload,
      });
    }

    const started = Date.now();
    const [{ data: txs, error: txError }, { data: categories }] = await Promise.all([
      sb.from("transactions").select(TX_COLUMNS).eq("user_id", userId),
      sb.from("categories").select("id,name").eq("user_id", userId),
    ]);
    if (txError) throw Object.assign(new Error(txError.message), { source: "transactions" });

    const categoryNames = new Map<string, string>(
      ((categories ?? []) as Any[]).map((c) => [String(c.id), String(c.name)]),
    );
    const result = computeFinancialPerformance({
      txs: ((txs ?? []) as Any[]).map((t) => ({ ...t, amount: Number(t.amount ?? 0) })) as Any,
      categoryNames,
      as_of: asOf,
      mode: mode as Any,
      materialityFloor: floor,
    });
    const computeMs = Date.now() - started;

    await writeDerivedCache(sb, userId, cacheKey, ledgerVersion, result, computeMs).catch(() => undefined);

    return json({
      ok: true,
      view,
      contract_version: "perf_derived.v1",
      ledger_version: ledgerVersion,
      computed_at: new Date().toISOString(),
      freshness: "fresh",
      cache_hit: false,
      compute_ms: computeMs,
      transactions_considered: ((txs ?? []) as Any[]).length,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: "derived_unavailable", source: (error as Any)?.source ?? null, message }, 502);
  }
});
