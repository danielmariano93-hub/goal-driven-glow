import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { brl, errorResult, ok, requireUser } from "../shared";

export default defineTool({
  name: "list_transactions",
  title: "Listar lançamentos",
  description:
    "Lista os lançamentos financeiros (receitas e despesas) do usuário autenticado, do mais recente para o mais antigo, com filtros opcionais de período e tipo.",
  inputSchema: {
    from: z.string().optional().describe("Data inicial em YYYY-MM-DD."),
    to: z.string().optional().describe("Data final em YYYY-MM-DD."),
    type: z.enum(["income", "expense", "transfer"]).optional().describe("Tipo do lançamento."),
    search: z.string().optional().describe("Texto para buscar na descrição."),
    limit: z.number().optional().describe("Quantidade máxima de lançamentos (padrão 50, máximo 200)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to, type, search, limit }, ctx) => {
    if (!requireUser(ctx)) return errorResult("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    const max = Math.min(Math.max(Number(limit ?? 50), 1), 200);

    let query = supabase
      .from("transactions")
      .select("id, occurred_at, description, friendly_description, amount, type, status, category_id, account_id")
      .order("occurred_at", { ascending: false })
      .limit(max);

    if (from) query = query.gte("occurred_at", from);
    if (to) query = query.lte("occurred_at", to);
    if (type) query = query.eq("type", type);
    if (search) query = query.ilike("description", `%${search}%`);

    const { data, error } = await query;
    if (error) return errorResult(error.message);

    const rows = (data ?? []).map((t) => ({
      id: t.id,
      date: t.occurred_at,
      description: t.friendly_description || t.description || "(sem descrição)",
      amount: Number(t.amount),
      type: t.type,
      status: t.status,
    }));

    if (rows.length === 0) return ok("Nenhum lançamento encontrado para esse filtro.", { transactions: [] });

    const text = rows
      .map((r) => `${r.date} · ${r.type === "income" ? "+" : "-"}${brl(Math.abs(r.amount))} · ${r.description}`)
      .join("\n");
    return ok(text, { transactions: rows });
  },
});
