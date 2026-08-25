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
  if (kind === "credit_card_payment") return `Pagamento de fatura registrado: ${NUM_BR.format(Number(result?.amount ?? 0))}. ✅`;
  if (kind === "emotional_checkin") return "Registro emocional salvo. ✅";
  if (kind === "bulk_transactions") {
    const n = Number(result?.count ?? (Array.isArray(result?.ids) ? result.ids.length : 0));
    return n > 0 ? `${n} lançamentos registrados. ✅` : "Lançamentos registrados. ✅";
  }
  if (kind === "transaction_update") return "Lançamento corrigido, com histórico preservado. ✅";
  if (kind === "transaction_delete") return "Lançamento cancelado, com auditoria preservada. ✅";
  if (kind === "investment") return `Investimento registrado: ${result?.name ?? ""}. ✅`;
  if (kind === "investment_movement") {
    const kindMov = String(result?.movement_kind ?? result?.kind ?? "");
    const label = kindMov === "withdrawal" || kindMov === "resgate" ? "Resgate" : "Movimento de investimento";
    return `${label} registrado: ${NUM_BR.format(Number(result?.amount ?? 0))}. ✅`;
  }
  if (kind === "recurring_rule") return `Recorrência registrada: ${result?.description ?? result?.name ?? ""}. ✅`;
  if (kind === "debt_payment") return `Pagamento de dívida registrado: ${NUM_BR.format(Number(result?.amount ?? 0))}. ✅`;
  // Nenhum kind cai em frase genérica: valor sempre aparece quando existe.
  const amount = Number(result?.amount ?? NaN);
  return Number.isFinite(amount) && amount > 0
    ? `Operação registrada: ${NUM_BR.format(amount)}. ✅`
    : "Operação registrada no seu histórico. ✅";
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

function todayISO(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Recibo estruturado + texto final. `context` traz nomes já resolvidos
 * (conta, cartão, categoria) — o builder nunca vai ao banco.
 *
 * `nino_comm.v1`: lançamento simples fecha em UMA linha ("Anotado: R$ 5,40 na
 * Autopass, hoje. ✅"). Linhas extras só aparecem quando existe ambiguidade
 * real — cartão, parcelamento, competência diferente de hoje ou vencimento
 * distinto. Valores de recibo são SEMPRE exatos, nunca compactados.
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
  now = new Date(),
): ActionReceipt {
  const description = String(result?.friendly_description ?? result?.description ?? "").trim();
  const isEntry = kind === "transaction" || kind === "transfer";
  const amount = Number(result?.amount ?? NaN);

  const competenceISO = String(context.competence_date ?? result?.competence_date ?? result?.occurred_at ?? "").slice(0, 10);
  const competence = dateBR(competenceISO);
  const isToday = competenceISO === todayISO(now);

  const headline = isEntry && description && Number.isFinite(amount) && amount > 0
    ? `Anotado: ${NUM_BR.format(amount)} em ${description}${isToday ? ", hoje" : competence ? `, ${competence}` : ""}. ✅`
    : buildReceipt(kind, result);
  const lines: string[] = [headline];

  if (!isEntry && description) lines.push(`Descrição: ${description}`);

  const card = String(context.card_name ?? result?.card_name ?? "").trim();
  const account = String(context.account_name ?? result?.account_name ?? "").trim();
  const installments = Number(result?.installments ?? 0);
  const parcelado = Number.isFinite(installments) && installments > 1;

  // Cartão muda a competência do gasto: é ambiguidade real, sempre explicitada.
  if (card) {
    const suffix = parcelado ? ` · ${installments}x` : "";
    lines.push(`Cartão: ${card}${suffix}${competence ? ` · competência ${competence}` : ""}`);
  } else if (parcelado) {
    lines.push(`Parcelas: ${installments}x`);
  } else if (account && !isEntry) {
    lines.push(`Conta: ${account}`);
  }

  const due = dateBR(context.due_date ?? result?.due_date);
  if (due && due !== competence) lines.push(`Vencimento: ${due}`);

  if (!card && !parcelado && !isToday && competence && !isEntry) lines.push(`Competência: ${competence}`);

  // Não explicamos "como corrigir" em lançamento simples: a pessoa já sabe.
  if (!isEntry || lines.length > 1) lines.push(howToFix(kind));
  return { kind, lines, text: lines.join("\n") };
}
