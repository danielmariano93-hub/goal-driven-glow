/**
 * Política única de formatação numérica por contexto (`nino_comm.v1`).
 *
 * ESTE ARQUIVO É ESPELHADO em supabase/functions/_shared/copy/numbers.ts
 * (gerado por scripts/sync-finance-core.mjs — não editar o espelho à mão).
 *
 * Regra de produto:
 *  - Superfície de LEITURA (headline, resumo, card, alerta) pode compactar:
 *    "R$ 4,2 mil", "60%".
 *  - Superfície de PROVA (recibo, confirmação, extrato, fatura, parcela,
 *    saldo, detalhe contábil) é SEMPRE exata: "R$ 4.229,83", "60,47%".
 * Nenhum número novo é criado aqui — só apresentação.
 */

const BRL_EXACT = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Contextos onde compactar é proibido. */
export const EXACT_CONTEXTS = [
  "receipt",
  "confirmation",
  "statement",
  "invoice",
  "installment",
  "balance",
  "detail",
] as const;

/** Contextos onde compactar é permitido. */
export const COMPACT_CONTEXTS = ["headline", "summary", "card", "alert", "chat"] as const;

export type NumberContext = (typeof EXACT_CONTEXTS)[number] | (typeof COMPACT_CONTEXTS)[number];

export function allowsCompact(context: NumberContext): boolean {
  return (COMPACT_CONTEXTS as readonly string[]).includes(context);
}

/** Valor exato em Reais: R$ 4.229,83 */
export function exactBRL(value: number | null | undefined): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return BRL_EXACT.format(n);
}

/**
 * Valor compacto para leitura: R$ 4,2 mil / R$ 1,3 milhão / R$ 137.
 * Abaixo de mil não compacta (perderia precisão útil sem ganhar clareza).
 */
export function compactBRL(value: number | null | undefined): string {
  const raw = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const sign = raw < 0 ? "-" : "";
  const n = Math.abs(raw);
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    const unit = m >= 2 ? "milhões" : "milhão";
    return `${sign}R$ ${m.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} ${unit}`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return `${sign}R$ ${k.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  }
  return `${sign}R$ ${Math.round(n).toLocaleString("pt-BR")}`;
}

/** Escolhe compacto ou exato conforme o contexto. */
export function money(value: number | null | undefined, context: NumberContext): string {
  return allowsCompact(context) ? compactBRL(value) : exactBRL(value);
}

/**
 * Percentual conforme o contexto: leitura arredonda (60%), prova mantém
 * uma casa quando ela existe de fato (60,5%). Nunca 2 casas em headline.
 */
export function pct(value: number | null | undefined, context: NumberContext = "headline"): string {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (allowsCompact(context)) return `${Math.round(n).toLocaleString("pt-BR")}%`;
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
