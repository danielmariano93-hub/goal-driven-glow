// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
// Motor de Mudança de Comportamento (`behavior_change.v1`).
// Decompõe a variação de gasto entre dois períodos em efeitos que SOMAM o delta:
// frequência, ticket, entrada e saída de estabelecimentos. O mix por dia da
// semana entra como leitura de apoio (não soma no delta, para não contar duas vezes).
import { behavioralMetricAmount, isRealMonthlyMovement, round2, effectiveCategoryId, buildRefundAttribution, type TransactionRow } from "./facts.ts";
import { buildMerchantResolver, type MerchantAliasRow, type MerchantResolver } from "./merchant.ts";
import { computeMerchantStats, type MerchantStats } from "./merchantIntelligence.ts";
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
} from "./engineEnvelope.ts";

export const BEHAVIOR_CHANGE_VERSION = "behavior_change.v1";

export interface BehaviorDriver {
  kind: "frequencia" | "ticket" | "novo_estabelecimento" | "saida_estabelecimento";
  label: string;
  merchant: string | null;
  amount: number;
  detail: string;
}

export interface CategoryChange {
  category_id: string | null;
  category_name: string;
  current: number;
  previous: number;
  delta_abs: number;
  delta_pct: number | null;
  frequency_effect: number;
  ticket_effect: number;
  new_merchants_effect: number;
  lost_merchants_effect: number;
  residual: number;
  drivers: BehaviorDriver[];
  current_count: number;
  previous_count: number;
}

export interface WeekdayMix {
  weekday: number;
  label: string;
  current_share: number;
  previous_share: number;
  share_delta: number;
  current_total: number;
  previous_total: number;
}

export interface BehaviorChangeFacts {
  current_total: number;
  previous_total: number;
  delta_abs: number;
  delta_pct: number | null;
  frequency_effect: number;
  ticket_effect: number;
  new_merchants_effect: number;
  lost_merchants_effect: number;
  residual: number;
  weekday_mix: WeekdayMix[];
  top_category: string | null;
}

export interface BehaviorChangeInput {
  txs: TransactionRow[];
  period: EnginePeriod;
  comparisonPeriod?: EnginePeriod | null;
  categoryNames?: Record<string, string>;
  aliases?: MerchantAliasRow[];
  resolver?: MerchantResolver;
  minCategoryDelta?: number;
}

function inRange(date: string, period: EnginePeriod): boolean {
  const d = date.slice(0, 10);
  return d >= period.from && d <= period.to;
}

function netExpenseByCategory(
  txs: TransactionRow[],
  period: EnginePeriod,
): { byCategory: Map<string, number>; countByCategory: Map<string, number>; total: number } {
  const attribution = buildRefundAttribution(txs);
  const byCategory = new Map<string, number>();
  const countByCategory = new Map<string, number>();
  let total = 0;
  for (const t of txs) {
    if (!inRange(t.occurred_at, period)) continue;
    const signed = behavioralMetricAmount(t, "expense");
    if (signed === 0) continue;
    const key = effectiveCategoryId(t, attribution) ?? "__none__";
    byCategory.set(key, round2((byCategory.get(key) ?? 0) + signed));
    if (signed > 0) countByCategory.set(key, (countByCategory.get(key) ?? 0) + 1);
    total = round2(total + signed);
  }
  return { byCategory, countByCategory, total };
}

function decomposeMerchants(
  current: MerchantStats[],
  previous: MerchantStats[],
): {
  frequency: number;
  ticket: number;
  entrants: number;
  exits: number;
  drivers: BehaviorDriver[];
} {
  const prevByKey = new Map(previous.map((m) => [m.key, m]));
  const curByKey = new Map(current.map((m) => [m.key, m]));
  let frequency = 0;
  let ticket = 0;
  let entrants = 0;
  let exits = 0;
  const drivers: BehaviorDriver[] = [];

  for (const m of current) {
    const p = prevByKey.get(m.key);
    if (!p || p.count === 0) {
      entrants = round2(entrants + m.net_total);
      if (m.net_total > 0) {
        drivers.push({
          kind: "novo_estabelecimento",
          label: m.label,
          merchant: m.label,
          amount: m.net_total,
          detail: `${m.label} apareceu agora: ${m.count} lançamento(s).`,
        });
      }
      continue;
    }
    const freqEffect = round2((m.count - p.count) * p.avg_ticket);
    const ticketEffect = round2(m.count * (m.avg_ticket - p.avg_ticket));
    frequency = round2(frequency + freqEffect);
    ticket = round2(ticket + ticketEffect);
    if (Math.abs(freqEffect) >= 1) {
      drivers.push({
        kind: "frequencia",
        label: m.label,
        merchant: m.label,
        amount: freqEffect,
        detail: `${m.label}: ${p.count} → ${m.count} vez(es).`,
      });
    }
    if (Math.abs(ticketEffect) >= 1) {
      drivers.push({
        kind: "ticket",
        label: m.label,
        merchant: m.label,
        amount: ticketEffect,
        detail: `${m.label}: ticket médio de ${p.avg_ticket.toFixed(2)} → ${m.avg_ticket.toFixed(2)}.`,
      });
    }
  }

  for (const p of previous) {
    if (curByKey.has(p.key)) continue;
    if (p.net_total <= 0) continue;
    exits = round2(exits - p.net_total);
    drivers.push({
      kind: "saida_estabelecimento",
      label: p.label,
      merchant: p.label,
      amount: round2(-p.net_total),
      detail: `${p.label} não apareceu neste período (antes: ${p.count} lançamento(s)).`,
    });
  }

  drivers.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return { frequency, ticket, entrants, exits, drivers };
}

function weekdayMix(
  txs: TransactionRow[],
  period: EnginePeriod,
  comparison: EnginePeriod,
): WeekdayMix[] {
  const cur = new Map<number, number>();
  const prev = new Map<number, number>();
  let curTotal = 0;
  let prevTotal = 0;
  for (const t of txs) {
    if (t.type !== "expense" || !isRealMonthlyMovement(t)) continue;
    const amount = round2(Number(t.amount || 0));
    const day = t.occurred_at.slice(0, 10);
    const wd = weekdayOf(day);
    if (inRange(day, period)) {
      cur.set(wd, round2((cur.get(wd) ?? 0) + amount));
      curTotal = round2(curTotal + amount);
    } else if (inRange(day, comparison)) {
      prev.set(wd, round2((prev.get(wd) ?? 0) + amount));
      prevTotal = round2(prevTotal + amount);
    }
  }
  const out: WeekdayMix[] = [];
  for (let wd = 0; wd < 7; wd += 1) {
    const c = cur.get(wd) ?? 0;
    const p = prev.get(wd) ?? 0;
    if (c === 0 && p === 0) continue;
    const cs = curTotal > 0 ? round2(c / curTotal) : 0;
    const ps = prevTotal > 0 ? round2(p / prevTotal) : 0;
    out.push({
      weekday: wd,
      label: WEEKDAY_LABELS_PT[wd],
      current_share: cs,
      previous_share: ps,
      share_delta: round2(cs - ps),
      current_total: c,
      previous_total: p,
    });
  }
  return out.sort((a, b) => Math.abs(b.share_delta) - Math.abs(a.share_delta));
}

/**
 * O que mudou no comportamento e exatamente por quê.
 * Garantia estrutural: `frequency + ticket + entrants + exits + residual = delta`.
 */
export function computeBehaviorChange(
  input: BehaviorChangeInput,
): EngineEnvelope<BehaviorChangeFacts, CategoryChange, BehaviorDriver> {
  const resolver = input.resolver ?? buildMerchantResolver(input.aliases ?? []);
  const comparisonPeriod = input.comparisonPeriod ?? previousWindow(input.period);
  const names = input.categoryNames ?? {};
  const minDelta = input.minCategoryDelta ?? 20;

  const cur = netExpenseByCategory(input.txs, input.period);
  const prev = netExpenseByCategory(input.txs, comparisonPeriod);

  const categoryKeys = new Set<string>([...cur.byCategory.keys(), ...prev.byCategory.keys()]);
  const categories: CategoryChange[] = [];

  for (const key of categoryKeys) {
    const current = cur.byCategory.get(key) ?? 0;
    const previous = prev.byCategory.get(key) ?? 0;
    const delta = round2(current - previous);
    if (Math.abs(delta) < minDelta) continue;

    const categoryId = key === "__none__" ? null : key;
    const curMerchants = computeMerchantStats({
      txs: input.txs,
      period: input.period,
      resolver,
      categoryId,
    });
    const prevMerchants = computeMerchantStats({
      txs: input.txs,
      period: comparisonPeriod,
      resolver,
      categoryId,
    });
    const parts = decomposeMerchants(curMerchants, prevMerchants);
    const explained = round2(parts.frequency + parts.ticket + parts.entrants + parts.exits);

    categories.push({
      category_id: categoryId,
      category_name: categoryId ? (names[categoryId] ?? "Categoria removida") : "Sem categoria",
      current,
      previous,
      delta_abs: delta,
      delta_pct: safePct(current, previous),
      frequency_effect: parts.frequency,
      ticket_effect: parts.ticket,
      new_merchants_effect: parts.entrants,
      lost_merchants_effect: parts.exits,
      residual: round2(delta - explained),
      drivers: parts.drivers.slice(0, 4),
      current_count: cur.countByCategory.get(key) ?? 0,
      previous_count: prev.countByCategory.get(key) ?? 0,
    });
  }

  categories.sort((a, b) => Math.abs(b.delta_abs) - Math.abs(a.delta_abs));

  const totalCurrent = cur.total;
  const totalPrevious = prev.total;
  const delta = round2(totalCurrent - totalPrevious);

  const globalCur = computeMerchantStats({ txs: input.txs, period: input.period, resolver });
  const globalPrev = computeMerchantStats({ txs: input.txs, period: comparisonPeriod, resolver });
  const global = decomposeMerchants(globalCur, globalPrev);
  const explained = round2(global.frequency + global.ticket + global.entrants + global.exits);

  const sampleSize = globalCur.reduce((s, m) => s + m.count, 0) + globalPrev.reduce((s, m) => s + m.count, 0);

  return makeEnvelope({
    engine: "behavior_change",
    facts: {
      current_total: totalCurrent,
      previous_total: totalPrevious,
      delta_abs: delta,
      delta_pct: safePct(totalCurrent, totalPrevious),
      frequency_effect: global.frequency,
      ticket_effect: global.ticket,
      new_merchants_effect: global.entrants,
      lost_merchants_effect: global.exits,
      residual: round2(delta - explained),
      weekday_mix: weekdayMix(input.txs, input.period, comparisonPeriod).slice(0, 3),
      top_category: categories[0]?.category_name ?? null,
    },
    breakdown: categories.slice(0, 6),
    drivers: global.drivers.slice(0, 6),
    evidence: makeEvidence({
      period: input.period,
      comparisonPeriod,
      sampleSize,
      formulaVersion: BEHAVIOR_CHANGE_VERSION,
      notes: [
        "Efeitos de frequência, ticket, entrada e saída de estabelecimentos somam a variação total.",
        "O resíduo aparece quando parte do gasto não tem estabelecimento identificável.",
      ],
    }),
    confidence: confidenceFromSample(sampleSize, { minSample: 6, goodSample: 24 }),
  });
}
