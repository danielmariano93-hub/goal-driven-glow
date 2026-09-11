// TypicalMonthlyHandler (`nino_typical_monthly.v1`)
//
// Handler determinístico do shape "gasto típico mensal": disparado pelo SHAPE
// do IR (expense_amount × grain=month × habitual/last_n_complete × typical),
// nunca por regex de texto e nunca por nome de tool.
//
// Política v1 (fixa e auditável):
//  - 6 meses de calendário COMPLETOS; mês corrente sempre fora.
//  - menos de 3 meses com dado → leitura entregue com ressalva de firmeza.
//  - mediana é o número principal; média entra como auxiliar.
//  - divergência >= 20% entre mediana e média é dita com os dois números.
//  - mês sem cobertura de dados NÃO é mês de gasto zero.
// deno-lint-ignore-file no-explicit-any
import { fetchAllPages } from "../../../derived/pagedSelect.ts";
import { reportingCompetenceDate } from "../../../finance-core/facts.ts";
import type { FinancialQueryV3 } from "../FinancialIRv3.ts";
import type { ExecutedIR } from "../SemanticPreservation.ts";
import { DIVERGENCE_ALERT_PCT, MIN_MONTHS_FOR_HABIT } from "../resolvers/AssessorDefaults.ts";

const TX_COLUMNS = "amount,type,status,occurred_at,competence_date,payment_method,credit_card_id,category_id";

export type MonthlyBucket = { month: string; total: number; has_data: boolean };

export type TypicalMonthlyResult = {
  version: "nino_typical_monthly.v1";
  months: MonthlyBucket[];
  months_with_data: number;
  median: number | null;
  mean: number | null;
  statistic: "median" | "mean";
  headline: number | null;
  divergent: boolean;
  low_confidence: boolean;
  caveats: string[];
  window: { from: string; to: string; n: number };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round2(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

export function mean(values: number[]): number | null {
  if (!values.length) return null;
  return round2(values.reduce((a, b) => a + b, 0) / values.length);
}

/** Lista os meses (YYYY-MM) de uma janela fechada. */
export function monthsInWindow(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ey, em] = to.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/** Política pura — testável sem banco. */
export function typicalMonthlyPolicy(args: {
  buckets: MonthlyBucket[];
  window: { from: string; to: string; n: number };
  preferred: "typical" | "median" | "mean";
}): TypicalMonthlyResult {
  const withData = args.buckets.filter((b) => b.has_data);
  const values = withData.map((b) => b.total);
  const med = median(values);
  const avg = mean(values);
  const statistic: "median" | "mean" = args.preferred === "mean" ? "mean" : "median";
  const headline = statistic === "mean" ? avg : med;
  const caveats: string[] = [];
  const lowConfidence = withData.length < MIN_MONTHS_FOR_HABIT.value;

  if (!withData.length) {
    caveats.push("Não encontrei lançamentos nesse recorte, então não tenho um padrão para te dar.");
  } else {
    caveats.push(
      `Base: ${withData.length} ${withData.length === 1 ? "mês" : "meses"} completo${withData.length === 1 ? "" : "s"} com lançamentos.`,
    );
    if (withData.length < args.buckets.length) {
      const missing = args.buckets.filter((b) => !b.has_data).map((b) => b.month);
      caveats.push(`Sem dados em ${missing.join(", ")} — não contei como mês de gasto zero.`);
    }
    if (lowConfidence) caveats.push("Com essa quantidade de meses o padrão ainda é pouco firme.");
  }

  const divergent = med != null && avg != null && med > 0
    && Math.abs(avg - med) / med * 100 >= DIVERGENCE_ALERT_PCT.value;
  if (divergent) {
    caveats.push(`Mediana e média ficam distantes (${med} contra ${avg}) — teve mês fora do padrão.`);
  }

  return {
    version: "nino_typical_monthly.v1",
    months: args.buckets,
    months_with_data: withData.length,
    median: med,
    mean: avg,
    statistic,
    headline,
    divergent,
    low_confidence: lowConfidence,
    caveats,
    window: args.window,
  };
}

/**
 * Leitura ÚNICA da janela (não 6 idas ao banco), bucketizada por competência
 * de relatório. Paginação completa obrigatória — corte silencioso em 1.000
 * linhas já produziu número errado neste produto.
 */
export async function loadMonthlyExpenseBuckets(
  sb: any,
  args: {
    user_id: string;
    from: string;
    to: string;
    category_ids?: string[] | null;
  },
): Promise<MonthlyBucket[]> {
  // A janela é por competência; carregamos com folga de 45 dias em occurred_at
  // porque compra de cartão pode ocorrer antes da competência.
  const loadFrom = shiftDays(args.from, -45);
  const loadTo = shiftDays(args.to, 45);
  const rows = await fetchAllPages<any>((from, to) => {
    let q = sb.from("transactions").select(TX_COLUMNS)
      .eq("user_id", args.user_id)
      .eq("type", "expense")
      .eq("status", "confirmed")
      .gte("occurred_at", loadFrom)
      .lte("occurred_at", loadTo)
      .order("occurred_at", { ascending: true })
      .range(from, to);
    if (args.category_ids?.length) q = q.in("category_id", args.category_ids);
    return q;
  }, { source: "typical_monthly" });

  const totals = new Map<string, number>();
  for (const row of rows) {
    const competence = reportingCompetenceDate(row);
    if (competence < args.from || competence > args.to) continue;
    const key = competence.slice(0, 7);
    totals.set(key, round2((totals.get(key) ?? 0) + Math.abs(Number(row.amount ?? 0))));
  }

  return monthsInWindow(args.from, args.to).map((month) => ({
    month,
    total: totals.get(month) ?? 0,
    has_data: totals.has(month),
  }));
}

function shiftDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `executed_ir` real do handler — o que ele de fato rodou. */
export function typicalMonthlyExecutedIR(q: FinancialQueryV3, result: TypicalMonthlyResult): ExecutedIR {
  return {
    metric: "expense_amount",
    filters: q.filters ?? [],
    time: {
      aspect: q.time.aspect,
      from: result.window.from,
      to: result.window.to,
      n: result.window.n,
      exclude_partial: true,
    },
    grain: "month",
    reduce: result.statistic === "mean" ? "mean" : (q.reduce === "median" ? "median" : "typical"),
    group_by: [],
    partial: result.months_with_data < result.months.length,
  };
}

/**
 * Texto determinístico do handler. A estatística usada é DECLARADA, a base de
 * meses aparece, e sem cobertura mínima o Nino diz que não tem padrão — nunca
 * entrega um número de um mês só como se fosse hábito.
 */
export function typicalMonthlyText(
  result: TypicalMonthlyResult,
  scopeLabel: string | null,
): string {
  const brl = (n: number) =>
    n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const scope = scopeLabel ? ` com ${scopeLabel}` : "";
  if (result.headline == null) {
    return `Não tenho lançamentos suficientes${scope} nos últimos ${result.window.n} meses fechados para dizer quanto é o seu padrão. ${result.caveats[0] ?? ""}`.trim();
  }
  const statistic = result.statistic === "mean" ? "média" : "mediana";
  const lines = [
    `Seu gasto típico${scope} é de ${brl(result.headline)} por mês (${statistic} dos últimos ${result.window.n} meses fechados).`,
    ...result.caveats,
  ];
  return lines.join(" ");
}

/**
 * Resolve o NOME da categoria para ids reais (pessoais + globais). Devolve
 * lista vazia quando nada casa: o chamador falha honesto em vez de virar
 * leitura global — filtro perdido já produziu resposta errada neste produto.
 */
export async function resolveCategoryIdsByName(
  sb: any,
  user_id: string,
  name: string,
): Promise<string[]> {
  const wanted = String(name ?? "").trim().toLowerCase();
  if (!wanted) return [];
  const { data, error } = await sb.from("categories").select("id,name,user_id,type")
    .or(`user_id.eq.${user_id},user_id.is.null`)
    .is("archived_at", null)
    .eq("type", "expense");
  if (error) return [];
  const rows = (data ?? []) as Array<{ id: string; name: string }>;
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const target = norm(wanted);
  const exact = rows.filter((r) => norm(r.name) === target);
  if (exact.length) return exact.map((r) => r.id);
  return rows.filter((r) => norm(r.name).includes(target) || target.includes(norm(r.name))).map((r) => r.id);
}
