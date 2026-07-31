import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { brl, currentMonth, errorResult, monthRange, ok, requireUser } from "../shared";

export default defineTool({
  name: "monthly_summary",
  title: "Resumo do mês",
  description:
    "Resume o mês do usuário autenticado: total de receitas, total de despesas, saldo do período e as maiores categorias de gasto.",
  inputSchema: {
    month: z.string().optional().describe("Mês no formato YYYY-MM. Padrão: mês atual."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ month }, ctx) => {
    if (!requireUser(ctx)) return errorResult("Não autenticado.");
    const supabase = supabaseForUser(ctx);
    const target = month && /^\d{4}-\d{2}$/.test(month) ? month : currentMonth();
    const { from, to } = monthRange(target);

    const [txRes, catRes] = await Promise.all([
      supabase
        .from("transactions")
        .select("amount, type, category_id")
        .gte("occurred_at", from)
        .lte("occurred_at", to)
        .eq("status", "confirmed"),
      supabase.from("categories").select("id, name"),
    ]);

    if (txRes.error) return errorResult(txRes.error.message);
    const catNames = new Map((catRes.data ?? []).map((c) => [c.id as string, c.name as string]));

    let income = 0;
    let expense = 0;
    const byCategory = new Map<string, number>();

    for (const t of txRes.data ?? []) {
      const value = Math.abs(Number(t.amount));
      if (t.type === "income") income += value;
      else if (t.type === "expense") {
        expense += value;
        const label = catNames.get(t.category_id as string) ?? "Sem categoria";
        byCategory.set(label, (byCategory.get(label) ?? 0) + value);
      }
    }

    const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const lines = [
      `Resumo de ${target}`,
      `Receitas: ${brl(income)}`,
      `Despesas: ${brl(expense)}`,
      `Saldo do período: ${brl(income - expense)}`,
      top.length ? "\nMaiores gastos por categoria:" : "\nNenhuma despesa registrada no período.",
      ...top.map(([name, value]) => `- ${name}: ${brl(value)}`),
    ];

    return ok(lines.join("\n"), {
      month: target,
      income,
      expense,
      balance: income - expense,
      top_categories: top.map(([name, value]) => ({ name, total: value })),
    });
  },
});
