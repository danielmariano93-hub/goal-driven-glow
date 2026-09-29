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
import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  reportingCompetenceDate,
  type TransactionRow,
} from "../../../finance-core/facts.ts";
import type { FinancialQueryV3 } from "../FinancialIRv3.ts";
import type { ExecutedIR } from "../SemanticPreservation.ts";
import { DIVERGENCE_ALERT_PCT, MIN_MONTHS_FOR_HABIT } from "../resolvers/AssessorDefaults.ts";

const TX_COLUMNS = [
  "id", "category_id", "type", "status", "amount", "occurred_at",
  "transfer_group_id", "payment_method", "credit_card_id", "settles_card_id",
  "movement_kind", "competence_date", "refund_of_transaction_id",
].join(",");

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
  const loadFrom = shiftDays(args.from, -45);
  const loadTo = shiftDays(args.to, 45);
  const rows = await fetchAllPages<any>((from, to) =>
    sb.from("transactions").select(TX_COLUMNS)
      .eq("user_id", args.user_id)
      .eq("status", "confirmed")
      .gte("occurred_at", loadFrom)
      .lte("occurred_at", loadTo)
      .order("occurred_at", { ascending: true })
      .range(from, to),
  { source: "typical_monthly" });

  // Refunds may inherit the category from the original purchase. If that
  // purchase fell outside the padded read window, load only referenced rows.
  const present = new Set(rows.map((row: any) => String(row.id)));
  const missingOriginalIds = [...new Set(rows
    .map((row: any) => String(row.refund_of_transaction_id ?? ""))
    .filter((id: string) => id && !present.has(id)))];
  const referenced: any[] = [];
  for (let offset = 0; offset < missingOriginalIds.length; offset += 200) {
    const ids = missingOriginalIds.slice(offset, offset + 200);
    const { data, error } = await sb.from("transactions").select(TX_COLUMNS)
      .eq("user_id", args.user_id).in("id", ids);
    if (!error && data?.length) referenced.push(...data);
  }

  const universe = [...rows, ...referenced] as TransactionRow[];
  const refundAttribution = buildRefundAttribution(universe);
  const categorySet = args.category_ids?.length
    ? new Set(args.category_ids.map(String))
    : null;
  const totals = new Map<string, number>();
  const observed = new Set<string>();

  for (const raw of rows) {
    const row = { ...raw, amount: Number(raw.amount ?? 0) } as TransactionRow;
    const competence = reportingCompetenceDate(row);
    if (competence < args.from || competence > args.to) continue;

    const amount = behavioralMetricAmount(row, "expense");
    if (amount === 0) continue;

    if (categorySet) {
      const categoryId = effectiveCategoryId(row, refundAttribution);
      if (!categoryId || !categorySet.has(String(categoryId))) continue;
    }

    const key = competence.slice(0, 7);
    totals.set(key, round2((totals.get(key) ?? 0) + amount));
    observed.add(key);
  }

  return monthsInWindow(args.from, args.to).map((month) => ({
    month,
    total: round2(totals.get(month) ?? 0),
    has_data: observed.has(month),
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

const MONTH_NAMES_PT = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function monthNamePt(month: string): string {
  const idx = Number(String(month).slice(5, 7)) - 1;
  return MONTH_NAMES_PT[idx] ?? month;
}

function formatBrl(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function joinNaturalPt(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} e ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
}

function influentialMonths(result: TypicalMonthlyResult): MonthlyBucket[] {
  const withData = result.months.filter((m) => m.has_data);
  if (!withData.length || result.median == null || result.mean == null) return [];
  const upward = result.mean >= result.median;
  return [...withData]
    .sort((a, b) => upward ? b.total - a.total : a.total - b.total)
    .slice(0, Math.min(2, withData.length));
}

/**
 * Texto determinístico do handler. Além de declarar a estatística e a base,
 * explica a diferença entre "típico" e média quando meses excepcionais
 * distorcem a média. A explicação usa os próprios buckets calculados pelo
 * motor — sem pedir ao LLM para inferir causa ou recalcular valores.
 */
export function typicalMonthlyText(
  result: TypicalMonthlyResult,
  scopeLabel: string | null,
): string {
  const scope = scopeLabel ? ` com ${scopeLabel}` : "";
  if (result.headline == null) {
    return `Não tenho lançamentos suficientes${scope} nos últimos ${result.window.n} meses fechados para dizer quanto é o seu padrão. ${result.caveats[0] ?? ""}`.trim();
  }

  const baseDescription = result.months_with_data === result.window.n
    ? `últimos ${result.window.n} meses fechados`
    : `${result.months_with_data} meses fechados com dados dentro da janela dos últimos ${result.window.n} meses`;
  const lines: string[] = [];

  if (result.statistic === "median") {
    lines.push(`💸 Seu gasto típico${scope} é de ${formatBrl(result.headline)} por mês.`);
    lines.push(
      `Esse valor usa a mediana dos ${baseDescription}, por isso representa melhor o centro do seu comportamento mensal e sofre menos com meses excepcionalmente altos ou baixos.`,
    );
  } else {
    lines.push(`💸 Sua média mensal${scope} é de ${formatBrl(result.headline)}.`);
    lines.push(`Esse valor é a média aritmética dos ${baseDescription}.`);
  }

  if (result.divergent && result.median != null && result.mean != null) {
    const upward = result.mean > result.median;
    const influencers = influentialMonths(result);
    const influencerText = joinNaturalPt(influencers.map((m) => `${monthNamePt(m.month)} (${formatBrl(m.total)})`));

    if (result.statistic === "median") {
      lines.push(
        `Mas a média aritmética no mesmo período foi de ${formatBrl(result.mean)}, ${upward ? "bem acima" : "bem abaixo"} do seu gasto típico.`,
      );
    } else {
      lines.push(
        `A mediana no mesmo período foi de ${formatBrl(result.median)}, ${upward ? "bem abaixo" : "bem acima"} da média.`,
      );
    }

    if (influencerText) {
      lines.push(
        `Isso aconteceu principalmente por ${influencerText}, ${influencers.length === 1 ? "o mês que mais puxou" : "os meses que mais puxaram"} a média para ${upward ? "cima" : "baixo"}.`,
      );
    }

    if (result.statistic === "median") {
      lines.push(
        `Em outras palavras: ${formatBrl(result.median)} representa melhor o que você costuma gastar em um mês normal; ${formatBrl(result.mean)} é a média do período e ficou muito influenciada por esses meses fora do padrão.`,
      );
    } else {
      lines.push(
        `A média responde ao valor aritmético do período; a mediana de ${formatBrl(result.median)} mostra o centro do comportamento sem dar o mesmo peso aos meses mais extremos.`,
      );
    }
  }

  const extraCaveats = result.caveats.filter((c) =>
    !c.startsWith("Base:") && !c.startsWith("Mediana e média ficam distantes")
  );
  if (extraCaveats.length) lines.push(extraCaveats.join(" "));

  lines.push(
    result.divergent
      ? "Se quiser, eu detalho os meses fora do padrão ou comparo com o período anterior."
      : "Se quiser, eu comparo esse padrão com o período anterior ou detalho mês a mês.",
  );

  return lines.join("\n\n");
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
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  // Personal categories shadow same-named global ones; otherwise a user copy of
  // "Lazer" plus the global "Lazer" looked ambiguous and the read failed.
  const all = (data ?? []) as Array<{ id: string; name: string; user_id: string | null }>;
  const personalNames = new Set(all.filter((r) => r.user_id).map((r) => norm(r.name)));
  const rows = all.filter((r) => r.user_id || !personalNames.has(norm(r.name)));
  const target = norm(wanted);
  const exact = rows.filter((r) => norm(r.name) === target);
  if (exact.length) return exact.map((r) => r.id);
  return rows.filter((r) => norm(r.name).includes(target) || target.includes(norm(r.name))).map((r) => r.id);
}
