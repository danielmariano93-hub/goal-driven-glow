import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { brl, errorResult, ok, requireUser } from "../shared";

export default defineTool({
  name: "list_card_statements",
  title: "Listar faturas de cartão",
  description: "Lista faturas conciliadas do usuário, com cartão, vencimento, total, valor pago, saldo e status.",
  inputSchema: {
    status: z.enum(["open", "partially_paid", "paid", "overdue", "needs_review"]).optional(),
    limit: z.number().min(1).max(100).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, limit }, ctx) => {
    if (!requireUser(ctx)) return errorResult("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    let query = supabase.from("credit_card_statements")
      .select("id,credit_card_id,competence_month,due_date,stated_total,paid_amount,outstanding_amount,reconciliation_difference,status,credit_cards(name,last_four)")
      .order("competence_month", { ascending: false }).limit(limit ?? 24);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return errorResult(error.message);
    const statements = (data ?? []).map((row: any) => ({
      id: row.id, card: row.credit_cards?.name ?? "Cartão", last_four: row.credit_cards?.last_four ?? null,
      competence_month: row.competence_month, due_date: row.due_date,
      total: Number(row.stated_total), paid: Number(row.paid_amount), outstanding: Number(row.outstanding_amount),
      status: row.status, reconciled: Math.abs(Number(row.reconciliation_difference)) <= 0.05,
    }));
    return ok(statements.length ? statements.map((s) =>
      `${s.card} · ${String(s.competence_month).slice(0, 7)} · ${brl(s.total)} · ${s.status} · falta ${brl(s.outstanding)}`
    ).join("\n") : "Nenhuma fatura encontrada.", { statements });
  },
});
