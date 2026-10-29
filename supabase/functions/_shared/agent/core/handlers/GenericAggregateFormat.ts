// Texto determinístico do executor genérico (`nino_generic_aggregate.v1`).
// Todo número sai do resultado do motor; o modelo nunca recalcula.
import type { SpendingAggregateResult } from "./GenericAggregateEngine.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const PCT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

const datePt = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

function scopeText(r: SpendingAggregateResult): string {
  const parts: string[] = [];
  if (r.scope_labels.category) parts.push(`em ${r.scope_labels.category}`);
  if (r.scope.merchant) parts.push(`em ${r.scope.merchant}`);
  // O nome do cartão já costuma começar com "Cartão" ("Cartão Itaú").
  if (r.scope_labels.card) parts.push(/^cart[aã]o\b/i.test(r.scope_labels.card) ? `no ${r.scope_labels.card}` : `no cartão ${r.scope_labels.card}`);
  if (r.scope_labels.account) parts.push(`na conta ${r.scope_labels.account}`);
  if (r.scope.payment_method) {
    parts.push(r.scope.payment_method === "credit_card" ? "no crédito" : r.scope.payment_method === "account" ? "em conta" : `via ${r.scope.payment_method}`);
  }
  return parts.join(", ");
}

/** Frase-resumo canônica: total, escopo e janela. */
export function spendingAggregateHeadline(r: SpendingAggregateResult): string {
  const verb = r.metric === "income" ? "recebeu" : "gastou";
  const scope = scopeText(r);
  const base = `Você ${verb} ${BRL.format(r.total)}${scope ? ` ${scope}` : ""} entre ${datePt(r.window.from)} e ${datePt(r.window.to)}`;
  return `${base}.`;
}

export function formatSpendingAggregate(r: SpendingAggregateResult): string {
  const scope = scopeText(r);
  if (r.transaction_count === 0) {
    return `Não encontrei ${r.metric === "income" ? "receitas" : "gastos"}${scope ? ` ${scope}` : ""} entre ${datePt(r.window.from)} e ${datePt(r.window.to)}.`;
  }
  const head = spendingAggregateHeadline(r);
  if (!r.groups.length || r.group_by.length === 0) {
    return `${head}\n\n${r.transaction_count} lançamento${r.transaction_count === 1 ? "" : "s"}.`;
  }
  const lines = [head, ""];
  for (const g of r.groups) {
    // Participação só faz sentido para parte positiva do todo; estorno/crédito
    // (total negativo) faria "108%" e "-8%".
    const pct = g.share != null && g.total > 0 && g.share <= 100 && r.total > 0 ? ` · ${PCT.format(g.share)}%` : "";
    const n = g.transaction_count > 1 ? ` · ${g.transaction_count} lançamentos` : "";
    lines.push(`• *${g.label}* — ${BRL.format(g.total)}${pct}${n}`);
  }
  if (r.omitted.groups > 0) {
    lines.push("", `Outros ${r.omitted.groups} grupo${r.omitted.groups === 1 ? "" : "s"} somam ${BRL.format(r.omitted.total)}.`);
  }
  return lines.join("\n");
}
