// Single source of truth for post-confirmation receipt strings.
// Extracted from orchestrator.ts (subetapa 12.2). Behavior unchanged; both
// channels will converge on these texts when they migrate to AgentCore.
//
// `buildActionReceipt` (nino_agent.v1) é o recibo canônico de QUALQUER escrita:
// o que foi feito, valor, competência, conta/cartão e como corrigir. Nunca é
// emitido sem prova de persistência (ver PersistenceProof).
// deno-lint-ignore-file no-explicit-any

const NUM_BR = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export type ReceiptKind =
  | "transaction" | "transfer" | "goal" | "goal_contribution" | "debt" | string;

export function buildReceipt(kind: ReceiptKind, result: any): string {
  if (kind === "transaction") {
    const t = result?.type === "income" ? "Receita" : "Despesa";
    return `${t} registrada: ${NUM_BR.format(Number(result?.amount ?? 0))}. ✅`;
  }
  if (kind === "transfer") return `Transferência registrada: ${NUM_BR.format(Number(result?.amount ?? 0))}. ✅`;
  if (kind === "goal") return `Meta criada: ${result?.name}. ✅`;
  if (kind === "goal_contribution") return `Aporte registrado: ${NUM_BR.format(Number(result?.amount ?? 0))}. ✅`;
  if (kind === "shared_goal_create") return `Meta conjunta criada: ${result?.title ?? ""}. ✅`;
  if (kind === "shared_goal_contribution") return `Contribuição registrada em meta conjunta: ${NUM_BR.format(Number(result?.amount ?? 0))}. ✅`;
  if (kind === "shared_expense") return `Rolê criado: ${result?.title ?? ""}, total de ${NUM_BR.format(Number(result?.total ?? 0))}. ✅`;
  if (kind === "debt") return `Dívida registrada: ${result?.name}. ✅`;
  return "Pronto, registrei. ✅";

}

function dateBR(iso: unknown): string | null {
  const s = String(iso ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

/** Como o usuário desfaz/corrige. Nunca fala de exclusão: o ledger é auditável. */
function howToFix(kind: string): string {
  if (kind === "transaction" || kind === "transfer" || kind === "bulk_transactions") {
    return "Se algo estiver errado, me diga o que mudar que eu corrijo mantendo o histórico.";
  }
  if (kind === "credit_card_payment") return "Se o valor não for esse, me avise que eu ajusto a baixa da fatura.";
  if (kind === "goal_contribution") return "Se o aporte foi outro valor, me diga que eu corrijo.";
  return "Se precisar ajustar, me diga o que mudar.";
}

export type ActionReceipt = {
  kind: string;
  lines: string[];
  text: string;
};

/**
 * Recibo estruturado + texto final. `context` traz nomes já resolvidos
 * (conta, cartão, categoria) — o builder nunca vai ao banco.
 */
export function buildActionReceipt(
  kind: string,
  result: any,
  context: {
    account_name?: string | null;
    card_name?: string | null;
    category_name?: string | null;
    competence_date?: string | null;
    due_date?: string | null;
  } = {},
): ActionReceipt {
  const headline = buildReceipt(kind, result);
  const lines: string[] = [headline];

  const description = String(result?.friendly_description ?? result?.description ?? "").trim();
  if (description) lines.push(`Descrição: ${description}`);

  const category = String(context.category_name ?? result?.category?.name ?? "").trim();
  if (category) lines.push(`Categoria: ${category}`);

  const card = String(context.card_name ?? result?.card_name ?? "").trim();
  const account = String(context.account_name ?? result?.account_name ?? "").trim();
  if (card) lines.push(`Cartão: ${card}`);
  else if (account) lines.push(`Conta: ${account}`);

  // Competência é a data que define o mês do lançamento (fechamento, no cartão).
  const competence = dateBR(context.competence_date ?? result?.competence_date ?? result?.occurred_at);
  if (competence) lines.push(`Competência: ${competence}`);
  const due = dateBR(context.due_date ?? result?.due_date);
  if (due && due !== competence) lines.push(`Vencimento: ${due}`);

  const installments = Number(result?.installments ?? 0);
  if (Number.isFinite(installments) && installments > 1) lines.push(`Parcelas: ${installments}x`);

  lines.push(howToFix(kind));
  return { kind, lines, text: lines.join("\n") };
}
