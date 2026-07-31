import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "../supabase";
import { brl, errorResult, ok, requireUser } from "../shared";

export default defineTool({
  name: "financial_position",
  title: "Posição financeira",
  description:
    "Mostra a posição atual do usuário autenticado: cartões de crédito ativos, dívidas em aberto e metas em andamento.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!requireUser(ctx)) return errorResult("Não autenticado.");
    const supabase = supabaseForUser(ctx);

    const [cardsRes, debtsRes, goalsRes] = await Promise.all([
      supabase.from("credit_cards").select("id, name, brand, last_four, total_limit, due_day").eq("active", true),
      supabase.from("debts").select("id, name, creditor, outstanding_balance, installment_amount, status"),
      supabase.from("goals").select("id, name, target_amount, target_date, status"),
    ]);
    if (cardsRes.error) return errorResult(cardsRes.error.message);

    const cards = (cardsRes.data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      brand: c.brand,
      last_four: c.last_four,
      limit: Number(c.total_limit ?? 0),
      due_day: c.due_day,
    }));
    const debts = (debtsRes.data ?? []).filter((d) => d.status !== "settled");
    const goals = (goalsRes.data ?? []).filter((g) => g.status === "active");

    const lines = [
      cards.length ? "Cartões ativos:" : "Nenhum cartão ativo.",
      ...cards.map((c) => `- ${c.name} ${c.last_four ? `••${c.last_four}` : ""} · limite ${brl(c.limit)} · vence dia ${c.due_day ?? "-"}`),
      "",
      debts.length ? "Dívidas em aberto:" : "Nenhuma dívida em aberto.",
      ...debts.map((d) => `- ${d.name}${d.creditor ? ` (${d.creditor})` : ""} · saldo ${brl(Number(d.outstanding_balance ?? 0))}`),
      "",
      goals.length ? "Metas ativas:" : "Nenhuma meta ativa.",
      ...goals.map((g) => `- ${g.name} · objetivo ${brl(Number(g.target_amount ?? 0))}${g.target_date ? ` até ${g.target_date}` : ""}`),
    ];

    return ok(lines.join("\n"), {
      cards,
      debts: debts.map((d) => ({ id: d.id, name: d.name, outstanding_balance: Number(d.outstanding_balance ?? 0) })),
      goals: goals.map((g) => ({ id: g.id, name: g.name, target_amount: Number(g.target_amount ?? 0), target_date: g.target_date })),
    });
  },
});
