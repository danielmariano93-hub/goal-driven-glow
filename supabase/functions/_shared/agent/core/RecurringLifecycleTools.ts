// RecurringLifecycleTools — frequency-aware recurring rule drafts.
// Keeps WhatsApp semantics aligned with the app's canonical recurring schedule.
// deno-lint-ignore-file no-explicit-any

import type { ToolContext, ToolResult } from "../tools.ts";
import { localDate } from "../../finance-core/ninoClock.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Frequency = "daily" | "weekly" | "monthly" | "yearly";

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

function dateValue(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (/^20\d{2}-\d{2}-\d{2}$/.test(raw)) return raw;
  const br = raw.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  return br ? `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}` : null;
}

function frequencyValue(value: unknown): Frequency {
  const v = norm(value);
  if (["daily", "diaria", "diario", "todo dia", "todos os dias"].includes(v)) return "daily";
  if (["weekly", "semanal", "toda semana", "todas as semanas"].includes(v)) return "weekly";
  if (["yearly", "annual", "anual", "todo ano", "todos os anos"].includes(v)) return "yearly";
  return "monthly";
}

function weekdayValue(value: unknown): number | null {
  const numeric = intValue(value);
  if (numeric != null && numeric >= 0 && numeric <= 6) return numeric;
  const v = norm(value);
  const days: Record<string, number> = {
    domingo: 0,
    segunda: 1, "segunda feira": 1,
    terca: 2, "terca feira": 2,
    quarta: 3, "quarta feira": 3,
    quinta: 4, "quinta feira": 4,
    sexta: 5, "sexta feira": 5,
    sabado: 6,
  };
  return days[v] ?? null;
}

function bestByName<T extends Record<string, any>>(rows: T[], hint: unknown, fields: string[]): T[] {
  const h = norm(hint);
  if (!h) return rows;
  const exact = rows.filter((row) => fields.some((f) => norm(row[f]) === h));
  if (exact.length) return exact;
  return rows.filter((row) => fields.some((f) => norm(row[f]).includes(h) || h.includes(norm(row[f]))));
}

function choiceError(kind: string, choices: any[]): ToolResult {
  return { ok: false, error: `${kind}_ambiguous`, result: { choices: choices.slice(0, 5) } };
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

async function resolveCategory(ctx: ToolContext, hint: unknown): Promise<any | null | any[]> {
  const raw = String(hint ?? "").trim();
  if (!raw) return null;
  let q = ctx.sb.from("categories").select("id,name,slug,type,user_id,archived_at")
    .or(`user_id.eq.${ctx.user_id},user_id.is.null`).is("archived_at", null);
  if (UUID.test(raw)) q = q.eq("id", raw);
  const { data, error } = await q.order("name").limit(80);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (UUID.test(raw)) return rows[0] ?? null;
  const matches = bestByName(rows, raw, ["name", "slug"]);
  return matches.length <= 1 ? (matches[0] ?? null) : matches;
}

async function resolveRule(ctx: ToolContext, hint: unknown): Promise<any | null | any[]> {
  const raw = String(hint ?? "").trim();
  let q = ctx.sb.from("recurring_rules")
    .select("id,name,kind,amount,account_id,category_id,frequency,day_of_month,weekday,start_date,end_date,status")
    .eq("user_id", ctx.user_id);
  if (UUID.test(raw)) q = q.eq("id", raw);
  const { data, error } = await q.order("updated_at", { ascending: false }).limit(40);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (UUID.test(raw)) return rows[0] ?? null;
  const matches = bestByName(rows, raw, ["name"]);
  return matches.length <= 1 ? (matches[0] ?? null) : matches;
}

function scheduleFor(args: any, current?: any): { frequency: Frequency; day_of_month: number | null; weekday: number | null; start_date: string } | { error: string } {
  const frequency = frequencyValue(args.frequency ?? current?.frequency ?? "monthly");
  const startDate = dateValue(args.start_date) ?? current?.start_date ?? localDate();
  if (frequency === "monthly") {
    const day = intValue(args.day_of_month ?? args.day ?? current?.day_of_month);
    if (day == null || day < 1 || day > 31) return { error: "recurring_monthly_day_required" };
    return { frequency, day_of_month: day, weekday: null, start_date: startDate };
  }
  if (frequency === "weekly") {
    const weekday = weekdayValue(args.weekday ?? args.day_of_week ?? current?.weekday);
    if (weekday == null) return { error: "recurring_weekday_required" };
    return { frequency, day_of_month: null, weekday, start_date: startDate };
  }
  if (frequency === "yearly") {
    if (!dateValue(args.start_date) && !current?.start_date) return { error: "recurring_yearly_start_date_required" };
    return { frequency, day_of_month: null, weekday: null, start_date: startDate };
  }
  return { frequency: "daily", day_of_month: null, weekday: null, start_date: startDate };
}

function scheduleLabel(schedule: { frequency: Frequency; day_of_month: number | null; weekday: number | null }): string {
  if (schedule.frequency === "daily") return "todos os dias";
  if (schedule.frequency === "weekly") {
    const names = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
    return `toda ${names[schedule.weekday ?? 0]}`;
  }
  if (schedule.frequency === "yearly") return "uma vez por ano";
  return `todo dia ${schedule.day_of_month}`;
}

async function createRecurring(ctx: ToolContext, args: any): Promise<ToolResult> {
  const name = String(args.name ?? args.merchant ?? "").trim();
  const amount = numberValue(args.amount);
  if (!name) return { ok: false, error: "recurring_name_required" };
  if (amount == null || amount <= 0) return { ok: false, error: "recurring_amount_required" };
  const schedule = scheduleFor(args);
  if ("error" in schedule) return { ok: false, error: schedule.error };

  const account = await resolveAccount(ctx, args.account ?? args.account_id);
  if (Array.isArray(account)) return choiceError("account", account);
  if (!account) return { ok: false, error: "recurring_account_required" };

  let category: any = null;
  if (args.category != null || args.category_id != null) {
    category = await resolveCategory(ctx, args.category ?? args.category_id);
    if (Array.isArray(category)) return choiceError("category", category);
    if (!category) return { ok: false, error: "category_not_found" };
  }

  const kind = norm(args.type ?? args.kind) === "income" || norm(args.type ?? args.kind) === "receita" ? "income" : "expense";
  const endDate = dateValue(args.end_date);
  if (endDate && endDate < schedule.start_date) return { ok: false, error: "recurring_end_before_start" };
  return await draft(ctx, "recurring_create", {
    name,
    amount,
    account_id: account.id,
    category_id: category?.id ?? null,
    kind,
    frequency: schedule.frequency,
    day_of_month: schedule.day_of_month,
    weekday: schedule.weekday,
    start_date: schedule.start_date,
    end_date: endDate,
  }, `Criar “${name}” de ${BRL.format(amount)} ${scheduleLabel(schedule)}.`);
}

async function updateRecurring(ctx: ToolContext, args: any): Promise<ToolResult> {
  const rule = await resolveRule(ctx, args.recurring ?? args.recurring_id ?? args.name);
  if (Array.isArray(rule)) return choiceError("recurring", rule);
  if (!rule) return { ok: false, error: "recurring_not_found" };

  const patch: any = {};
  if (args.new_name != null) {
    const name = String(args.new_name).trim();
    if (!name) return { ok: false, error: "recurring_name_required" };
    patch.name = name;
  }
  if (args.amount != null || args.new_amount != null) {
    const amount = numberValue(args.new_amount ?? args.amount);
    if (amount == null || amount <= 0) return { ok: false, error: "recurring_amount_invalid" };
    patch.amount = amount;
  }

  const scheduleTouched = ["frequency", "day_of_month", "day", "weekday", "day_of_week", "start_date"].some((key) => args[key] != null);
  if (scheduleTouched) {
    const schedule = scheduleFor(args, rule);
    if ("error" in schedule) return { ok: false, error: schedule.error };
    patch.frequency = schedule.frequency;
    patch.day_of_month = schedule.day_of_month;
    patch.weekday = schedule.weekday;
    patch.start_date = schedule.start_date;
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
  if (args.status != null) {
    const status = norm(args.status);
    const mapped = status === "pausada" || status === "paused" ? "paused"
      : status === "ativa" || status === "active" ? "active"
      : status === "encerrada" || status === "finished" ? "finished" : null;
    if (!mapped) return { ok: false, error: "recurring_status_invalid" };
    patch.status = mapped;
  }
  if (args.end_date != null) {
    const endDate = dateValue(args.end_date);
    if (!endDate) return { ok: false, error: "recurring_end_date_invalid" };
    const startDate = patch.start_date ?? rule.start_date;
    if (endDate < startDate) return { ok: false, error: "recurring_end_before_start" };
    patch.end_date = endDate;
  }
  if (!Object.keys(patch).length) return { ok: false, error: "recurring_update_empty_patch" };

  return await draft(ctx, "recurring_update", { recurring_id: rule.id, patch, before: rule }, `Atualizar a recorrência “${rule.name}”.`);
}

async function deleteRecurring(ctx: ToolContext, args: any): Promise<ToolResult> {
  const rule = await resolveRule(ctx, args.recurring ?? args.recurring_id ?? args.name);
  if (Array.isArray(rule)) return choiceError("recurring", rule);
  if (!rule) return { ok: false, error: "recurring_not_found" };
  return await draft(ctx, "recurring_delete", { recurring_id: rule.id, before: rule }, `Encerrar a recorrência “${rule.name}”.`);
}

const EXECUTORS: Partial<Record<string, (ctx: ToolContext, args: any) => Promise<ToolResult>>> = {
  lifecycle_recurring_create_draft: createRecurring,
  lifecycle_recurring_update_draft: updateRecurring,
  lifecycle_recurring_delete_draft: deleteRecurring,
};

export function recurringLifecycleToolByName(name: string): { execute: (ctx: ToolContext, args: any) => Promise<ToolResult> } | null {
  const execute = EXECUTORS[name];
  return execute ? { execute } : null;
}
