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
import { previewBatch, stageBatch, type StageCounters } from "../_shared/import/stage.ts";
import type { ImportItem } from "../_shared/import/schema.ts";
import { today as ninoToday } from "../_shared/finance-core/ninoClock.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_DAYS = 90;
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

  if (!["connect_token", "discover", "preview", "stage"].includes(action)) return h.fail("invalid_action", 400);
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

  // ---- preview | stage ----
  const days = Math.min(MAX_DAYS, Math.max(1, Math.floor(Number(body.days ?? DEFAULT_DAYS)) || DEFAULT_DAYS));
  const to = ninoToday();
  const from = addDays(to, -days);

  const { data: links } = await sb.from("bank_account_links")
    .select("external_account_id,external_type,external_name,account_id,credit_card_id")
    .eq("connection_id", (connection as any).id).eq("user_id", userId);
  const mapped = (links ?? []).filter((l: any) => l.account_id || l.credit_card_id);
  if (mapped.length === 0) return h.fail("no_mapped_accounts", 409, { message: MESSAGES.no_mapped_accounts });

  const mode = action === "stage" ? "stage" : "preview";
  const { data: run } = await sb.from("bank_sync_runs")
    .insert({ user_id: userId, connection_id: (connection as any).id, mode }).select("id").single();
  const runId = (run as any)?.id ?? null;

  try {
    const apiKey = await pluggyAuth();
    const totals = emptyCounters();
    const perAccount: Array<Record<string, unknown>> = [];
    const sample: unknown[] = [];
    const documents: string[] = [];
    let skippedPending = 0;
    let skippedInvalid = 0;

    for (const link of mapped as any[]) {
      const raw = await listTransactions(apiKey, link.external_account_id, from, to);
      const adapted = adaptPluggyTransactions(raw, { accountType: link.external_type });
      skippedPending += adapted.skipped.pending;
      skippedInvalid += adapted.skipped.invalid;
      const items: ImportItem[] = adapted.items;
      const target = link.credit_card_id
        ? { kind: "credit_card" as const, id: String(link.credit_card_id), name: String(link.external_name ?? "cartão") }
        : { kind: "account" as const, id: String(link.account_id), name: String(link.external_name ?? "conta") };

      let counters: StageCounters;
      if (mode === "stage") {
        const staged = await stageBatch(sb as any, {
          user_id: userId, source: "open_finance", items, target, raw_text: null, document_kind: "statement",
        });
        counters = staged.counters;
        documents.push(staged.document_id);
      } else {
        const preview = await previewBatch(sb as any, { user_id: userId, items });
        counters = preview.counters;
        // Amostra enxuta só dos itens que exigem atenção (para o dono validar o mapeamento).
        for (const row of preview.rows) {
          if (sample.length < 20 && (row.verdict !== "new" && row.verdict !== "exact_duplicate")) sample.push(row);
        }
      }
      for (const key of Object.keys(totals) as Array<keyof StageCounters>) totals[key] += counters[key];
      perAccount.push({ name: link.external_name, fetched: raw.length, ...counters });
    }

    await sb.from("bank_connections").update({
      last_synced_at: new Date().toISOString(), last_error: null, status: "active", updated_at: new Date().toISOString(),
    }).eq("id", (connection as any).id);
    await sb.from("bank_sync_runs").update({
      status: "ok", finished_at: new Date().toISOString(), document_id: documents[0] ?? null,
      counters: { ...totals, skipped_pending: skippedPending, skipped_invalid: skippedInvalid, from, to, accounts: perAccount.length },
    }).eq("id", runId);

    return h.ok({
      mode, from, to, totals, skipped_pending: skippedPending, skipped_invalid: skippedInvalid,
      accounts: perAccount, sample, document_ids: documents,
    });
  } catch (error) {
    return await failWith(error, runId);
  }
});
