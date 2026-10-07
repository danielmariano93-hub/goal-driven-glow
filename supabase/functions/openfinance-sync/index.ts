// openfinance-sync — Open Finance (Pluggy), beta fechado e SOMENTE LEITURA.
//
// Nunca grava lançamento direto: a prévia só classifica contra o histórico e o
// "stage" entrega o lote ao estágio de importação (`document_imports`, revisão no app),
// o mesmo caminho de CSV/OFX/PDF, com o mesmo motor de duplicidade.
//
// Ações (POST { action, connection_id?, days? }):
//   status   → está configurado? o usuário tem acesso? conexões e vínculos.
//   connect_token → token de 30 min para abrir o widget Pluggy Connect (cria a conexão).
//   discover → lê as contas da conexão no Pluggy e cria os vínculos (ainda sem destino).
//   preview  → baixa transações das contas vinculadas e devolve contagens/linhas. Sem efeitos.
//   balance  → compara o saldo de cada conta no banco com o saldo calculado no Nino. Não grava nada.
//   reconcile → conciliação do MÊS ATUAL em modo relatório (provisório x banco). Não grava nada.
//   stage    → igual ao preview, mas grava o lote para revisão (nada vira lançamento).
//
// Autenticação: JWT real do usuário. Acesso: `open_finance_access` (liberado pelo dono).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { httpContext } from "../_shared/http.ts";
import { adaptPluggyTransactions, maskedAccountName } from "../_shared/openfinance/pluggyAdapter.ts";
import {
  createConnectToken, getItem, listAccounts, listTransactions, pluggyAuth, pluggyConfigured, pluggyMissingSecrets, PluggyError,
} from "../_shared/openfinance/pluggyClient.ts";
import { fetchAllPages } from "../_shared/derived/pagedSelect.ts";
import { aggregateBankRows, aggregateNinoRows } from "../_shared/openfinance/previewAnalysis.ts";
import { MATCH_WINDOW_DAYS, dedupeAcrossAccounts, planReconciliation, type Provisional } from "../_shared/openfinance/reconcile.ts";
import { classifyBatch } from "../_shared/import/dedupe.ts";
import { previewBatch, stageBatch, type PreviewRow, type StageCounters } from "../_shared/import/stage.ts";
import type { ImportItem } from "../_shared/import/schema.ts";
import { today as ninoToday } from "../_shared/finance-core/ninoClock.ts";
import { computeAccountBalances } from "../_shared/finance-core/facts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_DAYS = 365;

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const MESSAGES: Record<string, string> = {
  not_configured: "A conexão com o Open Finance ainda não está configurada neste ambiente.",
  no_mapped_accounts: "Vincule ao menos uma conta do banco a uma conta ou cartão do Nino antes de sincronizar.",
  auth_failed: "O Pluggy recusou as credenciais ou a conexão expirou. Reconecte o banco.",
  not_found: "Conexão não encontrada no Pluggy.",
  rate_limited: "O Pluggy pediu para esperar um pouco. Tente de novo em alguns minutos.",
  upstream_unavailable: "O Pluggy está indisponível agora. Tente de novo em instantes.",
};

const emptyCounters = (): StageCounters => ({
  total: 0, new: 0, repeated_legitimate: 0, exact_duplicate: 0, probable_duplicate: 0, needs_review: 0, invalid: 0,
});

Deno.serve(async (req) => {
  const h = httpContext("openfinance-sync", req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return h.fail("method_not_allowed", 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return h.fail("unauthorized", 401);
  const userClient = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );
  // getUser valida a assinatura e a expiração no servidor de autenticação.
  const { data: userRes, error: userError } = await userClient.auth.getUser(authHeader.slice(7));
  const userId = String(userRes?.user?.id ?? "");
  if (userError || !userId) return h.fail("unauthorized", 401);

  const { data: enabled } = await userClient.rpc("open_finance_enabled");
  if (enabled !== true) return h.fail("forbidden", 403);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await req.json().catch(() => ({})) as { action?: string; connection_id?: string; days?: number };
  const action = String(body.action ?? "status");

  const { data: connections } = await sb.from("bank_connections")
    .select("id,item_id,label,status,last_synced_at,last_error")
    .eq("user_id", userId).order("created_at");
  const configured = pluggyConfigured();

  if (action === "status") {
    const { data: links } = await sb.from("bank_account_links")
      .select("id,connection_id,external_account_id,external_type,external_name,account_id,credit_card_id")
      .eq("user_id", userId);
    return h.ok({ configured, missing_secrets: pluggyMissingSecrets(), connections: connections ?? [], links: links ?? [] });
  }

  if (!["connect_token", "discover", "preview", "stage", "reconcile"].includes(action)) return h.fail("invalid_action", 400);
  if (!configured) return h.fail("not_configured", 412, { message: MESSAGES.not_configured });

  // Token do widget Pluggy Connect: não precisa de conexão prévia (é assim que ela nasce).
  if (action === "connect_token") {
    try {
      const apiKey = await pluggyAuth();
      const own = (connections ?? []).find((c: any) => c.id === body.connection_id);
      const connectToken = await createConnectToken(apiKey, { clientUserId: userId, itemId: own ? (own as any).item_id : undefined });
      return h.ok({ connect_token: connectToken });
    } catch (error) {
      const code = error instanceof PluggyError ? error.code : "internal";
      return h.fail(code, code === "internal" ? 500 : 502, MESSAGES[code] ? { message: MESSAGES[code] } : {});
    }
  }

  const connection = (connections ?? []).find((c: any) => c.id === body.connection_id && c.status !== "paused");
  if (!connection) return h.fail("not_found", 404);

  const failWith = async (error: unknown, runId: string | null) => {
    const code = error instanceof PluggyError ? error.code : "internal";
    const technical = error instanceof PluggyError && (error.status || error.detail)
      ? `${error.status ?? "sem status"}${error.detail ? `: ${error.detail}` : ""}` : "";
    await sb.from("bank_connections").update({
      last_error: code, status: code === "auth_failed" ? "error" : (connection as any).status, updated_at: new Date().toISOString(),
    }).eq("id", (connection as any).id);
    if (runId) {
      await sb.from("bank_sync_runs").update({
        status: "error", finished_at: new Date().toISOString(), error: technical ? `${code} (${technical})` : code,
      }).eq("id", runId);
    }
    const status = code === "not_found" ? 404 : code === "rate_limited" ? 429 : code === "internal" ? 500 : 502;
    const base = MESSAGES[code] ?? "";
    return h.fail(code, status, base ? { message: technical ? `${base} (Pluggy ${technical})` : base } : {});
  };

  // ---- discover ----
  if (action === "discover") {
    try {
      const apiKey = await pluggyAuth();
      // O Pluggy não expõe o item de contas do Meu Pluggy em todos os endpoints: a ficha do item é opcional.
      const [item, accounts] = await Promise.all([
        getItem(apiKey, (connection as any).item_id).catch(() => ({ status: null, lastUpdatedAt: null, connectorName: null })),
        listAccounts(apiKey, (connection as any).item_id),
      ]);
      for (const account of accounts) {
        await sb.from("bank_account_links").upsert({
          user_id: userId,
          connection_id: (connection as any).id,
          external_account_id: account.id,
          external_type: account.type,
          external_name: maskedAccountName(account.name, account.number),
          updated_at: new Date().toISOString(),
        }, { onConflict: "connection_id,external_account_id", ignoreDuplicates: false });
      }
      await sb.from("bank_connections").update({ last_error: null, status: "active", updated_at: new Date().toISOString() })
        .eq("id", (connection as any).id);
      return h.ok({
        item: { status: item.status, last_updated_at: item.lastUpdatedAt, connector: item.connectorName },
        accounts: accounts.map((a) => ({ id: a.id, type: a.type, name: maskedAccountName(a.name, a.number) })),
      });
    } catch (error) {
      return await failWith(error, null);
    }
  }

  // ---- balance (prova de integridade: saldo do banco x saldo do Nino) ----
  if (action === "balance") {
    try {
      const apiKey = await pluggyAuth();
      const accounts = await listAccounts(apiKey, (connection as any).item_id);
      const { data: links } = await sb.from("bank_account_links")
        .select("external_account_id,external_type,external_name,account_id")
        .eq("connection_id", (connection as any).id).eq("user_id", userId);
      const mapped = ((links ?? []) as any[]).filter((l) => l.account_id && l.external_type === "BANK");
      if (mapped.length === 0) return h.fail("no_mapped_accounts", 409, { message: MESSAGES.no_mapped_accounts });
      const ids = [...new Set(mapped.map((l) => String(l.account_id)))];
      const [{ data: ninoAccounts }, { data: snapshots }, txs] = await Promise.all([
        sb.from("accounts").select("*").eq("user_id", userId).in("id", ids),
        sb.from("account_balance_snapshots").select("*").eq("user_id", userId).in("account_id", ids),
        fetchAllPages<any>((a, b) => sb.from("transactions").select("*")
          .eq("user_id", userId).in("account_id", ids).neq("status", "superseded")
          .order("occurred_at", { ascending: true }).order("id", { ascending: true }).range(a, b)),
      ]);
      const ninoBalances = computeAccountBalances((ninoAccounts ?? []) as any[], txs as any[], (snapshots ?? []) as any[]);
      const round2 = (n: number) => Math.round(n * 100) / 100;
      const rows = mapped.map((l) => {
        const bank = accounts.find((a) => a.id === l.external_account_id);
        const nino = ninoBalances[String(l.account_id)] ?? null;
        const bankBalance = bank?.balance ?? null;
        return {
          name: String(l.external_name ?? "conta"),
          bank_balance: bankBalance,
          nino_balance: nino,
          difference: bankBalance != null && nino != null ? round2(nino - bankBalance) : null,
          // mais de uma conta do banco aponta para a mesma conta do Nino: o saldo do Nino é um só.
          shared_target: mapped.filter((m) => m.account_id === l.account_id).length > 1,
        };
      });
      return h.ok({ balances: rows, as_of: ninoToday() });
    } catch (error) {
      return await failWith(error, null);
    }
  }

  // ---- preview | stage | reconcile ----
  // Corte no mês atual: meses anteriores já foram conferidos e não são retroagidos.
  const to = ninoToday();
  const monthStart = `${to.slice(0, 8)}01`;
  const explicitDays = Number(body.days);
  const from = Number.isFinite(explicitDays) && explicitDays > 0
    ? addDays(to, -Math.min(MAX_DAYS, Math.floor(explicitDays)))
    : monthStart;

  const { data: links } = await sb.from("bank_account_links")
    .select("external_account_id,external_type,external_name,account_id,credit_card_id")
    .eq("connection_id", (connection as any).id).eq("user_id", userId);
  const mapped = (links ?? []).filter((l: any) => l.account_id || l.credit_card_id);
  if (mapped.length === 0) return h.fail("no_mapped_accounts", 409, { message: MESSAGES.no_mapped_accounts });

  const mode = action === "stage" ? "stage" : action === "reconcile" ? "reconcile" : "preview";
  const { data: run } = await sb.from("bank_sync_runs")
    .insert({ user_id: userId, connection_id: (connection as any).id, mode }).select("id").single();
  const runId = (run as any)?.id ?? null;

  try {
    const apiKey = await pluggyAuth();
    let skippedPending = 0;
    let skippedInvalid = 0;
    let skippedCardSide = 0;

    // Lê e traduz cada conta/cartão vinculado.
    const loaded: Array<{ id: string; link: any; target: { kind: "account" | "credit_card"; id: string; name: string }; items: ImportItem[]; fetched: number }> = [];
    for (const link of mapped as any[]) {
      const raw = await listTransactions(apiKey, link.external_account_id, from, to);
      const adapted = adaptPluggyTransactions(raw, { accountType: link.external_type });
      skippedPending += adapted.skipped.pending;
      skippedInvalid += adapted.skipped.invalid;
      skippedCardSide += adapted.skipped.card_side;
      loaded.push({
        id: String(link.external_account_id), link, fetched: raw.length, items: adapted.items,
        target: link.credit_card_id
          ? { kind: "credit_card", id: String(link.credit_card_id), name: String(link.external_name ?? "cartão") }
          : { kind: "account", id: String(link.account_id), name: String(link.external_name ?? "conta") },
      });
    }
    // Duas contas com os mesmos movimentos (ex.: mesmo final) não podem entrar em dobro.
    const dedup = dedupeAcrossAccounts(loaded);
    const batches = dedup.batches;
    const duplicatedAccounts = dedup.overlaps.length;

    await sb.from("bank_connections").update({
      last_synced_at: new Date().toISOString(), last_error: null, status: "active", updated_at: new Date().toISOString(),
    }).eq("id", (connection as any).id);

    // ---- reconcile (somente relatório: nada é gravado em transactions) ----
    if (mode === "reconcile") {
      const accountIds = batches.filter((b) => b.target.kind === "account").map((b) => b.target.id);
      const cardIds = batches.filter((b) => b.target.kind === "credit_card").map((b) => b.target.id);
      const ninoTx: any[] = [];
      for (const [column, ids] of [["account_id", accountIds], ["credit_card_id", cardIds]] as const) {
        if (ids.length === 0) continue;
        const rows = await fetchAllPages<any>((a, b) => sb.from("transactions")
          .select("id,occurred_at,posted_at,amount,type,description,raw_description,merchant_name,origin,category_id,bank_reference,external_id,account_id,credit_card_id,movement_kind,status,dedupe_fingerprint,import_source_id,source_document_id,source_line_index")
          .eq("user_id", userId).in(column, ids)
          .gte("occurred_at", addDays(from, -MATCH_WINDOW_DAYS)).lte("occurred_at", to)
          .neq("status", "superseded")
          .order("occurred_at", { ascending: true }).order("id", { ascending: true })
          .range(a, b), { source: "open_finance_reconcile" });
        ninoTx.push(...rows);
      }

      const report = { matches: [] as any[], new_items: [] as any[], unmatched: [] as any[] };
      const counts = { already_reconciled: 0, known_by_statement: 0, matched_alta: 0, matched_valor: 0, matched_duvida: 0, new: 0, waiting: 0, not_shown: 0 };
      const money = { new_expense: 0, new_income: 0, bank_delta_on_matches: 0 };

      for (const batch of batches) {
        const targetTx = ninoTx.filter((t) => batch.target.kind === "account" ? t.account_id === batch.target.id : t.credit_card_id === batch.target.id);
        const boundRefs = new Set(targetTx.map((t) => String(t.bank_reference ?? t.external_id ?? "")).filter(Boolean));

        // a) já conciliado em sincronização anterior
        let items = batch.items.filter((i) => {
          const hit = boundRefs.has(String(i.external_id));
          if (hit) counts.already_reconciled++;
          return !hit;
        });

        // b) já está no Nino por extrato importado (motor único de duplicidade, só contra importações)
        const imported = targetTx.filter((t) => t.origin === "import").map((t) => ({ ...t, amount: Number(t.amount) }));
        const verdicts = classifyBatch(items.map((i) => ({
          type: i.type, amount: i.amount, occurred_at: i.occurred_at, posted_at: i.posted_at, purchase_date: i.purchase_date,
          description: i.description, raw_description: i.raw_description, merchant: i.merchant,
          bank_reference: i.bank_reference, external_id: i.external_id, ordinal: i.ordinal,
        })), imported as any);
        items = items.filter((_, idx) => {
          const known = verdicts[idx].status === "exact_duplicate" || verdicts[idx].status === "probable_duplicate";
          if (known) counts.known_by_statement++;
          return !known;
        });

        // c) provisórios (WhatsApp / app) sem vínculo com o banco
        const provisional: Provisional[] = targetTx
          .filter((t) => (t.origin === "agent" || t.origin === "manual") && !t.bank_reference && !t.external_id && t.movement_kind !== "adjustment")
          .map((t) => ({
            id: String(t.id), occurred_at: String(t.occurred_at), amount: Number(t.amount), type: t.type, description: t.description,
            raw_description: t.raw_description, merchant_name: t.merchant_name, origin: t.origin, category_id: t.category_id,
          }));

        const plan = planReconciliation(items, provisional, to);
        for (const m of plan.matches) {
          if (m.level === "alta") counts.matched_alta++; else if (m.level === "valor_diferente") counts.matched_valor++; else counts.matched_duvida++;
          money.bank_delta_on_matches = Math.round((money.bank_delta_on_matches + m.amount_delta) * 100) / 100;
          if (report.matches.length < 60) {
            report.matches.push({
              level: m.level, date: m.bank.occurred_at, bank: String(m.bank.description).slice(0, 50), bank_amount: m.bank.amount,
              nino: String(m.tx.description ?? "").slice(0, 50), nino_amount: m.tx.amount, delta: m.amount_delta, origin: m.tx.origin,
            });
          }
        }
        for (const n of plan.new_items) {
          counts.new++;
          if (n.type === "expense") money.new_expense = Math.round((money.new_expense + n.amount) * 100) / 100;
          else money.new_income = Math.round((money.new_income + n.amount) * 100) / 100;
          if (report.new_items.length < 60) {
            report.new_items.push({ date: n.occurred_at, description: String(n.description).slice(0, 50), amount: n.amount, type: n.type, kind: n.movement_kind, issues: n.issues });
          }
        }
        for (const u of plan.unmatched_provisional) {
          if (String(u.tx.occurred_at) < from) continue; // só o mês atual entra no relatório
          if (u.status === "nao_apareceu") counts.not_shown++; else counts.waiting++;
          if (report.unmatched.length < 60) {
            report.unmatched.push({ status: u.status, date: u.tx.occurred_at, description: String(u.tx.description ?? "").slice(0, 50), amount: u.tx.amount, age_days: u.age_days, origin: u.tx.origin });
          }
        }
      }

      await sb.from("bank_sync_runs").update({
        status: "ok", finished_at: new Date().toISOString(),
        counters: { from, to, ...counts, ...money, duplicated_accounts: duplicatedAccounts, skipped_pending: skippedPending, skipped_card_side: skippedCardSide },
      }).eq("id", runId);
      return h.ok({
        mode, from, to, counts, money, duplicated_accounts: duplicatedAccounts,
        skipped_pending: skippedPending, skipped_card_side: skippedCardSide, report,
      });
    }

    // ---- preview | stage ----
    const totals = emptyCounters();
    const perAccount: Array<Record<string, unknown>> = [];
    const sample: unknown[] = [];
    const documents: string[] = [];
    const allRows: PreviewRow[] = [];

    for (const batch of batches) {
      let counters: StageCounters;
      if (mode === "stage") {
        const staged = await stageBatch(sb as any, {
          user_id: userId, source: "open_finance", items: batch.items, target: batch.target, raw_text: null, document_kind: "statement",
        });
        counters = staged.counters;
        documents.push(staged.document_id);
      } else {
        const preview = await previewBatch(sb as any, { user_id: userId, items: batch.items });
        counters = preview.counters;
        allRows.push(...preview.rows);
        // Amostra enxuta só dos itens que exigem atenção (para o dono validar o mapeamento).
        for (const row of preview.rows) {
          if (sample.length < 20 && (row.verdict !== "new" && row.verdict !== "exact_duplicate")) sample.push(row);
        }
      }
      for (const key of Object.keys(totals) as Array<keyof StageCounters>) totals[key] += counters[key];
      perAccount.push({ name: batch.link.external_name, fetched: batch.fetched, ...counters });
    }

    // Prévia: guarda um resumo só com números (banco x Nino) para análise de impacto. Sem descrições.
    let analysis: Record<string, unknown> | null = null;
    if (mode === "preview") {
      const accountIds = (mapped as any[]).map((l) => l.account_id).filter(Boolean);
      const cardIds = (mapped as any[]).map((l) => l.credit_card_id).filter(Boolean);
      const ninoRows: any[] = [];
      for (const [column, ids] of [["account_id", accountIds], ["credit_card_id", cardIds]] as const) {
        if (ids.length === 0) continue;
        const txs = await fetchAllPages<any>((a, b) => sb.from("transactions")
          .select("occurred_at,origin,movement_kind,type,amount")
          .eq("user_id", userId).in(column, ids).gte("occurred_at", from).lte("occurred_at", to)
          .neq("status", "superseded")
          .order("occurred_at", { ascending: true }).order("id", { ascending: true })
          .range(a, b), { source: "open_finance_analysis" });
        ninoRows.push(...txs);
      }
      analysis = { bank: aggregateBankRows(allRows), nino: aggregateNinoRows(ninoRows) };
    }
    await sb.from("bank_sync_runs").update({
      status: "ok", finished_at: new Date().toISOString(), document_id: documents[0] ?? null,
      counters: {
        ...totals, skipped_pending: skippedPending, skipped_invalid: skippedInvalid, skipped_card_side: skippedCardSide,
        duplicated_accounts: duplicatedAccounts, from, to, accounts: perAccount.length, ...(analysis ? { analysis } : {}),
      },
    }).eq("id", runId);

    return h.ok({
      mode, from, to, totals, skipped_pending: skippedPending, skipped_invalid: skippedInvalid,
      skipped_card_side: skippedCardSide, duplicated_accounts: duplicatedAccounts,
      accounts: perAccount, sample, document_ids: documents,
    });
  } catch (error) {
    return await failWith(error, runId);
  }
});
