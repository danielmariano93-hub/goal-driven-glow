import { defineTool, ToolError } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase";
import { brl, errorResult, ok, requireUser } from "../shared";

export default defineTool({
  name: "settle_card_statement",
  title: "Registrar pagamento de fatura",
  description: "Registra a baixa contábil de uma fatura após confirmação explícita do usuário. Reduz caixa e obrigação; não cria uma nova despesa de consumo.",
  inputSchema: {
    statement_id: z.string().uuid().describe("Identificador retornado por list_card_statements."),
    account_id: z.string().uuid().describe("Conta usada no pagamento."),
    amount: z.number().positive().optional().describe("Valor pago. Se omitido, quita o saldo em aberto."),
    paid_at: z.string().optional().describe("Data YYYY-MM-DD."),
    confirmed_by_user: z.literal(true).describe("Só use true após o usuário confirmar claramente valor, conta e data."),
    idempotency_key: z.string().min(8).describe("Chave única e estável para impedir pagamento duplicado em retries."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ statement_id, account_id, amount, paid_at, confirmed_by_user, idempotency_key }, ctx) => {
    if (!requireUser(ctx)) return errorResult("Não autenticado.");
    if (confirmed_by_user !== true) throw new ToolError("Confirmação explícita obrigatória.");
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.rpc("settle_credit_card_statement", {
      p_statement_id: statement_id, p_account_id: account_id, p_amount: amount ?? null,
      p_paid_at: paid_at ?? new Date().toISOString().slice(0, 10), p_idempotency_key: idempotency_key,
    });
    if (error) return errorResult(error.message);
    const result = data as Record<string, any>;
    return ok(`Pagamento registrado: ${brl(Number(result.amount ?? amount ?? 0))}. Fatura ${result.status === "paid" ? "quitada" : "parcialmente paga"}.`, { payment: result });
  },
});
