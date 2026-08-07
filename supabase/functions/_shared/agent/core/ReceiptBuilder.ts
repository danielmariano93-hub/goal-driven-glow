// Single source of truth for post-confirmation receipt strings.
// Extracted from orchestrator.ts (subetapa 12.2). Behavior unchanged; both
// channels will converge on these texts when they migrate to AgentCore.
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
