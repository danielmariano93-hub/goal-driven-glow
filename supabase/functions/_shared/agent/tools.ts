// Agent tools — server-side implementations. Each `execute` receives its
// user_id from the caller context (never from the model). All ownership
// checks happen inside the SQL RPCs or explicit WHERE user_id filters.
//
// The set below is used both by the LLM path (as JSON-schema tools) and
// as first-class helpers from the deterministic fallback.

// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { computeBeforeSpending } from "../engine/facts.ts";
import { resolveEntity, type Candidate } from "./resolvers.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export type ToolContext = {
  sb: SupabaseClient;
  user_id: string;
  conversation_id: string;
};

export type ToolResult = { ok: true; result: any } | { ok: false; error: string };

async function fetchFactsForBeforeSpending(sb: SupabaseClient, user_id: string) {
  const [accounts, txs, recurring, debts, goals, contribs] = await Promise.all([
    sb.from("accounts").select("id,name,type,opening_balance,active").eq("user_id", user_id),
    sb.from("transactions").select("id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id").eq("user_id", user_id),
    sb.from("recurring_entries").select("id,name,type,amount,frequency,next_due_date,active").eq("user_id", user_id),
    sb.from("debts").select("id,name,outstanding_balance,original_amount,installment_amount,status").eq("user_id", user_id),
    sb.from("goals").select("id,name,target_amount,target_date,status").eq("user_id", user_id),
    sb.from("goal_contributions").select("goal_id,amount,occurred_at").eq("user_id", user_id),
  ]);
  return {
    accounts: accounts.data ?? [],
    txs: (txs.data ?? []).map((t: any) => ({ ...t, amount: Number(t.amount) })),
    recurring: (recurring.data ?? []).map((r: any) => ({ ...r, amount: Number(r.amount) })),
    debts: (debts.data ?? []).map((d: any) => ({ ...d, outstanding_balance: Number(d.outstanding_balance || 0), original_amount: Number(d.original_amount || 0), installment_amount: d.installment_amount == null ? null : Number(d.installment_amount) })),
    goals: (goals.data ?? []).map((g: any) => ({ ...g, target_amount: Number(g.target_amount) })),
    contributions: (contribs.data ?? []).map((c: any) => ({ ...c, amount: Number(c.amount) })),
  };
}

// ---------- Executors ----------

export async function list_accounts(ctx: ToolContext): Promise<ToolResult> {
  const { data, error } = await ctx.sb.from("accounts")
    .select("id,name,type,active,opening_balance")
    .eq("user_id", ctx.user_id).eq("active", true).order("name");
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: data ?? [] };
}

export async function list_categories(ctx: ToolContext, args: { type?: "income"|"expense" }): Promise<ToolResult> {
  const type = args?.type;
  const q = ctx.sb.from("categories").select("id,name,type,user_id");
  const { data: personal } = type
    ? await q.eq("user_id", ctx.user_id).in("type", [type, "both"] as any)
    : await q.eq("user_id", ctx.user_id);
  const gq = ctx.sb.from("categories").select("id,name,type,user_id").is("user_id", null);
  const { data: global } = type
    ? await gq.in("type", [type, "both"] as any)
    : await gq;
  return { ok: true, result: [...(personal ?? []), ...(global ?? [])] };
}

export async function get_financial_summary(ctx: ToolContext): Promise<ToolResult> {
  const today = new Date();
  const y = today.getFullYear(); const m = String(today.getMonth() + 1).padStart(2, "0");
  const monthStart = `${y}-${m}-01`;
  const { data } = await ctx.sb.from("transactions")
    .select("type,amount").eq("user_id", ctx.user_id).gte("occurred_at", monthStart);
  const rows = (data ?? []) as { type: string; amount: number | string }[];
  const income = rows.filter(r => r.type === "income").reduce((s, r) => s + Number(r.amount), 0);
  const expense = rows.filter(r => r.type === "expense").reduce((s, r) => s + Number(r.amount), 0);
  return { ok: true, result: { month: `${y}-${m}`, income, expense, net: income - expense } };
}

export async function list_recent_transactions(ctx: ToolContext, args: { limit?: number }): Promise<ToolResult> {
  const limit = Math.min(20, Math.max(1, args?.limit ?? 5));
  const { data } = await ctx.sb.from("transactions")
    .select("id,type,amount,occurred_at,description,account_id,category_id")
    .eq("user_id", ctx.user_id).order("occurred_at", { ascending: false }).limit(limit);
  return { ok: true, result: data ?? [] };
}

export async function run_before_spending(ctx: ToolContext, args: { amount: number; account_hint?: string }): Promise<ToolResult> {
  const amount = Number(args?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };
  const facts = await fetchFactsForBeforeSpending(ctx.sb, ctx.user_id);
  let accountId: string | null = null;
  if (args?.account_hint) {
    const h = args.account_hint.toLowerCase();
    accountId = facts.accounts.find(a => (a.name as string).toLowerCase().includes(h))?.id ?? null;
  }
  const out = computeBeforeSpending({ amount, accountId, ...facts });
  return { ok: true, result: out };
}

async function upsertDraft(ctx: ToolContext, kind: string, payload: any, summary: string): Promise<string | null> {
  const { data, error } = await ctx.sb.rpc("agent_upsert_draft", {
    p_user_id: ctx.user_id,
    p_conversation_id: ctx.conversation_id,
    p_kind: kind,
    p_payload: payload,
    p_summary: summary,
    p_ttl_minutes: 15,
  });
  if (error) return null;
  return data as string;
}

async function resolveAccountId(ctx: ToolContext, hintOrId?: string): Promise<{ id: string; name: string } | null> {
  if (hintOrId === undefined || hintOrId === null) return null;
  const { data } = await ctx.sb.from("accounts").select("id,name,type")
    .eq("user_id", ctx.user_id).eq("active", true);
  const list: Candidate[] = (data ?? []).map((a: any) => ({
    id: a.id, name: a.name, aliases: [a.type].filter(Boolean),
  }));
  const r = resolveEntity(hintOrId, list);
  if (r.kind === "single") return { id: r.match.id, name: r.match.name };
  return null;
}

async function resolveCategoryId(ctx: ToolContext, hintOrId: string | undefined, type: "income"|"expense"): Promise<string | null> {
  if (!hintOrId) return null;
  if (/^[0-9a-f-]{36}$/i.test(hintOrId)) {
    const { data } = await ctx.sb.from("categories").select("id,user_id")
      .eq("id", hintOrId).maybeSingle();
    if (!data) return null;
    if (data.user_id && data.user_id !== ctx.user_id) return null;
    return data.id as string;
  }
  const { data: personal } = await ctx.sb.from("categories").select("id,name,type")
    .eq("user_id", ctx.user_id).in("type", [type, "both"] as any);
  const { data: global } = await ctx.sb.from("categories").select("id,name,type")
    .is("user_id", null).in("type", [type, "both"] as any);
  const all = [...(personal ?? []), ...(global ?? [])];
  const list: Candidate[] = all.map((c: any) => ({ id: c.id, name: c.name }));
  const r = resolveEntity(hintOrId, list);
  if (r.kind === "single") return r.match.id;
  return null;
}

async function resolveCreditCardFull(ctx: ToolContext, hintOrId?: string): Promise<
  | { kind: "single"; id: string; name: string }
  | { kind: "multiple"; choices: Array<{ id: string; name: string }> }
  | { kind: "none"; available: Array<{ id: string; name: string }> }
> {
  const { data } = await ctx.sb.from("credit_cards").select("id,name,brand,last_four")
    .eq("user_id", ctx.user_id).eq("active", true);
  const list: Candidate[] = (data ?? []).map((c: any) => ({
    id: c.id, name: c.name,
    aliases: [c.brand, c.last_four ? String(c.last_four) : null].filter(Boolean) as string[],
  }));
  const r = resolveEntity(hintOrId ?? "", list);
  if (r.kind === "single") return { kind: "single", id: r.match.id, name: r.match.name };
  if (r.kind === "multiple") return { kind: "multiple", choices: r.matches.map(m => ({ id: m.id, name: m.name })) };
  return { kind: "none", available: list.map(c => ({ id: c.id, name: c.name })) };
}

async function resolveCreditCardId(ctx: ToolContext, hintOrId?: string): Promise<{ id: string; name: string } | null> {
  const r = await resolveCreditCardFull(ctx, hintOrId);
  return r.kind === "single" ? { id: r.id, name: r.name } : null;
}

export { resolveCreditCardFull };

export async function list_credit_cards(ctx: ToolContext): Promise<ToolResult> {
  const { data, error } = await ctx.sb.from("credit_cards")
    .select("id,name,brand,closing_day,due_day,total_limit")
    .eq("user_id", ctx.user_id).eq("active", true).order("name");
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: data ?? [] };
}

const METHOD_ONLY_TERMS = new Set([
  "credito","crédito","debito","débito","pix","dinheiro","cartao","cartão",
  "boleto","transferencia","transferência","ted","doc","fatura","credit_card","account",
]);

function normalizeDesc(s?: string | null): string {
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

export async function create_transaction_draft(ctx: ToolContext, args: {
  type: "income"|"expense"; amount: number; account?: string;
  credit_card?: string; installments_total?: number;
  category?: string; occurred_at?: string; description?: string;
}): Promise<ToolResult> {
  const amount = Number(args?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };
  if (args.type !== "income" && args.type !== "expense") return { ok: false, error: "invalid_type" };
  const rawDesc = (args.description ?? "").trim();
  const normDesc = normalizeDesc(rawDesc);
  if (rawDesc && METHOD_ONLY_TERMS.has(normDesc)) {
    return { ok: false, error: "needs_description", hint: "A descrição não pode ser apenas o meio de pagamento (crédito, débito, pix, cartão…). Pergunte ao usuário 'em quê foi essa compra?' antes de criar o rascunho." } as any;
  }
  const occurred_at = /^\d{4}-\d{2}-\d{2}$/.test(args.occurred_at ?? "") ? args.occurred_at! : new Date().toISOString().slice(0, 10);
  const cat = await resolveCategoryId(ctx, args.category, args.type);

  if (args.credit_card && args.type === "expense") {
    const card = await resolveCreditCardId(ctx, args.credit_card);
    if (!card) return { ok: false, error: "card_not_found" };
    const n = Math.max(1, Math.min(48, Number(args.installments_total ?? 1) || 1));
    const payload = {
      type: args.type, amount, occurred_at,
      description: args.description ?? null,
      category_id: cat,
      payment_method: "credit_card",
      credit_card_id: card.id,
      installments_total: n,
    };
    const parcelStr = n > 1 ? ` em ${n}x` : "";
    const summary = `Despesa de ${BRL.format(amount)} no cartão ${card.name}${parcelStr}${args.description ? ` — ${args.description}` : ""} em ${occurred_at}.`;
    const id = await upsertDraft(ctx, "transaction", payload, summary);
    if (!id) return { ok: false, error: "draft_failed" };
    return { ok: true, result: { draft_id: id, summary, card: card.name, installments_total: n } };
  }

  const acc = await resolveAccountId(ctx, args.account);
  if (!acc) return { ok: false, error: "account_not_found" };
  const payload = { type: args.type, amount, account_id: acc.id, category_id: cat, occurred_at, description: args.description ?? null, payment_method: "account" };
  const summary = `${args.type === "income" ? "Receita" : "Despesa"} de ${BRL.format(amount)} em ${acc.name}${args.description ? ` — ${args.description}` : ""} em ${occurred_at}.`;
  const id = await upsertDraft(ctx, "transaction", payload, summary);
  if (!id) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: id, summary } };
}

export async function create_transfer_draft(ctx: ToolContext, args: {
  amount: number; from_account: string; to_account: string; occurred_at?: string; description?: string;
}): Promise<ToolResult> {
  const amount = Number(args?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };
  const from = await resolveAccountId(ctx, args.from_account);
  const to = await resolveAccountId(ctx, args.to_account);
  if (!from || !to) return { ok: false, error: "account_not_found" };
  if (from.id === to.id) return { ok: false, error: "same_account" };
  const occurred_at = /^\d{4}-\d{2}-\d{2}$/.test(args.occurred_at ?? "") ? args.occurred_at! : new Date().toISOString().slice(0, 10);
  const summary = `Transferência de ${BRL.format(amount)} de ${from.name} para ${to.name} em ${occurred_at}.`;
  const id = await upsertDraft(ctx, "transfer", { amount, from_account_id: from.id, to_account_id: to.id, occurred_at, description: args.description ?? null }, summary);
  if (!id) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: id, summary } };
}

export async function create_goal_draft(ctx: ToolContext, args: {
  name: string; target_amount: number; target_date?: string; priority?: number;
}): Promise<ToolResult> {
  const name = String(args?.name ?? "").trim();
  const target = Number(args?.target_amount);
  if (!name) return { ok: false, error: "invalid_name" };
  if (!Number.isFinite(target) || target <= 0) return { ok: false, error: "invalid_amount" };
  const summary = `Meta “${name}” com alvo de ${BRL.format(target)}${args.target_date ? ` até ${args.target_date}` : ""}.`;
  const id = await upsertDraft(ctx, "goal", {
    name, target_amount: target,
    target_date: /^\d{4}-\d{2}-\d{2}$/.test(args.target_date ?? "") ? args.target_date : null,
    priority: Math.min(5, Math.max(1, Number(args.priority ?? 3))),
  }, summary);
  if (!id) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: id, summary } };
}

export async function add_goal_contribution_draft(ctx: ToolContext, args: {
  goal: string; amount: number; occurred_at?: string; account?: string;
}): Promise<ToolResult> {
  const amount = Number(args?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "invalid_amount" };
  const hint = String(args?.goal ?? "").trim();
  if (!hint) return { ok: false, error: "invalid_goal" };
  // Resolve goal
  let goalId: string | null = null; let goalName = "";
  if (/^[0-9a-f-]{36}$/i.test(hint)) {
    const { data } = await ctx.sb.from("goals").select("id,name").eq("id", hint).eq("user_id", ctx.user_id).maybeSingle();
    if (data) { goalId = data.id as string; goalName = data.name as string; }
  } else {
    const { data } = await ctx.sb.from("goals").select("id,name").eq("user_id", ctx.user_id).eq("status", "active");
    const h = hint.toLowerCase();
    const m = (data ?? []).find(g => (g.name as string).toLowerCase().includes(h));
    if (m) { goalId = m.id as string; goalName = m.name as string; }
  }
  if (!goalId) return { ok: false, error: "goal_not_found" };
  const acc = args.account ? await resolveAccountId(ctx, args.account) : null;
  const occurred_at = /^\d{4}-\d{2}-\d{2}$/.test(args.occurred_at ?? "") ? args.occurred_at! : new Date().toISOString().slice(0, 10);
  const summary = `Aporte de ${BRL.format(amount)} para “${goalName}”${acc ? ` de ${acc.name}` : ""} em ${occurred_at}.`;
  const id = await upsertDraft(ctx, "goal_contribution", { goal_id: goalId, amount, account_id: acc?.id ?? null, occurred_at }, summary);
  if (!id) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: id, summary } };
}

export async function create_debt_draft(ctx: ToolContext, args: {
  name: string; original_amount: number; outstanding_balance?: number;
  installment_amount?: number; due_day?: number; creditor?: string;
}): Promise<ToolResult> {
  const name = String(args?.name ?? "").trim();
  const original = Number(args?.original_amount);
  if (!name) return { ok: false, error: "invalid_name" };
  if (!Number.isFinite(original) || original <= 0) return { ok: false, error: "invalid_amount" };
  const outstanding = Number.isFinite(Number(args.outstanding_balance)) ? Number(args.outstanding_balance) : original;
  const payload = {
    name, creditor: args.creditor ?? null,
    original_amount: original,
    outstanding_balance: outstanding,
    installment_amount: Number.isFinite(Number(args.installment_amount)) ? Number(args.installment_amount) : null,
    due_day: args.due_day && args.due_day >= 1 && args.due_day <= 31 ? args.due_day : null,
  };
  const summary = `Dívida “${name}” — total ${BRL.format(original)}${payload.installment_amount ? `, parcela ${BRL.format(payload.installment_amount!)}` : ""}.`;
  const id = await upsertDraft(ctx, "debt", payload, summary);
  if (!id) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: id, summary } };
}

export async function cancel_pending_action(ctx: ToolContext): Promise<ToolResult> {
  const { data } = await ctx.sb.from("pending_confirmations")
    .select("id").eq("conversation_id", ctx.conversation_id).eq("status", "pending").maybeSingle();
  if (!data) return { ok: true, result: { cancelled: false, reason: "nothing_pending" } };
  await ctx.sb.from("pending_confirmations").update({ status: "cancelled" }).eq("id", data.id);
  return { ok: true, result: { cancelled: true } };
}

// ---------- Read/edit tools (novas) ----------

export async function search_transactions(ctx: ToolContext, args: {
  query?: string; days?: number; type?: "income" | "expense" | "transfer"; limit?: number;
}): Promise<ToolResult> {
  const days = Math.max(1, Math.min(180, Number(args?.days ?? 60)));
  const limit = Math.max(1, Math.min(20, Number(args?.limit ?? 10)));
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  let q = ctx.sb.from("transactions")
    .select("id,type,amount,occurred_at,description,category_id,account_id,credit_card_id,payment_method,installment_number,installments_total,purchase_group_id,version")
    .eq("user_id", ctx.user_id).gte("occurred_at", since)
    .order("occurred_at", { ascending: false }).limit(limit * 2);
  if (args?.type) q = q.eq("type", args.type);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  const term = (args?.query ?? "").trim().toLowerCase();
  let rows = (data ?? []) as any[];
  if (term) {
    rows = rows.filter(r => String(r.description ?? "").toLowerCase().includes(term));
  }
  return { ok: true, result: rows.slice(0, limit) };
}

export async function get_transaction(ctx: ToolContext, args: { transaction_id: string }): Promise<ToolResult> {
  if (!/^[0-9a-f-]{36}$/i.test(String(args?.transaction_id ?? ""))) return { ok: false, error: "invalid_id" };
  const { data, error } = await ctx.sb.from("transactions")
    .select("*").eq("id", args.transaction_id).eq("user_id", ctx.user_id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "not_found" };
  return { ok: true, result: data };
}

export async function draft_transaction_update(ctx: ToolContext, args: {
  transaction_id: string;
  patch: {
    description?: string | null; category?: string | null;
    amount?: number; occurred_at?: string; notes?: string | null;
    payment_method?: "account" | "credit_card";
    account?: string | null; credit_card?: string | null;
  };
  scope?: "one" | "future" | "all";
}): Promise<ToolResult> {
  const id = String(args?.transaction_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "invalid_id" };
  const { data: tx, error } = await ctx.sb.from("transactions")
    .select("id,user_id,version,type,amount,description,category_id,occurred_at,purchase_group_id,installment_number,payment_method,account_id,credit_card_id")
    .eq("id", id).eq("user_id", ctx.user_id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!tx) return { ok: false, error: "not_owned" };
  if ((tx as any).type === "transfer") return { ok: false, error: "transfer_not_editable" };

  const scope = args.scope && ["one","future","all"].includes(args.scope)
    ? (tx as any).purchase_group_id ? args.scope : "one"
    : "one";

  const patch: Record<string, unknown> = {};
  const p = args.patch ?? {};
  if (typeof p.description === "string" || p.description === null) {
    const desc = (p.description ?? "") as string;
    if (desc && METHOD_ONLY_TERMS.has(normalizeDesc(desc))) {
      return { ok: false, error: "needs_description" } as any;
    }
    patch.description = p.description ?? null;
  }
  if (typeof p.amount === "number" && p.amount > 0) patch.amount = p.amount;
  if (typeof p.occurred_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.occurred_at)) patch.occurred_at = p.occurred_at;
  if (typeof p.notes === "string" || p.notes === null) patch.notes = p.notes ?? null;
  if (p.category !== undefined) {
    if (p.category === null || p.category === "") patch.category_id = null;
    else {
      const catId = await resolveCategoryId(ctx, String(p.category), (tx as any).type as "income" | "expense");
      if (!catId) return { ok: false, error: "category_not_found" };
      patch.category_id = catId;
    }
  }

  // Payment method / account / credit card handling
  const wantsPM = p.payment_method === "account" || p.payment_method === "credit_card";
  const wantsAccount = p.account !== undefined && p.account !== null && String(p.account).trim() !== "";
  const wantsCard = p.credit_card !== undefined && p.credit_card !== null && String(p.credit_card).trim() !== "";

  if (wantsPM || wantsAccount || wantsCard) {
    const targetMethod: "account" | "credit_card" =
      p.payment_method ?? (wantsCard ? "credit_card" : wantsAccount ? "account" : ((tx as any).payment_method ?? "account"));
    if (targetMethod === "credit_card") {
      const cardHint = wantsCard ? String(p.credit_card) : "";
      const resolved = cardHint ? await resolveCreditCardFull(ctx, cardHint) : null;
      if (resolved && resolved.kind === "multiple") {
        return { ok: false, error: "card_ambiguous", choices: resolved.choices } as any;
      }
      const cardId = resolved && resolved.kind === "single" ? resolved.id
        : ((tx as any).credit_card_id as string | null);
      if (!cardId) return { ok: false, error: "credit_card_required" };
      patch.payment_method = "credit_card";
      patch.credit_card_id = cardId;
      patch.account_id = null;
    } else {
      const accHint = wantsAccount ? String(p.account) : "";
      const acc = accHint ? await resolveAccountId(ctx, accHint) : null;
      const accId = acc ? acc.id : ((tx as any).account_id as string | null);
      if (!accId) return { ok: false, error: "account_required" };
      patch.payment_method = "account";
      patch.account_id = accId;
      patch.credit_card_id = null;
    }
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: "empty_patch" };

  const summary =
    `Editar lançamento (${scope === "one" ? "esta parcela" : scope === "future" ? "esta e futuras" : "todas as parcelas"}): ` +
    Object.entries(patch).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ");

  const payload = {
    transaction_id: id,
    expected_version: (tx as any).version ?? 1,
    scope, patch,
    before: {
      description: (tx as any).description,
      category_id: (tx as any).category_id,
      amount: Number((tx as any).amount),
      occurred_at: (tx as any).occurred_at,
      payment_method: (tx as any).payment_method,
      account_id: (tx as any).account_id,
      credit_card_id: (tx as any).credit_card_id,
    },
  };
  const draftId = await upsertDraft(ctx, "transaction_update", payload, summary);
  if (!draftId) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: draftId, summary, transaction_id: id, scope, patch, before: (payload as any).before } };
}

export async function draft_transaction_delete(ctx: ToolContext, args: {
  transaction_id: string; scope?: "one" | "future" | "all";
}): Promise<ToolResult> {
  const id = String(args?.transaction_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "invalid_id" };
  const { data: tx, error } = await ctx.sb.from("transactions")
    .select("id,user_id,version,type,amount,description,occurred_at,purchase_group_id,installment_number,transfer_group_id")
    .eq("id", id).eq("user_id", ctx.user_id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!tx) return { ok: false, error: "not_owned" };
  const scope = args.scope && ["one","future","all"].includes(args.scope)
    ? (tx as any).purchase_group_id ? args.scope : "one"
    : "one";
  const label = (tx as any).type === "transfer"
    ? "Excluir transferência (par completo)"
    : `Excluir lançamento (${scope === "one" ? "esta parcela" : scope === "future" ? "esta e futuras" : "todas as parcelas"})`;
  const payload = {
    transaction_id: id,
    expected_version: (tx as any).version ?? 1,
    scope,
    before: { description: (tx as any).description, amount: Number((tx as any).amount), occurred_at: (tx as any).occurred_at },
  };
  const draftId = await upsertDraft(ctx, "transaction_delete", payload, label);
  if (!draftId) return { ok: false, error: "draft_failed" };
  return { ok: true, result: { draft_id: draftId, summary: label, transaction_id: id, scope } };
}

// ---------- Registry (name → executor + JSON Schema) ----------

export type ToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (ctx: ToolContext, args: any) => Promise<ToolResult>;
};

const requiredStr = { type: "string" };
const optionalStr = { type: "string" };
const num = { type: "number" };

export const AGENT_TOOLS: ToolSpec[] = [
  {
    name: "list_accounts",
    description: "Lista as contas ativas do usuário.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: list_accounts,
  },
  {
    name: "list_categories",
    description: "Lista categorias globais e pessoais, opcionalmente filtradas por tipo.",
    parameters: { type: "object", properties: { type: { type: "string", enum: ["income", "expense"] } }, additionalProperties: false },
    execute: list_categories,
  },
  {
    name: "get_financial_summary",
    description: "Retorna entradas, saídas e saldo do período do mês corrente.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: get_financial_summary,
  },
  {
    name: "list_recent_transactions",
    description: "Lista os lançamentos mais recentes do usuário.",
    parameters: { type: "object", properties: { limit: { type: "integer" } }, additionalProperties: false },
    execute: list_recent_transactions,
  },
  {
    name: "run_before_spending",
    description: "Simula o impacto de um gasto usando saldos, recorrências, dívidas e metas do usuário.",
    parameters: {
      type: "object",
      properties: { amount: num, account_hint: optionalStr },
      required: ["amount"], additionalProperties: false,
    },
    execute: run_before_spending,
  },
  {
    name: "list_credit_cards",
    description: "Lista os cartões de crédito ativos do usuário.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: list_credit_cards,
  },
  {
    name: "create_transaction_draft",
    description: "Cria uma proposta de lançamento (receita ou despesa) aguardando CONFIRMAR. Use 'account' para conta comum OU 'credit_card' para despesa em cartão. Não misture os dois.",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["income", "expense"] },
        amount: num,
        account: optionalStr,
        credit_card: optionalStr,
        installments_total: { type: "integer" },
        category: optionalStr, occurred_at: optionalStr, description: optionalStr,
      },
      required: ["type", "amount"], additionalProperties: false,
    },
    execute: create_transaction_draft,
  },
  {
    name: "create_transfer_draft",
    description: "Cria uma proposta de transferência entre duas contas do usuário.",
    parameters: {
      type: "object",
      properties: { amount: num, from_account: requiredStr, to_account: requiredStr, occurred_at: optionalStr, description: optionalStr },
      required: ["amount", "from_account", "to_account"], additionalProperties: false,
    },
    execute: create_transfer_draft,
  },
  {
    name: "create_goal_draft",
    description: "Cria uma proposta de meta financeira.",
    parameters: {
      type: "object",
      properties: { name: requiredStr, target_amount: num, target_date: optionalStr, priority: { type: "integer" } },
      required: ["name", "target_amount"], additionalProperties: false,
    },
    execute: create_goal_draft,
  },
  {
    name: "add_goal_contribution_draft",
    description: "Cria uma proposta de aporte em uma meta existente do usuário.",
    parameters: {
      type: "object",
      properties: { goal: requiredStr, amount: num, occurred_at: optionalStr, account: optionalStr },
      required: ["goal", "amount"], additionalProperties: false,
    },
    execute: add_goal_contribution_draft,
  },
  {
    name: "create_debt_draft",
    description: "Cria uma proposta de dívida.",
    parameters: {
      type: "object",
      properties: {
        name: requiredStr, original_amount: num,
        outstanding_balance: num, installment_amount: num,
        due_day: { type: "integer" }, creditor: optionalStr,
      },
      required: ["name", "original_amount"], additionalProperties: false,
    },
    execute: create_debt_draft,
  },
  {
    name: "cancel_pending_action",
    description: "Cancela o rascunho pendente na conversa atual, se houver.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: cancel_pending_action,
  },
  {
    name: "search_transactions",
    description: "Busca lançamentos do usuário por texto na descrição e/ou por período/tipo. Use antes de editar/excluir para achar o ID exato.",
    parameters: {
      type: "object",
      properties: {
        query: optionalStr,
        days: { type: "integer" },
        type: { type: "string", enum: ["income", "expense", "transfer"] },
        limit: { type: "integer" },
      },
      additionalProperties: false,
    },
    execute: search_transactions,
  },
  {
    name: "get_transaction",
    description: "Retorna todos os campos de um lançamento pelo ID, se pertencer ao usuário.",
    parameters: {
      type: "object",
      properties: { transaction_id: requiredStr },
      required: ["transaction_id"], additionalProperties: false,
    },
    execute: get_transaction,
  },
  {
    name: "draft_transaction_update",
    description: "Cria uma proposta de EDIÇÃO de um lançamento existente. Campos aceitos em patch: description, category (texto), amount, occurred_at, notes. Para parcelamentos, use scope 'one' (padrão), 'future' ou 'all'. Aguarda CONFIRMAR.",
    parameters: {
      type: "object",
      properties: {
        transaction_id: requiredStr,
        patch: {
          type: "object",
          properties: {
            description: { type: ["string", "null"] },
            category: { type: ["string", "null"] },
            amount: num,
            occurred_at: optionalStr,
            notes: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
        scope: { type: "string", enum: ["one", "future", "all"] },
      },
      required: ["transaction_id", "patch"], additionalProperties: false,
    },
    execute: draft_transaction_update,
  },
  {
    name: "draft_transaction_delete",
    description: "Cria uma proposta de EXCLUSÃO de um lançamento. Transferências sempre excluem o par. Aguarda CONFIRMAR.",
    parameters: {
      type: "object",
      properties: {
        transaction_id: requiredStr,
        scope: { type: "string", enum: ["one", "future", "all"] },
      },
      required: ["transaction_id"], additionalProperties: false,
    },
    execute: draft_transaction_delete,
  },
];

export function toolByName(name: string): ToolSpec | null {
  return AGENT_TOOLS.find(t => t.name === name) ?? null;
}

export function openAIToolDefinitions() {
  return AGENT_TOOLS.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
