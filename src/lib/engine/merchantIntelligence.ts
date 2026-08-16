// Motor de Estabelecimentos (`merchant_intelligence.v1`).
// Responde quanto/quantas vezes/ticket/variação por estabelecimento, sempre em
// valor LÍQUIDO de estornos e sempre com evidência. Puro e determinístico.
import {
  behavioralMetricAmount,
  isRealMonthlyMovement,
  round2,
  type TransactionRow,
} from "./facts";
import {
  buildMerchantResolver,
  merchantMatches,
  merchantSourceText,
  normalizeMerchant,
  type MerchantAliasRow,
  type MerchantResolver,
} from "./merchant";
import {
  confidenceFromSample,
  makeEnvelope,
  makeEvidence,
  previousWindow,
  safePct,
  weekdayOf,
  WEEKDAY_LABELS_PT,
  type EngineEnvelope,
  type EnginePeriod,
} from "./engineEnvelope";

export const MERCHANT_INTELLIGENCE_VERSION = "merchant_intelligence.v1";

export interface MerchantOccurrence {
  transaction_id: string;
  date: string;
  amount: number;
  category_id: string | null;
  description: string | null;
}

export interface MerchantStats {
  key: string;
  label: string;
  /** Gasto bruto (sem abater estornos). */
  gross_total: number;
  /** Estornos vinculados a compras deste estabelecimento. */
  refund_total: number;
  /** Gasto líquido — a verdade usada em qualquer "quanto gastei". */
  net_total: number;
  count: number;
  avg_ticket: number;
  max_ticket: number;
  max_ticket_date: string | null;
  first_at: string | null;
  last_at: string | null;
  /** Dia da semana com maior concentração de valor. */
  top_weekday: { weekday: number; label: string; share: number } | null;
  /** Participação no total do período/categoria (0..1). Calculada no motor. */
  share: number;
  categories: Array<{ category_id: string | null; total: number }>;
  occurrences: MerchantOccurrence[];
}

export interface MerchantComparison extends MerchantStats {
  previous_net_total: number;
  previous_count: number;
  previous_avg_ticket: number;
  delta_abs: number;
  delta_pct: number | null;
  count_delta: number;
  avg_ticket_delta: number;
  /** O aumento vem mais de frequência ou de ticket? */
  main_driver: "frequencia" | "ticket" | "novo" | "reducao" | "estavel";
}

export interface MerchantsInput {
  txs: TransactionRow[];
  period: EnginePeriod;
  comparisonPeriod?: EnginePeriod | null;
  aliases?: MerchantAliasRow[];
  resolver?: MerchantResolver;
  /** Restringe a análise a uma categoria (id). */
  categoryId?: string | null;
  limit?: number;
}

function inRange(date: string, period: EnginePeriod): boolean {
  const d = date.slice(0, 10);
  return d >= period.from && d <= period.to;
}

/** Mapa transação de estorno → transação de despesa original. */
function refundLinks(txs: TransactionRow[]): Map<string, string> {
  const byId = new Set(txs.map((t) => t.id));
  const links = new Map<string, string>();
  for (const t of txs) {
    const original = t.refund_of_transaction_id;
    if (!original) continue;
    if (!byId.has(original)) continue;
    links.set(t.id, original);
  }
  return links;
}

function isConsumptionExpense(t: TransactionRow): boolean {
  return t.type === "expense" && isRealMonthlyMovement(t) && behavioralMetricAmount(t, "expense") > 0;
}

function emptyStats(key: string, label: string): MerchantStats {
  return {
    key,
    label,
    gross_total: 0,
    refund_total: 0,
    net_total: 0,
    count: 0,
    avg_ticket: 0,
    max_ticket: 0,
    max_ticket_date: null,
    first_at: null,
    last_at: null,
    top_weekday: null,
    share: 0,
    categories: [],
    occurrences: [],
  };
}

/**
 * Estatísticas por estabelecimento no período. Estorno vinculado abate o
 * estabelecimento da compra ORIGINAL, mesmo que a linha do estorno tenha outra
 * descrição ou categoria.
 */
export function computeMerchantStats(input: MerchantsInput): MerchantStats[] {
  const resolver = input.resolver ?? buildMerchantResolver(input.aliases ?? []);
  const links = refundLinks(input.txs);
  const merchantByTxId = new Map<string, { key: string; label: string }>();
  const stats = new Map<string, MerchantStats>();
  const weekdayTotals = new Map<string, Map<number, number>>();
  const categoryTotals = new Map<string, Map<string, number>>();

  // 1ª passada: despesas de consumo do período.
  for (const t of input.txs) {
    if (!isConsumptionExpense(t)) continue;
    // `merchant_truth.v2`: identidade canônica vem da precedência única
    // merchant_name → normalized_description → friendly → description → banco.
    const resolution = resolver.resolve(merchantSourceText(t as never) ?? t.description);
    if (!resolution) continue;
    merchantByTxId.set(t.id, resolution);
    if (!inRange(t.occurred_at, input.period)) continue;
    if (input.categoryId && (t.category_id ?? null) !== input.categoryId) continue;

    const amount = round2(Number(t.amount || 0));
    const acc = stats.get(resolution.key) ?? emptyStats(resolution.key, resolution.label);
    acc.gross_total = round2(acc.gross_total + amount);
    acc.count += 1;
    if (amount > acc.max_ticket) {
      acc.max_ticket = amount;
      acc.max_ticket_date = t.occurred_at.slice(0, 10);
    }
    const day = t.occurred_at.slice(0, 10);
    if (!acc.first_at || day < acc.first_at) acc.first_at = day;
    if (!acc.last_at || day > acc.last_at) acc.last_at = day;
    acc.occurrences.push({
      transaction_id: t.id,
      date: day,
      amount,
      category_id: t.category_id ?? null,
      description: t.description ?? null,
    });
    stats.set(resolution.key, acc);

    const wd = weekdayTotals.get(resolution.key) ?? new Map<number, number>();
    const w = weekdayOf(day);
    wd.set(w, round2((wd.get(w) ?? 0) + amount));
    weekdayTotals.set(resolution.key, wd);

    const cats = categoryTotals.get(resolution.key) ?? new Map<string, number>();
    const catKey = t.category_id ?? "__none__";
    cats.set(catKey, round2((cats.get(catKey) ?? 0) + amount));
    categoryTotals.set(resolution.key, cats);
  }

  // 2ª passada: estornos vinculados abatem o estabelecimento original.
  for (const t of input.txs) {
    const mk = String(t.movement_kind ?? "");
    if (mk !== "refund") continue;
    if (t.status !== "confirmed") continue;
    if (!inRange(t.occurred_at, input.period)) continue;
    const originalId = links.get(t.id);
    if (!originalId) continue;
    const merchant = merchantByTxId.get(originalId);
    if (!merchant) continue;
    const acc = stats.get(merchant.key);
    if (!acc) continue;
    const amount = round2(Math.abs(Number(t.amount || 0)));
    acc.refund_total = round2(acc.refund_total + amount);
  }

  const out: MerchantStats[] = [];
  for (const acc of stats.values()) {
    acc.net_total = round2(acc.gross_total - acc.refund_total);
    acc.avg_ticket = acc.count > 0 ? round2(acc.gross_total / acc.count) : 0;

    const wd = weekdayTotals.get(acc.key);
    if (wd && acc.gross_total > 0) {
      let bestDay = -1;
      let bestValue = 0;
      let total = 0;
      for (const [, v] of wd) total += v;
      for (const [day, v] of wd) {
        if (v > bestValue) {
          bestValue = v;
          bestDay = day;
        }
      }
      if (bestDay >= 0 && total > 0) {
        acc.top_weekday = {
          weekday: bestDay,
          label: WEEKDAY_LABELS_PT[bestDay],
          share: round2(bestValue / total),
        };
      }
    }

    const cats = categoryTotals.get(acc.key);
    if (cats) {
      acc.categories = [...cats.entries()]
        .map(([id, total]) => ({ category_id: id === "__none__" ? null : id, total: round2(total) }))
        .sort((a, b) => b.total - a.total);
    }

    acc.occurrences.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    out.push(acc);
  }

  return out.sort((a, b) => b.net_total - a.net_total);
}

function compare(current: MerchantStats[], previous: MerchantStats[]): MerchantComparison[] {
  const prevByKey = new Map(previous.map((m) => [m.key, m]));
  const rows: MerchantComparison[] = current.map((m) => {
    const p = prevByKey.get(m.key);
    const previousNet = p?.net_total ?? 0;
    const previousCount = p?.count ?? 0;
    const previousTicket = p?.avg_ticket ?? 0;
    const deltaAbs = round2(m.net_total - previousNet);
    const countDelta = m.count - previousCount;
    const ticketDelta = round2(m.avg_ticket - previousTicket);

    let driver: MerchantComparison["main_driver"] = "estavel";
    if (!p || previousCount === 0) driver = m.net_total > 0 ? "novo" : "estavel";
    else if (deltaAbs < -0.5) driver = "reducao";
    else if (deltaAbs > 0.5) {
      const freqEffect = countDelta * previousTicket;
      const ticketEffect = m.count * ticketDelta;
      driver = Math.abs(freqEffect) >= Math.abs(ticketEffect) ? "frequencia" : "ticket";
    }

    return {
      ...m,
      previous_net_total: previousNet,
      previous_count: previousCount,
      previous_avg_ticket: previousTicket,
      delta_abs: deltaAbs,
      delta_pct: safePct(m.net_total, previousNet),
      count_delta: countDelta,
      avg_ticket_delta: ticketDelta,
      main_driver: driver,
    };
  });

  // Estabelecimentos que desapareceram entram como redução (delta negativo).
  const currentKeys = new Set(current.map((m) => m.key));
  for (const p of previous) {
    if (currentKeys.has(p.key)) continue;
    if (p.net_total <= 0) continue;
    rows.push({
      ...emptyStats(p.key, p.label),
      previous_net_total: p.net_total,
      previous_count: p.count,
      previous_avg_ticket: p.avg_ticket,
      delta_abs: round2(-p.net_total),
      delta_pct: -100,
      count_delta: -p.count,
      avg_ticket_delta: round2(-p.avg_ticket),
      main_driver: "reducao",
    });
  }

  return rows;
}

export interface MerchantRankingFacts {
  period_net_total: number;
  previous_net_total: number;
  delta_abs: number;
  delta_pct: number | null;
  merchant_count: number;
  /** Quanto do gasto do período tem estabelecimento identificável. */
  coverage: number;
  /** Total gasto no período (ou na categoria filtrada), resolvido ou não. */
  category_total: number;
  /** Total com estabelecimento resolvido. */
  resolved_total: number;
  /** Total sem estabelecimento resolvido (intermediador, descrição pobre). */
  unresolved_total: number;
  top_merchant: { label: string; net_total: number; share: number } | null;
}

/** Ranking "quem mais consome meu dinheiro" + variação por estabelecimento. */
export function rankMerchants(
  input: MerchantsInput,
): EngineEnvelope<MerchantRankingFacts, MerchantComparison, MerchantComparison> {
  const resolver = input.resolver ?? buildMerchantResolver(input.aliases ?? []);
  const comparisonPeriod = input.comparisonPeriod ?? previousWindow(input.period);
  const current = computeMerchantStats({ ...input, resolver });
  const previous = computeMerchantStats({ ...input, resolver, period: comparisonPeriod });
  const limit = input.limit ?? 10;

  const rowsRaw = compare(current, previous).sort((a, b) => b.net_total - a.net_total || b.delta_abs - a.delta_abs);

  const periodNet = round2(current.reduce((s, m) => s + m.net_total, 0));
  const previousNet = round2(previous.reduce((s, m) => s + m.net_total, 0));

  // Cobertura: gasto do período com merchant resolvido / gasto total do período.
  let totalPeriodExpense = 0;
  for (const t of input.txs) {
    if (!isConsumptionExpense(t)) continue;
    if (!inRange(t.occurred_at, input.period)) continue;
    if (input.categoryId && (t.category_id ?? null) !== input.categoryId) continue;
    totalPeriodExpense = round2(totalPeriodExpense + Number(t.amount || 0));
  }
  const grossResolved = round2(current.reduce((s, m) => s + m.gross_total, 0));
  const coverage = totalPeriodExpense > 0 ? round2(grossResolved / totalPeriodExpense) : 0;

  // Share SEMPRE calculado no motor — e SEMPRE sobre o total REAL do período/
  // categoria, nunca sobre o subtotal dos merchants identificados.
  const shareBase = totalPeriodExpense > 0 ? totalPeriodExpense : periodNet;
  const rows = rowsRaw.map((r) => ({ ...r, share: shareBase > 0 ? round2(r.net_total / shareBase) : 0 }));


  const top = current[0] ?? null;
  const sampleSize = current.reduce((s, m) => s + m.count, 0);

  const drivers = rows
    .filter((r) => Math.abs(r.delta_abs) >= 1)
    .sort((a, b) => Math.abs(b.delta_abs) - Math.abs(a.delta_abs))
    .slice(0, 5);

  return makeEnvelope({
    engine: "merchant_ranking",
    facts: {
      period_net_total: periodNet,
      previous_net_total: previousNet,
      delta_abs: round2(periodNet - previousNet),
      delta_pct: safePct(periodNet, previousNet),
      merchant_count: current.length,
      coverage,
      category_total: totalPeriodExpense,
      resolved_total: grossResolved,
      unresolved_total: round2(Math.max(0, totalPeriodExpense - grossResolved)),
      top_merchant: top
        ? { label: top.label, net_total: top.net_total, share: shareBase > 0 ? round2(top.net_total / shareBase) : 0 }
        : null,
    },
    breakdown: rows.slice(0, limit),
    drivers,
    evidence: makeEvidence({
      period: input.period,
      comparisonPeriod,
      sampleSize,
      formulaVersion: MERCHANT_INTELLIGENCE_VERSION,
      notes: coverage < 0.6
        ? ["Parte dos lançamentos não tem descrição suficiente para identificar o estabelecimento."]
        : [],
    }),
    confidence: confidenceFromSample(sampleSize, { minSample: 3, goodSample: 15 }),
  });
}

export interface MerchantProfileFacts extends MerchantComparison {
  query: string;
  found: boolean;
}

/** Perfil de um estabelecimento específico ("quanto gastei com Uber?"). */
export function merchantProfile(
  input: MerchantsInput & { query: string },
): EngineEnvelope<MerchantProfileFacts, MerchantOccurrence, MerchantComparison> {
  const resolver = input.resolver ?? buildMerchantResolver(input.aliases ?? []);
  const comparisonPeriod = input.comparisonPeriod ?? previousWindow(input.period);
  const current = computeMerchantStats({ ...input, resolver });
  const previous = computeMerchantStats({ ...input, resolver, period: comparisonPeriod });
  const rows = compare(current, previous);

  const term = input.query;
  const normalizedTerm = normalizeMerchant(term);
  const matched = rows
    .filter((r) => merchantMatches(r.key, r.label, term))
    .sort((a, b) => b.net_total - a.net_total)[0] ?? null;

  const facts: MerchantProfileFacts = matched
    ? { ...matched, query: term, found: true }
    : {
        ...emptyStats(normalizedTerm ?? term, term),
        previous_net_total: 0,
        previous_count: 0,
        previous_avg_ticket: 0,
        delta_abs: 0,
        delta_pct: null,
        count_delta: 0,
        avg_ticket_delta: 0,
        main_driver: "estavel",
        query: term,
        found: false,
      };

  return makeEnvelope({
    engine: "merchant_profile",
    facts,
    breakdown: facts.occurrences,
    drivers: matched ? [matched] : [],
    evidence: makeEvidence({
      period: input.period,
      comparisonPeriod,
      sampleSize: facts.count,
      formulaVersion: MERCHANT_INTELLIGENCE_VERSION,
      notes: facts.found ? [] : ["Nenhum lançamento deste estabelecimento no período analisado."],
    }),
    confidence: facts.found
      ? confidenceFromSample(facts.count, { minSample: 2, goodSample: 8 })
      : "insufficient_data",
  });
}

/** Quais estabelecimentos explicam a variação de uma categoria. */
export function merchantsExplainingCategory(
  input: MerchantsInput & { categoryId: string | null },
): EngineEnvelope<{ category_id: string | null; delta_abs: number; explained_abs: number }, MerchantComparison, MerchantComparison> {
  const resolver = input.resolver ?? buildMerchantResolver(input.aliases ?? []);
  const comparisonPeriod = input.comparisonPeriod ?? previousWindow(input.period);
  const current = computeMerchantStats({ ...input, resolver });
  const previous = computeMerchantStats({ ...input, resolver, period: comparisonPeriod });
  const rows = compare(current, previous)
    .filter((r) => Math.abs(r.delta_abs) >= 0.5)
    .sort((a, b) => b.delta_abs - a.delta_abs);

  const deltaAbs = round2(
    current.reduce((s, m) => s + m.net_total, 0) - previous.reduce((s, m) => s + m.net_total, 0),
  );
  const explained = round2(rows.reduce((s, r) => s + r.delta_abs, 0));
  const sampleSize = current.reduce((s, m) => s + m.count, 0);

  return makeEnvelope({
    engine: "merchants_explaining_category",
    facts: { category_id: input.categoryId ?? null, delta_abs: deltaAbs, explained_abs: explained },
    breakdown: rows,
    drivers: rows.slice(0, 5),
    evidence: makeEvidence({
      period: input.period,
      comparisonPeriod,
      sampleSize,
      formulaVersion: MERCHANT_INTELLIGENCE_VERSION,
    }),
    confidence: confidenceFromSample(sampleSize, { minSample: 3, goodSample: 12 }),
  });
}

/**
 * Contrato determinístico de DISTRIBUIÇÃO por estabelecimento dentro de uma
 * categoria/período (`merchant_distribution.v1`).
 *
 * Regra inviolável: `share_of_category` = valor do merchant / TOTAL REAL da
 * categoria. Nunca sobre o subtotal dos merchants identificados — se a
 * cobertura é parcial, a resposta declara isso.
 */
export interface MerchantDistributionRow {
  merchant: string;
  amount: number;
  share_of_category: number;
  transactions_count: number;
}

export interface MerchantDistribution {
  period: { from: string; to: string; label?: string | null };
  category: { id: string | null; name: string | null };
  category_total: number;
  resolved_total: number;
  unresolved_total: number;
  coverage: number;
  merchants: MerchantDistributionRow[];
}

export function merchantDistribution(
  input: MerchantsInput & { categoryName?: string | null },
): MerchantDistribution {
  const resolver = input.resolver ?? buildMerchantResolver(input.aliases ?? []);
  const current = computeMerchantStats({ ...input, resolver });

  let categoryTotal = 0;
  for (const t of input.txs) {
    if (!isConsumptionExpense(t)) continue;
    if (!inRange(t.occurred_at, input.period)) continue;
    if (input.categoryId && (t.category_id ?? null) !== input.categoryId) continue;
    categoryTotal = round2(categoryTotal + Number(t.amount || 0));
  }

  const resolvedTotal = round2(current.reduce((s, m) => s + m.net_total, 0));
  const merchants = current
    .slice()
    .sort((a, b) => b.net_total - a.net_total)
    .slice(0, input.limit ?? 10)
    .map((m) => ({
      merchant: m.label,
      amount: m.net_total,
      share_of_category: categoryTotal > 0 ? round2(m.net_total / categoryTotal) : 0,
      transactions_count: m.count,
    }));

  return {
    period: { from: input.period.from, to: input.period.to, label: input.period.label ?? null },
    category: { id: input.categoryId ?? null, name: input.categoryName ?? null },
    category_total: categoryTotal,
    resolved_total: resolvedTotal,
    unresolved_total: round2(Math.max(0, categoryTotal - resolvedTotal)),
    coverage: categoryTotal > 0 ? round2(resolvedTotal / categoryTotal) : 0,
    merchants,
  };
}
