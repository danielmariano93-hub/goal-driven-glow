// Agregação mensal do ledger canônico para o Mapa Financeiro. Puro.
// Entrada: lançamentos já canônicos (competência, sem transferência/fatura/investimento; estorno = despesa negativa).

export interface MapaMonthlyEntry {
  /** Competência canônica YYYY-MM-DD. */
  date: string;
  kind: "expense" | "income";
  /** Despesa: consumo (estorno negativo). Receita: valor positivo. */
  amount: number;
  /** Categoria da despesa (para "essencial"). */
  category_id?: string | null;
}

export interface MapaMonthAgg {
  month: string; // YYYY-MM
  income: number;
  consumption: number;
  entries: number;
  /** Mês civil já encerrado em relação à data de referência. */
  closed: boolean;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const mapaMonthOf = (isoDate: string) => isoDate.slice(0, 7);

export function mapaAddMonths(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/**
 * Meses contínuos do primeiro lançamento até o mês de `asOf`. Mês dentro do período de uso sem nenhum lançamento
 * aparece com `entries: 0` (lacuna). Antes do primeiro lançamento não existe (a pessoa ainda não usava o app).
 */
export function aggregateMonths(entries: MapaMonthlyEntry[], asOf: string): MapaMonthAgg[] {
  if (!entries.length) return [];
  const current = mapaMonthOf(asOf);
  const by = new Map<string, MapaMonthAgg>();
  let first = current;
  for (const e of entries) {
    const m = mapaMonthOf(e.date);
    if (m > current) continue;
    if (m < first) first = m;
    const row = by.get(m) ?? { month: m, income: 0, consumption: 0, entries: 0, closed: m < current };
    if (e.kind === "income") row.income += e.amount;
    else row.consumption += e.amount;
    row.entries += 1;
    by.set(m, row);
  }
  const out: MapaMonthAgg[] = [];
  for (let m = first; m <= current; m = mapaAddMonths(m, 1)) {
    const row = by.get(m) ?? { month: m, income: 0, consumption: 0, entries: 0, closed: m < current };
    out.push({ ...row, income: round2(row.income), consumption: round2(row.consumption) });
  }
  return out;
}

/** Últimos `n` meses fechados COM registro (mais recentes), em ordem cronológica. */
export function lastClosedActiveMonths(months: MapaMonthAgg[], n: number): MapaMonthAgg[] {
  return months.filter((m) => m.closed && m.entries > 0).slice(-n);
}

export function mapaMedian(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Desvio-padrão amostral (n−1). null com menos de 2 valores. */
export function mapaSampleStdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1));
}
