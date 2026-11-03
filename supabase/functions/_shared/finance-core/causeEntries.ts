// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Montador do livro de causas (`cause_entries.v1`, F2b): transforma o livro-razão CANÔNICO em `CauseEntry` por mês.
// Puro e determinístico; sem consulta nova (roda sobre o mesmo ledger que o `home-snapshot` já carrega).
//
// Fronteira do que é consumo/renda: as MESMAS regras dos totais mensais (`behavioralMetricAmount`):
// só confirmado, sem transferência, sem pagamento de fatura, sem aporte/resgate/rendimento, sem Pix de terceiros
// (recebimento de rolê é reembolso, não renda), estorno abate consumo. Mês = competência de relatório
// (cartão = mês da fatura; parcela antecipada = mês em que venceria no cronograma).
//
// Natureza (primeira regra que casa; nada é adivinhado):
//   1. `installment_anticipated`            → antecipacao   (timing, nunca comportamento)
//   2. cartão + parcelado (> 1 parcela)     → parcela_cartao
//   3. origem recorrente OU categoria de data fixa (moradia, assinaturas, energia, …) → fixa
//   4. sem categoria                        → desconhecida  (vira resíduo declarado, nunca causa)
//   5. valor ≥ R$ 1.000                     → pontual
//   6. o resto                              → variavel
// Estorno (abate consumo) entra como variavel negativo.
import { behavioralMetricAmount, reportingCompetenceDate, type TransactionRow } from "./facts.ts";
import { buildCauseMonth, computeCauseLedger, type CauseClass, type CauseEntry, type CauseLedger, type CauseMonth } from "./causeLedger.ts";

export const CAUSE_ENTRIES_VERSION = "cause_entries.v1";
/** Gasto único a partir deste valor (e fora das regras acima) é pontual, não hábito. */
export const CAUSE_PONTUAL_MIN = 1000;

const FIXED_CATEGORY_KEYS = new Set([
  "assinaturas", "moradia", "aluguel", "condominio", "contas", "energia", "agua", "internet", "telefone",
  "financiamento", "emprestimo", "dividas e emprestimos", "impostos e taxas", "tarifas", "seguros", "seguro",
  "educacao", "plano de saude", "dizimo",
]);

export const causeCategoryKey = (name: unknown): string =>
  String(name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export type CauseSourceTx = TransactionRow & { origin?: string | null };
export type CauseCategoryRef = { id: string; name: string };

export function classifyCauseExpense(t: CauseSourceTx, categoryName: string | null): CauseClass {
  if (t.installment_anticipated === true) return "antecipacao";
  const isCard = Boolean(t.credit_card_id) || String(t.payment_method ?? "") === "credit_card";
  if (isCard && Number(t.installments_total ?? 1) > 1) return "parcela_cartao";
  if (t.origin === "recurring" || FIXED_CATEGORY_KEYS.has(causeCategoryKey(categoryName))) return "fixa";
  if (!t.category_id) return "desconhecida";
  if (Number(t.amount) >= CAUSE_PONTUAL_MIN) return "pontual";
  return "variavel";
}

export interface CauseSourceEntry { month: string; entry: CauseEntry }

/** Uma entrada do livro de causas, ou null quando o lançamento não é renda nem consumo. */
export function toCauseEntry(t: CauseSourceTx, categoryName: string | null): CauseSourceEntry | null {
  const month = reportingCompetenceDate(t).slice(0, 7);
  const income = behavioralMetricAmount(t, "income");
  if (income > 0) return { month, entry: { kind: "income", amount: income, class: "desconhecida" } };
  const expense = behavioralMetricAmount(t, "expense");
  if (expense === 0) return null;
  // Estorno (valor negativo) abate gasto variável do mês; ele não diz de qual natureza era a compra original.
  const cls: CauseClass = expense < 0 ? "variavel" : classifyCauseExpense(t, categoryName);
  return { month, entry: { kind: "expense", amount: expense, class: cls } };
}

/** Todos os meses do ledger, já agregados por natureza. */
export function buildCauseMonths(txs: CauseSourceTx[], categories: CauseCategoryRef[]): CauseMonth[] {
  const nameOf = new Map(categories.map((c) => [c.id, c.name]));
  const byMonth = new Map<string, CauseEntry[]>();
  for (const t of txs) {
    const e = toCauseEntry(t, t.category_id ? nameOf.get(t.category_id) ?? null : null);
    if (!e) continue;
    byMonth.set(e.month, [...(byMonth.get(e.month) ?? []), e.entry]);
  }
  return [...byMonth.keys()].sort().map((m) => buildCauseMonth(m, byMonth.get(m)!));
}

/**
 * Livro de causas de um mês contra o normal do próprio usuário: até `baselineMonths` meses anteriores COM dados
 * (mediana com 3+, média com menos). Sem mês anterior, não há comparação honesta: devolve null.
 */
export function causeLedgerForMonth(months: CauseMonth[], month: string, baselineMonths = 6): CauseLedger | null {
  const current = months.find((m) => m.month === month);
  if (!current) return null;
  const baseline = months.filter((m) => m.month < month).slice(-baselineMonths);
  if (!baseline.length) return null;
  return computeCauseLedger(current, baseline);
}
