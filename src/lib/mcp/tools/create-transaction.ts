import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { brl, errorResult, ok, requireUser } from "../shared";

export default defineTool({
  name: "create_transaction",
  title: "Registrar lançamento",
  description:
    "Registra uma despesa ou receita confirmada na conta do usuário autenticado. Informe conta por nome ou identificador. Só envie category quando o usuário tiver indicado explicitamente uma categoria; esse valor será tratado como hint e revalidado pelo Category Truth V2.",
  inputSchema: {
    amount: z.number().describe("Valor positivo do lançamento."),
    description: z.string().describe("Descrição do lançamento."),
    type: z.enum(["expense", "income"]).describe("Tipo do lançamento."),
    occurred_at: z.string().optional().describe("Data em YYYY-MM-DD. Padrão: hoje."),
    account: z.string().optional().describe("Nome ou identificador da conta."),
    category: z.string().optional().describe("Categoria explicitamente informada pelo usuário; será revalidada pelo motor central."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ amount, description, type, occurred_at, account, category }, ctx) => {
    const userId = requireUser(ctx);
    if (!userId) return errorResult("Não autenticado.");
    if (!(amount > 0)) throw new ToolError("O valor precisa ser maior que zero.");
    const date = occurred_at && /^\d{4}-\d{2}-\d{2}$/.test(occurred_at)
      ? occurred_at
      : new Date().toISOString().slice(0, 10);

    const supabase = supabaseForUser(ctx);

    const { data: accounts, error: accErr } = await supabase
      .from("accounts")
      .select("id, name")
      .eq("active", true);
    if (accErr) return errorResult(accErr.message);
    if (!accounts || accounts.length === 0) {
      return errorResult("Você ainda não tem contas cadastradas no Meu Nino. Crie uma conta no app antes de registrar lançamentos.");
    }

    const needle = (account ?? "").trim().toLowerCase();
    const chosen = needle
      ? accounts.find((a) => a.id === account) ??
        accounts.find((a) => String(a.name).toLowerCase() === needle) ??
        accounts.find((a) => String(a.name).toLowerCase().includes(needle))
      : accounts.length === 1
        ? accounts[0]
        : undefined;
    if (!chosen) {
      return errorResult(`Não identifiquei a conta. Opções: ${accounts.map((a) => a.name).join(", ")}.`);
    }

    let categoryId: string | null = null;
    if (category) {
      const { data: cats, error: catErr } = await supabase
        .from("categories")
        .select("id, name, type")
        .is("archived_at", null)
        .eq("type", type);
      if (catErr) return errorResult(catErr.message);
      const cn = category.trim().toLowerCase();
      const match = (cats ?? []).find((c) => c.id === category) ??
        (cats ?? []).find((c) => String(c.name).toLowerCase() === cn) ??
        (cats ?? []).find((c) => String(c.name).toLowerCase().includes(cn));
      if (!match) return errorResult(`A categoria “${category}” não é válida para ${type === "expense" ? "despesa" : "receita"}.`);
      categoryId = match.id as string;
    }

    const { data, error } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        account_id: chosen.id,
        category_id: categoryId,
        category_source: categoryId ? "document_hint" : null,
        category_confidence: categoryId ? 0.6 : null,
        category_reason: categoryId ? "categoria recebida pelo MCP; aguardando validação do motor central" : null,
        category_review_status: categoryId ? "needs_review" : undefined,
        type,
        status: "confirmed",
        amount,
        occurred_at: date,
        description: description.trim(),
        origin: "agent",
      })
      .select("id, occurred_at, amount, type, description, category_id, category_review_status")
      .single();

    if (error) return errorResult(error.message);

    return ok(
      `Lançamento registrado: ${type === "income" ? "receita" : "despesa"} de ${brl(amount)} em ${date} · ${description} (conta ${chosen.name}).${categoryId ? " A categoria será validada pelo Nino." : ""}`,
      { transaction: data },
    );
  },
});
