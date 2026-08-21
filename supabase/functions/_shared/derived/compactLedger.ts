// perf_facts.v1 — LEDGER COMPACTO
// ===============================
// Monta a entrada do motor canônico sem baixar a vida financeira inteira:
//
//   ledger compacto = lançamentos da JANELA
//                   + âncora de caixa por conta (fatos mensais anteriores)
//                   + carregamento de exposição por cartão (fatos anteriores)
//
// O motor continua sendo o mesmo (`finance-core`): aqui só trocamos o que
// entra nele. Cada linha é contada exatamente uma vez — ou está na janela, ou
// está consolidada nos fatos anteriores.
import { cashDateOf, txOrigin } from "../finance-core/facts.ts";
import { factMonthOf } from "./monthlyFacts.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export type CompactLedger = {
  txs: Any[];
  syntheticAnchors: Any[];
  windowStart: string;
  windowEnd: string;
  monthsMaterialized: number;
  transactionsRead: number;
  carryApplied: boolean;
  missingMonths: string[];
};

const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;

function shiftMonths(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 10);
}

function lastDayOfMonth(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * Janela justificada:
 *  - `lookbackMonths` meses fechados antes do período: baselines do motor
 *    (ritmo típico, média de 3 meses, mês anterior, comparações);
 *  - `aheadMonths` meses à frente: parcelas e planejados já lançados.
 * A janela NÃO cresce com o histórico total — é isso que quebra o O(N).
 */
export function resolveWindow(
  period: { start: string; end: string },
  today: string,
  opts?: { lookbackMonths?: number; aheadMonths?: number },
): { start: string; end: string } {
  const lookback = opts?.lookbackMonths ?? 6;
  const ahead = opts?.aheadMonths ?? 24;
  const anchorStart = period.start < today ? period.start : today;
  const start = shiftMonths(monthStart(anchorStart), -lookback);
  const anchorEnd = period.end > today ? period.end : today;
  const end = lastDayOfMonth(shiftMonths(monthStart(anchorEnd), ahead));
  return { start, end };
}

/**
 * Lê a janela + os fatos anteriores e devolve o ledger compacto.
 * Se faltar materialização para algum mês anterior à janela, devolve
 * `carryApplied: false` e a lista de meses ausentes — quem chama decide entre
 * degradar honestamente ou usar o caminho de bootstrap.
 */
export async function buildCompactLedger(
  sb: Any,
  userId: string,
  columns: string,
  window: { start: string; end: string },
  accounts: Any[],
  opts?: { includeCardCarry?: boolean },
): Promise<CompactLedger> {
  const windowMonth = window.start.slice(0, 7);

  const [{ data: factRows, error: factError }, txs] = await Promise.all([
    sb
      .from("financial_monthly_facts")
      .select("competence_month, account_deltas, card_deltas, completeness")
      .eq("user_id", userId)
      .lt("competence_month", `${windowMonth}-01`)
      .order("competence_month", { ascending: true }),
    fetchWindowTransactions(sb, userId, columns, window),
  ]);
  if (factError) throw Object.assign(new Error(factError.message), { source: "monthlyFacts" });

  // Meses com histórico e sem fato materializado: carry incompleto.
  const { data: pendingRows } = await sb
    .from("financial_dirty_periods")
    .select("competence_month")
    .eq("user_id", userId)
    .is("processed_at", null)
    .lt("competence_month", `${windowMonth}-01`);

  const missingMonths = ((pendingRows ?? []) as Any[]).map((r) => String(r.competence_month).slice(0, 7));

  const accountCarry: Record<string, number> = {};
  const cardCarry: Record<string, number> = {};
  for (const row of (factRows ?? []) as Any[]) {
    for (const [id, value] of Object.entries((row.account_deltas ?? {}) as Record<string, number>)) {
      accountCarry[id] = (accountCarry[id] ?? 0) + Number(value ?? 0);
    }
    for (const [id, value] of Object.entries((row.card_deltas ?? {}) as Record<string, number>)) {
      cardCarry[id] = (cardCarry[id] ?? 0) + Number(value ?? 0);
    }
  }

  const anchorDate = new Date(new Date(`${window.start}T00:00:00Z`).getTime() - 86400000)
    .toISOString()
    .slice(0, 10);

  // Linhas da janela cuja data de CAIXA cai antes da âncora já estão dentro do
  // carry (o motor as descarta pelo corte) — e linhas de cartão anteriores à
  // janela vêm na leitura por posted_at/competência: descontamos do carry para
  // não contar duas vezes.
  for (const t of txs) {
    const cash = cashDateOf(t);
    if (cash <= anchorDate && t.status === "confirmed" && t.type !== "transfer" && txOrigin(t) === "account" && t.account_id) {
      const signed = t.type === "income" ? Number(t.amount ?? 0) : -Number(t.amount ?? 0);
      accountCarry[String(t.account_id)] = (accountCarry[String(t.account_id)] ?? 0) + signed;
    }
    if (t.occurred_at < window.start) {
      if (t.status === "confirmed" && t.type === "expense" && txOrigin(t) === "credit_card" && t.credit_card_id) {
        cardCarry[String(t.credit_card_id)] = (cardCarry[String(t.credit_card_id)] ?? 0) - Number(t.amount ?? 0);
      }
      if (t.status === "confirmed" && t.settles_card_id) {
        cardCarry[String(t.settles_card_id)] = (cardCarry[String(t.settles_card_id)] ?? 0) + Number(t.amount ?? 0);
      }
    }
  }

  // Âncora sintética por conta: saldo de abertura + deltas consolidados.
  const syntheticAnchors = (accounts ?? []).map((a: Any) => ({
    account_id: String(a.id),
    balance_date: anchorDate,
    balance: Math.round(((Number(a.opening_balance ?? 0) + (accountCarry[String(a.id)] ?? 0)) + Number.EPSILON) * 100) / 100,
    status: "confirmed",
    anchor_kind: "bank_confirmed",
    source_document_id: null,
    reconciliation_delta: 0,
  }));

  // Carregamento de exposição por cartão: uma linha determinística por cartão,
  // datada antes da janela — fora de qualquer métrica comportamental
  // (`movement_kind` diferente de 'transaction') e de qualquer intervalo lido.
  const carryTxs = (opts?.includeCardCarry === false ? [] : Object.entries(cardCarry))
    .filter(([, value]) => Math.abs(Number(value ?? 0)) > 0.004)
    .map(([cardId, value]) => ({
      id: `carry-card-${cardId}`,
      user_id: userId,
      account_id: null,
      category_id: null,
      type: "expense",
      status: "confirmed",
      amount: Math.round((Number(value) + Number.EPSILON) * 100) / 100,
      occurred_at: anchorDate,
      competence_date: anchorDate,
      description: "Exposição consolidada de períodos anteriores",
      movement_kind: "carry_forward",
      payment_method: "credit_card",
      credit_card_id: cardId,
      transfer_group_id: null,
      posted_at: null,
      posted_at_source: null,
      settles_card_id: null,
    }));

  return {
    txs: [...txs, ...carryTxs],
    syntheticAnchors,
    windowStart: window.start,
    windowEnd: window.end,
    monthsMaterialized: ((factRows ?? []) as Any[]).length,
    transactionsRead: txs.length,
    carryApplied: missingMonths.length === 0,
    missingMonths,
  };
}

/** Leitura paginada da janela (o PostgREST corta em 1.000 linhas em silêncio). */
export async function fetchWindowTransactions(
  sb: Any,
  userId: string,
  columns: string,
  window: { start: string; end: string },
): Promise<Any[]> {
  const PAGE = 1000;
  const rows: Any[] = [];
  for (let i = 0; i < 60; i++) {
    const { data, error } = await sb
      .from("transactions")
      .select(columns)
      .eq("user_id", userId)
      .or(
        `and(occurred_at.gte.${window.start},occurred_at.lte.${window.end}),` +
          `and(competence_date.gte.${window.start},competence_date.lte.${window.end}),` +
          `and(posted_at.gte.${window.start},posted_at.lte.${window.end})`,
      )
      .order("id", { ascending: true })
      .range(i * PAGE, i * PAGE + PAGE - 1);
    if (error) throw Object.assign(new Error(error.message), { source: "transactions" });
    const chunk = (data ?? []) as Any[];
    rows.push(...chunk);
    if (chunk.length < PAGE) break;
  }
  return rows;
}

export { factMonthOf };
