// LifecycleTools — deterministic maintenance/write adapters that were missing
// from Runtime V3. They only resolve owned entities and persist confirmation
// drafts; the database confirmation RPC remains the commit authority.
// deno-lint-ignore-file no-explicit-any

import {
  draft_transaction_delete,
  draft_transaction_update,
  type ToolContext,
  type ToolResult,
} from "../tools.ts";
import { localDate } from "../../finance-core/ninoClock.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function norm(value: unknown): string {
  return String(value ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  let raw = String(value ?? "").trim();
  if (!raw) return null;
  raw = raw.replace(/r\$/ig, "").replace(/\s/g, "");
  if (raw.includes(",")) raw = raw.replace(/\./g, "").replace(",", ".");
  const n = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function intValue(value: unknown): number | null {
  const n = numberValue(value);
  return n != null && Number.isInteger(n) ? n : null;
}

function boolValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return /^(true|1|sim|yes|s)$/i.test(String(value ?? "").trim());
}

function dateValue(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^20\d{2}-\d{2}-\d{2}$/.test(raw)) return raw;
  const br = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  return br ? `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}` : null;
}

async function draft(ctx: ToolContext, kind: string, payload: any, summary: string): Promise<ToolResult> {
  const { data, error } = await ctx.sb.rpc("agent_upsert_draft", {
    p_user_id: ctx.user_id,
    p_conversation_id: ctx.conversation_id,
    p_kind: kind,
    p_payload: payload,
    p_summary: summary,
    p_ttl_minutes: 15,
  });
  if (error || !data) return { ok: false, error: `draft_persistence_failed:${error?.message ?? "empty_id"}` };
  return { ok: true, result: { draft_id: String(data), summary } };
}

function choiceError(kind: string, choices: any[]): ToolResult {
  return { ok: false, error: `${kind}_ambiguous`, result: { choices: choices.slice(0, 5) } };
}

function bestByName<T extends Record<string, any>>(rows: T[], hint: unknown, fields: string[]): T[] {
  const h = norm(hint);
  if (!h) return rows;
  const exact = rows.filter((row) => fields.some((f) => norm(row[f]) === h));
  if (exact.length) return exact;
  return rows.filter((row) => fields.some((f) => norm(row[f]).includes(h) || h.includes(norm(row[f]))));
}

async function resolveTransaction(ctx: ToolContext, hint: unknown): Promise<any | null | any[]> {
  const raw = String(hint ?? "").trim();
  if (UUID.test(raw)) {
    const { data } = await ctx.sb.from("transactions")
      .select("id,description,amount,occurred_at,version,type,purchase_group_id,installment_number,payment_method,account_id,credit_card_id,category_id")
      .eq("id", raw).eq("user_id", ctx.user_id).maybeSingle();
    return data ?? null;
  }
  const { data, error } = await ctx.sb.from("transactions")
    .select("id,description,amount,occurred_at,version,type,purchase_group_id,installment_number,payment_method,account_id,credit_card_id,category_id")
    .eq("user_id", ctx.user_id).eq("status", "confirmed")
    .order("occurred_at", { ascending: false }).order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (/\b(ultimo|ultima|aquilo|isso|esse|essa)\b/.test(norm(raw))) return rows[0] ?? null;
  const cleaned = norm(raw).replace(/\b(lancamento|gasto|despesa|compra|transacao|de|do|da|o|a)\b/g, " ").replace(/\s+/g, " ").trim();
  const matches = bestByName(rows, cleaned || raw, ["description"]);
  return matches.length <= 1 ? (matches[0] ?? null) : matches;
}

async function resolveGoal(ctx: ToolContext, hint: unknown): Promise<any | null | any[]> {
  const raw = String(hint ?? "").trim();
  let q = ctx.sb.from("goals").select("id,name,target_amount,target_date,status,priority,notes").eq("user_id", ctx.user_id);
  if (UUID.test(raw)) q = q.eq("id", raw);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(30);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (UUID.test(raw)) return rows[0] ?? null;
  const matches = bestByName(rows, raw, ["name"]);
  return matches.length <= 1 ? (matches[0] ?? null) : matches;
}

async function resolveDebt(ctx: ToolContext, hint: unknown): Promise<any | null | any[]> {
  const raw = String(hint ?? "").trim();
  let q = ctx.sb.from("debts")
    .select("id,name,creditor,outstanding_balance,installment_amount,installments_total,installments_paid,status")
    .eq("user_id", ctx.user_id);
  if (UUID.test(raw)) q = q.eq("id", raw);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(30);
  if (error) throw new Error(error.message);
  let rows = data ?? [];
  if (UUID.test(raw)) return rows[0] ?? null;
  rows = rows.filter((r: any) => r.status !== "settled");
  const matches = bestByName(rows, raw, ["name", "creditor"]);
  return matches.length <= 1 ? (matches[0] ?? null) : matches;
}

async function resolveCategory(ctx: ToolContext, hint: unknown): Promise<any | null | any[]> {
  const raw = String(hint ?? "").trim();
  let q = ctx.sb.from("categories").select("id,name,slug,type,user_id,archived_at")
    .eq("user_id", ctx.user_id).is("archived_at", null);
  if (UUID.test(raw)) q = q.eq("id", raw);
  const { data, error } = await q.order("name").limit(50);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (UUID.test(raw)) return rows[0] ?? null;
  const matches = bestByName(rows, raw, ["name", "slug"]);
  return matches.length <= 1 ? (matches[0] ?? null) : matches;
}

async function resolveSplit(ctx: ToolContext, hint: unknown): Promise<any | null | any[]> {
  const raw = String(hint ?? "").trim();
  let q = ctx.sb.from("shared_expenses")
    .select("id,title,total_amount,occurred_at,due_date,split_mode,status,reminder_enabled,pix_key,source_account_id,source_credit_card_id,reimbursement_account_id,category_id,linked_transaction_id")
    .eq("owner_user_id", ctx.user_id).is("deleted_at", null);
  if (UUID.test(raw)) q = q.eq("id", raw);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(30);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (UUID.test(raw)) return rows[0] ?? null;
  const matches = bestByName(rows, raw, ["title"]);
  return matches.length <= 1 ? (matches[0] ?? null) : matches;
}

async function resolveRecurring(ctx: ToolContext, hint: unknown): Promise<any | null | any[]> {
  const raw = String(hint ?? "").trim();
  let q = ctx.sb.from("recurring_rules")
    .select("id,name,kind,amount,account_id,category_id,frequency,day_of_month,weekday,start_date,end_date,status")
    .eq("user_id", ctx.user_id);
  if (UUID.test(raw)) q = q.eq("id", raw);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(30);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (UUID.test(raw)) return rows[0] ?? null;
  const matches = bestByName(rows, raw, ["name"]);
  return matches.length <= 1 ? (matches[0] ?? null) : matches;
}

async function resolveAccount(ctx: ToolContext, hint: unknown): Promise<any | null | any[]> {
  const raw = String(hint ?? "").trim();
  const { data, error } = await ctx.sb.from("accounts").select("id,name,type")
    .eq("user_id", ctx.user_id).eq("active", true).order("name");
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (!raw) return rows.length === 1 ? rows[0] : (rows.length ? rows : null);
  if (UUID.test(raw)) return rows.find((r: any) => r.id === raw) ?? null;
  const matches = bestByName(rows, raw, ["name", "type"]);
  return matches.length <= 1 ? (matches[0] ?? null) : matches;
}

async function transactionUpdate(ctx: ToolContext, args: any): Promise<ToolResult> {
  const tx = await resolveTransaction(ctx, args.transaction ?? args.transaction_id ?? args.description ?? args.merchant);
  if (Array.isArray(tx)) return choiceError("transaction", tx);
  if (!tx) return { ok: false, error: "transaction_not_found" };
  const patch: any = {};
  if (args.new_description != null || args.description_new != null) patch.description = args.new_description ?? args.description_new;
  if (args.category != null || args.new_category != null) patch.category = args.new_category ?? args.category;
  const amount = numberValue(args.new_amount ?? args.amount);
  if (amount != null) patch.amount = amount;
  const occurred = dateValue(args.new_date ?? args.occurred_at ?? args.date);
  if (occurred) patch.occurred_at = occurred;
  if (args.account != null) { patch.payment_method = "account"; patch.account = args.account; }
  if (args.credit_card != null) { patch.payment_method = "credit_card"; patch.credit_card = args.credit_card; }
  if (!Object.keys(patch).length) return { ok: false, error: "transaction_update_empty_patch" };
  return await draft_transaction_update(ctx, { transaction_id: tx.id, patch, scope: args.scope ?? "one" });
}

async function transactionDelete(ctx: ToolContext, args: any): Promise<ToolResult> {
  const tx = await resolveTransaction(ctx, args.transaction ?? args.transaction_id ?? args.description ?? args.merchant);
  if (Array.isArray(tx)) return choiceError("transaction", tx);
  if (!tx) return { ok: false, error: "transaction_not_found" };
  return await draft_transaction_delete(ctx, { transaction_id: tx.id, scope: args.scope ?? "one" });
}

async function goalUpdate(ctx: ToolContext, args: any): Promise<ToolResult> {
  const goal = await resolveGoal(ctx, args.goal ?? args.goal_id ?? args.name);
  if (Array.isArray(goal)) return choiceError("goal", goal);
  if (!goal) return { ok: false, error: "goal_not_found" };
  const patch: any = {};
  if (args.new_name != null) patch.name = String(args.new_name).trim();
  const target = numberValue(args.target_amount ?? args.new_target_amount ?? args.amount);
  if (target != null) patch.target_amount = target;
  const targetDate = dateValue(args.target_date ?? args.new_target_date);
  if (targetDate) patch.target_date = targetDate;
  if (args.priority != null) patch.priority = intValue(args.priority);
  if (args.status != null) patch.status = String(args.status);
  if (!Object.keys(patch).length) return { ok: false, error: "goal_update_empty_patch" };
  return await draft(ctx, "goal_update", { goal_id: goal.id, patch, before: goal }, `Atualizar a meta “${goal.name}”.`);
}

async function goalDelete(ctx: ToolContext, args: any): Promise<ToolResult> {
  const goal = await resolveGoal(ctx, args.goal ?? args.goal_id ?? args.name);
  if (Array.isArray(goal)) return choiceError("goal", goal);
  if (!goal) return { ok: false, error: "goal_not_found" };
  return await draft(ctx, "goal_delete", { goal_id: goal.id, before: goal }, `Excluir a meta “${goal.name}”. Essa ação também remove os aportes vinculados.`);
}

async function debtPayment(ctx: ToolContext, args: any): Promise<ToolResult> {
  const debt = await resolveDebt(ctx, args.debt ?? args.debt_id ?? args.name ?? args.creditor);
  if (Array.isArray(debt)) return choiceError("debt", debt);
  if (!debt) return { ok: false, error: "debt_not_found" };
  let amount = numberValue(args.amount);
  const installmentCount = intValue(args.installments_covered ?? args.installments);
  const wantsFull = boolValue(args.full_payment) || /\b(quita|quitar|quitei|inteira|inteiro|toda|todo)\b/i.test(String(ctx.user_text ?? ""));
  if (amount == null && wantsFull) amount = Number(debt.outstanding_balance);
  if (amount == null && installmentCount && Number(debt.installment_amount) > 0) amount = installmentCount * Number(debt.installment_amount);
  if (amount == null || amount <= 0) return { ok: false, error: "debt_payment_amount_required" };
  if (amount > Number(debt.outstanding_balance) + 0.00001) return { ok: false, error: "debt_payment_exceeds_balance" };
  const account = await resolveAccount(ctx, args.account ?? args.account_id);
  if (Array.isArray(account) && args.account) return choiceError("account", account);
  const selected = Array.isArray(account) ? null : account;
  const paidAt = dateValue(args.paid_at ?? args.date) ?? localDate();
  const payload = {
    debt_id: debt.id,
    amount,
    account_id: selected?.id ?? null,
    paid_at: paidAt,
    interest_amount: numberValue(args.interest_amount) ?? 0,
    fee_amount: numberValue(args.fee_amount) ?? 0,
    installments_covered: installmentCount ?? 0,
    notes: args.notes ?? null,
    before: debt,
  };
  const verb = Math.abs(amount - Number(debt.outstanding_balance)) < 0.005 ? "Quitar" : "Registrar pagamento em";
  return await draft(ctx, "debt_payment", payload, `${verb} “${debt.name}” em ${BRL.format(amount)}. Saldo atual: ${BRL.format(Number(debt.outstanding_balance))}.`);
}

async function categoryCreate(ctx: ToolContext, args: any): Promise<ToolResult> {
  const name = String(args.name ?? args.category ?? "").trim();
  if (!name) return { ok: false, error: "category_name_required" };
  const kind = String(args.type ?? args.kind ?? "expense").toLowerCase() === "income" ? "income" : "expense";
  const { data } = await ctx.sb.from("categories").select("id,name").eq("user_id", ctx.user_id).is("archived_at", null).ilike("name", name).limit(1);
  if (data?.length) return { ok: false, error: "category_already_exists" };
  return await draft(ctx, "category_create", { name, type: kind }, `Criar categoria “${name}” (${kind === "income" ? "entrada" : "saída"}).`);
}

async function categoryUpdate(ctx: ToolContext, args: any): Promise<ToolResult> {
  const category = await resolveCategory(ctx, args.category ?? args.category_id ?? args.name);
  if (Array.isArray(category)) return choiceError("category", category);
  if (!category) return { ok: false, error: "category_not_found" };
  const newName = String(args.new_name ?? args.rename_to ?? "").trim();
  if (!newName) return { ok: false, error: "category_new_name_required" };
  return await draft(ctx, "category_update", { category_id: category.id, new_name: newName, before: category }, `Renomear categoria “${category.name}” para “${newName}”.`);
}

async function categoryDelete(ctx: ToolContext, args: any): Promise<ToolResult> {
  const category = await resolveCategory(ctx, args.category ?? args.category_id ?? args.name);
  if (Array.isArray(category)) return choiceError("category", category);
  if (!category) return { ok: false, error: "category_not_found" };
  return await draft(ctx, "category_delete", { category_id: category.id, before: category }, `Arquivar categoria “${category.name}”. Os lançamentos históricos serão preservados.`);
}

async function splitReceive(ctx: ToolContext, args: any): Promise<ToolResult> {
  const participantHint = String(args.participant ?? args.person ?? args.name ?? "").trim();
  if (!participantHint) return { ok: false, error: "split_participant_required" };
  let q = ctx.sb.from("split_receivables_v1")
    .select("participant_id,participant_name,shared_expense_id,title,balance_due,state,due_date")
    .eq("owner_user_id", ctx.user_id).gt("balance_due", 0);
  if (args.split || args.split_id) {
    const split = await resolveSplit(ctx, args.split ?? args.split_id);
    if (Array.isArray(split)) return choiceError("split", split);
    if (!split) return { ok: false, error: "split_not_found" };
    q = q.eq("shared_expense_id", split.id);
  }
  const { data, error } = await q.order("due_date", { ascending: true }).limit(100);
  if (error) return { ok: false, error: error.message };
  const matching = bestByName(data ?? [], participantHint, ["participant_name"]);
  const participantIds = [...new Set(matching.map((r: any) => r.participant_id))];
  if (!participantIds.length) return { ok: false, error: "split_participant_not_found" };
  if (participantIds.length > 1) return choiceError("split_participant", matching);
  const rows = matching.filter((r: any) => r.participant_id === participantIds[0]);
  const balance = rows.reduce((s: number, r: any) => s + Number(r.balance_due || 0), 0);
  let amount = numberValue(args.amount);
  if (amount == null) amount = balance;
  if (amount <= 0 || amount > balance + 0.00001) return { ok: false, error: "split_payment_invalid_amount" };
  const participant = rows[0];
  return await draft(ctx, "split_receive", {
    participant_id: participant.participant_id,
    shared_expense_id: participant.shared_expense_id,
    participant_name: participant.participant_name,
    title: participant.title,
    amount,
    paid_at: dateValue(args.paid_at ?? args.date) ?? localDate(),
    balance_before: balance,
  }, `Marcar ${BRL.format(amount)} de ${participant.participant_name} como recebido em “${participant.title}”.`);
}

async function splitUpdate(ctx: ToolContext, args: any): Promise<ToolResult> {
  const split = await resolveSplit(ctx, args.split ?? args.split_id ?? args.title);
  if (Array.isArray(split)) return choiceError("split", split);
  if (!split) return { ok: false, error: "split_not_found" };
  const patch: any = {};
  if (args.new_title != null) patch.title = String(args.new_title).trim();
  if (args.due_date != null) patch.due_date = dateValue(args.due_date);
  if (args.reminder_enabled != null) patch.reminder_enabled = boolValue(args.reminder_enabled);
  if (args.pix_key != null) patch.pix_key = String(args.pix_key);
  // Participant/amount changes affect installment truth and therefore require a
  // dedicated complete participant payload; never degrade them into metadata edits.
  if (args.participants != null || args.total != null || args.total_amount != null) {
    return { ok: false, error: "split_financial_update_requires_full_schedule" };
  }
  if (!Object.keys(patch).length) return { ok: false, error: "split_update_empty_patch" };
  return await draft(ctx, "split_update", { split_id: split.id, patch, before: split }, `Atualizar “${split.title}”.`);
}

async function splitDelete(ctx: ToolContext, args: any): Promise<ToolResult> {
  const split = await resolveSplit(ctx, args.split ?? args.split_id ?? args.title);
  if (Array.isArray(split)) return choiceError("split", split);
  if (!split) return { ok: false, error: "split_not_found" };
  return await draft(ctx, "split_delete", { split_id: split.id, before: split }, `Cancelar e excluir a divisão “${split.title}”.`);
}

async function recurringCreate(ctx: ToolContext, args: any): Promise<ToolResult> {
  const name = String(args.name ?? args.merchant ?? "").trim();
  const amount = numberValue(args.amount);
  const day = intValue(args.day_of_month ?? args.day);
  if (!name || amount == null || amount <= 0) return { ok: false, error: "recurring_name_amount_required" };
  if (!day || day < 1 || day > 31) return { ok: false, error: "recurring_day_invalid" };
  const account = await resolveAccount(ctx, args.account ?? args.account_id);
  if (Array.isArray(account)) return choiceError("account", account);
  if (!account) return { ok: false, error: "recurring_account_required" };
  let category: any = null;
  if (args.category != null || args.category_id != null) {
    category = await resolveCategory(ctx, args.category ?? args.category_id);
    if (Array.isArray(category)) return choiceError("category", category);
    if (!category) return { ok: false, error: "category_not_found" };
  }
  const kind = String(args.type ?? args.kind ?? "expense").toLowerCase() === "income" ? "income" : "expense";
  const frequency = String(args.frequency ?? "monthly").toLowerCase();
  if (!["daily", "weekly", "monthly", "yearly"].includes(frequency)) return { ok: false, error: "recurring_frequency_invalid" };
  return await draft(ctx, "recurring_create", {
    name, amount, account_id: account.id, category_id: category?.id ?? null, kind,
    frequency, day_of_month: day,
    start_date: dateValue(args.start_date) ?? localDate(),
    end_date: dateValue(args.end_date),
  }, `Criar recorrência “${name}” de ${BRL.format(amount)} todo dia ${day}.`);
}

async function recurringUpdate(ctx: ToolContext, args: any): Promise<ToolResult> {
  const rule = await resolveRecurring(ctx, args.recurring ?? args.recurring_id ?? args.name);
  if (Array.isArray(rule)) return choiceError("recurring", rule);
  if (!rule) return { ok: false, error: "recurring_not_found" };
  const patch: any = {};
  if (args.new_name != null) patch.name = String(args.new_name).trim();
  const amount = numberValue(args.amount ?? args.new_amount);
  if (amount != null) {
    if (amount <= 0) return { ok: false, error: "recurring_amount_invalid" };
    patch.amount = amount;
  }
  const day = intValue(args.day_of_month ?? args.day);
  if (day != null) {
    if (day < 1 || day > 31) return { ok: false, error: "recurring_day_invalid" };
    patch.day_of_month = day;
  }
  if (args.frequency != null) {
    const frequency = String(args.frequency).toLowerCase();
    if (!["daily", "weekly", "monthly", "yearly"].includes(frequency)) return { ok: false, error: "recurring_frequency_invalid" };
    patch.frequency = frequency;
  }
  if (args.category != null || args.category_id != null) {
    const category = await resolveCategory(ctx, args.category ?? args.category_id);
    if (Array.isArray(category)) return choiceError("category", category);
    if (!category) return { ok: false, error: "category_not_found" };
    patch.category_id = category.id;
  }
  if (args.account != null || args.account_id != null) {
    const account = await resolveAccount(ctx, args.account ?? args.account_id);
    if (Array.isArray(account)) return choiceError("account", account);
    if (!account) return { ok: false, error: "account_not_found" };
    patch.account_id = account.id;
  }
  if (args.status != null) patch.status = String(args.status);
  if (args.end_date != null) patch.end_date = dateValue(args.end_date);
  if (!Object.keys(patch).length) return { ok: false, error: "recurring_update_empty_patch" };
  return await draft(ctx, "recurring_update", { recurring_id: rule.id, patch, before: rule }, `Atualizar recorrência “${rule.name}”.`);
}

async function recurringDelete(ctx: ToolContext, args: any): Promise<ToolResult> {
  const rule = await resolveRecurring(ctx, args.recurring ?? args.recurring_id ?? args.name);
  if (Array.isArray(rule)) return choiceError("recurring", rule);
  if (!rule) return { ok: false, error: "recurring_not_found" };
  return await draft(ctx, "recurring_delete", { recurring_id: rule.id, before: rule }, `Encerrar recorrência “${rule.name}”.`);
}

const EXECUTORS: Record<string, (ctx: ToolContext, args: any) => Promise<ToolResult>> = {
  lifecycle_transaction_update_draft: transactionUpdate,
  lifecycle_transaction_delete_draft: transactionDelete,
  lifecycle_goal_update_draft: goalUpdate,
  lifecycle_goal_delete_draft: goalDelete,
  lifecycle_debt_payment_draft: debtPayment,
  lifecycle_category_create_draft: categoryCreate,
  lifecycle_category_update_draft: categoryUpdate,
  lifecycle_category_delete_draft: categoryDelete,
  lifecycle_split_receive_draft: splitReceive,
  lifecycle_split_update_draft: splitUpdate,
  lifecycle_split_delete_draft: splitDelete,
  lifecycle_recurring_create_draft: recurringCreate,
  lifecycle_recurring_update_draft: recurringUpdate,
  lifecycle_recurring_delete_draft: recurringDelete,
};

export function lifecycleToolByName(name: string): { execute: (ctx: ToolContext, args: any) => Promise<ToolResult> } | null {
  const execute = EXECUTORS[name];
  return execute ? { execute } : null;
}