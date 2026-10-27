/**
 * Fluxo do rolê (visão do DONO): mês a mês, quanto entra dos amigos e quanto sai pelas origens
 * (dívida, cartão, conta). Função pura: nada é lançado nem digitado, tudo sai das agendas existentes.
 */
export type FlowSourceKind = "debt" | "credit_card" | "account";

export type FlowSource = {
  kind: FlowSourceKind;
  amount: number;
  /** Parcelas da origem (cartão). Para dívida vem da própria dívida. */
  installments?: number | null;
  /** 1º vencimento (YYYY-MM-DD). */
  first_due?: string | null;
  label?: string;
  debt?: {
    installments_total?: number | null;
    installments_paid?: number | null;
    first_due_date?: string | null;
    due_day?: number | null;
  } | null;
};

export type FlowReceivable = { due_date: string | null; amount: number };

export type FlowMonth = {
  month: string; // YYYY-MM
  inflow: number;
  outflow: number;
  net: number;
  cumulative: number;
};

export type RoleFlow = {
  months: FlowMonth[];
  /** Maior valor adiantado do próprio bolso (positivo) e o mês em que ocorre. */
  peakExposure: number;
  peakMonth: string | null;
  /** Saldo ao fim do período (negativo = a parte do próprio dono). */
  endBalance: number;
};

const cents = (v: number) => Math.round(v * 100);
const monthOf = (iso: string) => iso.slice(0, 7);

function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** Divide em N parcelas em centavos; o resto vai para as primeiras. */
export function splitCents(total: number, n: number): number[] {
  const count = Math.max(1, Math.floor(n));
  const all = cents(total);
  const base = Math.floor(all / count);
  let rest = all - base * count;
  return Array.from({ length: count }, () => (base + (rest-- > 0 ? 1 : 0)) / 100);
}

/** Saídas mensais de uma origem. */
export function sourceOutflows(source: FlowSource, occurredAt: string): Array<{ month: string; amount: number }> {
  if (source.kind === "account") return [{ month: monthOf(occurredAt), amount: source.amount }];

  if (source.kind === "debt") {
    const n = Math.max(1, Number(source.debt?.installments_total ?? source.installments ?? 1));
    const start = source.first_due ?? source.debt?.first_due_date ?? null;
    const first = start ? monthOf(start) : addMonths(monthOf(occurredAt), 1);
    return splitCents(source.amount, n).map((amount, i) => ({ month: addMonths(first, i), amount }));
  }

  const n = Math.max(1, Number(source.installments ?? 1));
  const first = source.first_due ? monthOf(source.first_due) : addMonths(monthOf(occurredAt), 1);
  return splitCents(source.amount, n).map((amount, i) => ({ month: addMonths(first, i), amount }));
}

export function computeRoleFlow(
  sources: FlowSource[],
  receivables: FlowReceivable[],
  occurredAt: string,
): RoleFlow {
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const r of receivables) {
    if (!r.due_date || !(r.amount > 0)) continue;
    const m = monthOf(r.due_date);
    inflow.set(m, (inflow.get(m) ?? 0) + cents(r.amount));
  }
  for (const s of sources) {
    for (const o of sourceOutflows(s, occurredAt)) {
      outflow.set(o.month, (outflow.get(o.month) ?? 0) + cents(o.amount));
    }
  }
  const keys = [...new Set([...inflow.keys(), ...outflow.keys()])].sort();
  if (!keys.length) return { months: [], peakExposure: 0, peakMonth: null, endBalance: 0 };

  const months: FlowMonth[] = [];
  let cursor = keys[0]!;
  const last = keys[keys.length - 1]!;
  let cumulative = 0;
  let peak = 0;
  let peakMonth: string | null = null;
  while (cursor <= last) {
    const i = inflow.get(cursor) ?? 0;
    const o = outflow.get(cursor) ?? 0;
    cumulative += i - o;
    months.push({ month: cursor, inflow: i / 100, outflow: o / 100, net: (i - o) / 100, cumulative: cumulative / 100 });
    if (-cumulative > peak) { peak = -cumulative; peakMonth = cursor; }
    cursor = addMonths(cursor, 1);
  }
  return { months, peakExposure: peak / 100, peakMonth, endBalance: cumulative / 100 };
}

/** Soma das origens e quanto falta para fechar com o total (centavos exatos). */
export function sourcesBalance(total: number, amounts: number[]): { sum: number; remaining: number; ok: boolean } {
  const sum = amounts.reduce((acc, a) => acc + cents(Number.isFinite(a) ? a : 0), 0);
  return { sum: sum / 100, remaining: (cents(total) - sum) / 100, ok: sum === cents(total) };
}
