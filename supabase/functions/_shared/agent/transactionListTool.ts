// deno-lint-ignore-file no-explicit-any
// "Liste meus gastos de outubro": os LANÇAMENTOS do período (não um ranking de categorias).
// Mesma regra dos relatórios: competência (cartão = mês da fatura) e só movimento real
// (sem transferência, pagamento de fatura nem patrimônio).
import { isRealMonthlyMovement, reportingCompetenceDate } from "../finance-core/facts.ts";
import { today as localToday } from "../finance-core/ninoClock.ts";
import { loadTransactionsForCompetenceWindow } from "./core/handlers/TransactionWindowLoader.ts";
import type { ToolContext, ToolResult } from "./tools.ts";

const SELECT = "id,account_id,category_id,type,status,amount,occurred_at,description,transfer_group_id,payment_method,credit_card_id,"
  + "settles_card_id,movement_kind,competence_date,economic_competence_date,friendly_description";
const SHOWN = 20;
const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export async function list_period_transactions(ctx: ToolContext, args?: { from?: string; to?: string; category?: string; merchant?: string; kind?: "expense" | "income" }): Promise<ToolResult> {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const today = localToday();
  const to = iso.test(String(args?.to ?? "")) ? String(args!.to) : today;
  const from = iso.test(String(args?.from ?? "")) ? String(args!.from) : `${to.slice(0, 7)}-01`;
  const kind = args?.kind === "income" ? "income" : "expense";

  const raw = await loadTransactionsForCompetenceWindow(ctx.sb, ctx.user_id, from, to, SELECT);
  const cats = await ctx.sb.from("categories").select("id,name").or(`user_id.eq.${ctx.user_id},user_id.is.null`);
  if (cats.error) return { ok: false, error: `categories_query_failed:${cats.error.message}` };
  const catName = new Map(((cats.data ?? []) as any[]).map((c) => [String(c.id), String(c.name)]));

  let categoryFilter: { requested: string; applied: boolean } | null = null;
  let rows = raw
    .map((t: any) => ({ ...t, amount: Number(t.amount), day: String(reportingCompetenceDate(t)).slice(0, 10) }))
    .filter((t: any) => t.type === kind && isRealMonthlyMovement(t) && t.day >= from && t.day <= to);
  const wantedCategory = norm(args?.category);
  if (wantedCategory) {
    const ids = new Set([...catName].filter(([, n]) => norm(n) === wantedCategory).map(([id]) => id));
    categoryFilter = { requested: String(args?.category), applied: ids.size > 0 };
    rows = rows.filter((t: any) => ids.has(String(t.category_id)));
  }
  const wantedMerchant = norm(args?.merchant);
  if (wantedMerchant) rows = rows.filter((t: any) => norm(t.friendly_description ?? t.description).includes(wantedMerchant));

  rows.sort((a: any, b: any) => b.day.localeCompare(a.day) || b.amount - a.amount);
  const total = round2(rows.reduce((s: number, t: any) => s + t.amount, 0));
  return {
    ok: true,
    result: {
      engine: "list_period_transactions",
      kind, from, to,
      total, count: rows.length, shown: Math.min(SHOWN, rows.length), truncated: rows.length > SHOWN,
      category_filter: categoryFilter,
      merchant_filter: wantedMerchant ? { requested: String(args?.merchant), applied: true } : null,
      items: rows.slice(0, SHOWN).map((t: any) => ({
        date: t.day, amount: round2(t.amount),
        description: String(t.friendly_description ?? t.description ?? "Sem descrição"),
        category: catName.get(String(t.category_id)) ?? null,
        card: t.payment_method === "credit_card",
      })),
    },
  };
}
