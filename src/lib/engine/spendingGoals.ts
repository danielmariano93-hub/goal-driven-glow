// Metas hierárquicas de gasto (`spending_goals.v1`).
//
// A meta continua sendo da CATEGORIA; submetas por estabelecimento mostram
// como o limite é consumido e onde está o desvio. Todo valor de uma submeta
// também compõe a meta principal — nunca há despesa em dobro.
//
// Mesma verdade canônica do teto por categoria:
//  - só despesa real (confirmada, sem transferência, fatura, investimento,
//    lançamento substituído), líquida de estornos;
//  - competência (`reporting_competence.v1`): compra de cartão pertence ao mês
//    da fatura;
//  - categoria efetiva (estorno herda a categoria da despesa original), então
//    recategorizar ou estornar recalcula meta e submeta automaticamente;
//  - estabelecimento pela identidade NORMALIZADA (`merchant_truth.v2`), nunca
//    pelo texto bruto do extrato.
//
// Módulo puro e determinístico: nenhuma dependência de I/O.

import {
  behavioralMetricAmount,
  buildRefundAttribution,
  effectiveCategoryId,
  isRealMonthlyMovement,
  reportingCompetenceDate,
  type TransactionRow,
} from "./facts";
import { buildMerchantResolver, merchantSourceText, type MerchantResolver } from "./merchant";

export const SPENDING_GOALS_VERSION = "spending_goals.v1";

export type MerchantTargetKind = "amount" | "percent_reduction" | "zero" | "track";

export interface MerchantTargetRow {
  id: string;
  goal_id: string;
  label: string;
  merchant_keys: string[];
  limit_kind: MerchantTargetKind;
  limit_amount?: number | null;
  reduction_pct?: number | null;
  baseline_amount?: number | null;
  computed_limit?: number | null;
  status: "active" | "paused" | "cancelled" | string;
}

export type SpendingLedgerTx = TransactionRow & {
  merchant_name?: string | null;
  friendly_description?: string | null;
  normalized_description?: string | null;
};

/** Um lançamento econômico já resolvido (competência, categoria e estabelecimento). */
export interface SpendingEntry {
  id: string;
  date: string;
  month: string;
  category_id: string | null;
  merchant_key: string;
  merchant_label: string;
  /** Positivo = despesa; negativo = estorno abatendo a despesa original. */
  amount: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const sumOf = (values: number[]) => values.reduce((acc, v) => acc + v, 0);
const brl = (n: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n || 0));
const pctText = (ratio: number) => `${Math.round(ratio * 100)}%`;

function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function meanOf(values: number[]): number {
  return values.length ? sumOf(values) / values.length : 0;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let m = first; m <= last && out.length < 120; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

function daysBetweenInclusive(start: string, end: string): number {
  const a = Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)));
  const b = Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, Number(end.slice(8, 10)));
  return Math.floor((b - a) / 86_400_000) + 1;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const MONTH_NAMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export function spendingMonthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} de ${y}`;
}

/** Limite mensal efetivo de uma submeta a partir do tipo escolhido. */
export function merchantTargetLimit(kind: MerchantTargetKind, args: { amount?: number | null; reductionPct?: number | null; baseline?: number | null }): number | null {
  if (kind === "track") return null;
  if (kind === "zero") return 0;
  if (kind === "amount") return args.amount != null && args.amount >= 0 ? round2(args.amount) : null;
  const base = Number(args.baseline ?? 0);
  const pct = Number(args.reductionPct ?? 0);
  if (!(base > 0) || !(pct > 0)) return null;
  return round2(base * (1 - Math.min(100, pct) / 100));
}

/**
 * Um mesmo estabelecimento chega com nomes de tamanhos diferentes:
 *  - truncado pelo débito ("HIROT", "VENDI") quando o histórico traz o nome
 *    completo ("Hirota Food Express", "Vendify");
 *  - com sufixo do boleto/adquirente ("L S Prado IN", "L S Prado
 *    Intermediacao N") quando existe a forma curta ("LS Prado").
 * Sem unir as variações, uma submeta seria burlada sem querer. Só une quando o
 * prefixo aponta para um único estabelecimento.
 */
const compactKey = (key: string) => key.replace(/\s/g, "");

function mergeTruncatedMerchants(ids: Array<{ key: string; label: string; truncated: boolean; normalized: boolean }>): Map<string, { key: string; label: string }> {
  const counts = new Map<string, { key: string; label: string; count: number; truncated: boolean; normalized: boolean }>();
  for (const id of ids) {
    const row = counts.get(id.key) ?? { key: id.key, label: id.label, count: 0, truncated: id.truncated, normalized: id.normalized };
    row.count += 1;
    counts.set(id.key, row);
  }
  const rows = [...counts.values()].filter((row) => !row.key.startsWith("raw:"));
  const out = new Map<string, { key: string; label: string }>();

  // 1) Forma truncada → nome completo.
  for (const row of rows) {
    if (!row.truncated) continue;
    const prefix = compactKey(row.key);
    if (prefix.length < 4) continue;
    const candidates = rows.filter((other) =>
      other.key !== row.key && !other.truncated
      && compactKey(other.key).length > prefix.length && compactKey(other.key).startsWith(prefix));
    const families = new Set(candidates.map((c) => compactKey(c.key).slice(0, prefix.length + 2)));
    if (!candidates.length || families.size > 1) continue;
    const best = candidates.sort((a, b) => b.count - a.count)[0];
    out.set(row.key, { key: best.key, label: best.label });
  }

  // 2) Variação com sufixo → forma curta mais específica (≥ 6 letras).
  for (const row of rows) {
    // Marca conhecida ou alias nunca é "variação" de outra (Amazon Prime ≠ Amazon).
    if (out.has(row.key) || !row.normalized) continue;
    const long = compactKey(row.key);
    const base = rows
      .filter((other) => other.key !== row.key && !other.truncated && !out.has(other.key))
      .filter((other) => {
        const short = compactKey(other.key);
        return short.length >= 6 && short.length < long.length && long.startsWith(short);
      })
      .sort((a, b) => compactKey(a.key).length - compactKey(b.key).length)[0];
    if (base) out.set(row.key, { key: base.key, label: base.label });
  }
  return out;
}

/**
 * Livro econômico canônico: uma linha por despesa/estorno, já com competência,
 * categoria efetiva e estabelecimento normalizado. O estorno herda o
 * estabelecimento da despesa original para abater a submeta certa.
 */
export function buildSpendingLedger(txs: SpendingLedgerTx[], resolver: MerchantResolver = buildMerchantResolver()): SpendingEntry[] {
  const attribution = buildRefundAttribution(txs);
  const identity = new Map<string, { key: string; label: string; truncated: boolean; normalized: boolean }>();
  const resolveTx = (t: SpendingLedgerTx) => {
    const cached = identity.get(t.id);
    if (cached) return cached;
    const text = merchantSourceText(t);
    const resolution = text ? resolver.resolve(text) : null;
    const raw = String(t.merchant_name || t.description || "").trim();
    const value = resolution
      ? {
        key: resolution.key,
        label: resolution.label,
        // Débito trunca o nome em ~5 letras: um token curto sem marca/alias.
        truncated: resolution.source === "normalized" && !resolution.key.includes(" ") && resolution.key.length <= 6,
        normalized: resolution.source === "normalized",
      }
      : { key: `raw:${raw.toLowerCase() || "sem_descricao"}`, label: raw || "Sem descrição", truncated: false, normalized: false };
    identity.set(t.id, value);
    return value;
  };
  const byId = new Map(txs.map((t) => [t.id, t]));
  for (const t of txs) resolveTx(t);
  const merged = mergeTruncatedMerchants([...identity.values()]);

  const out: SpendingEntry[] = [];
  for (const t of txs) {
    const refund = String(t.movement_kind ?? "") === "refund";
    const value = refund
      ? behavioralMetricAmount(t, "expense")
      : t.type === "expense" && isRealMonthlyMovement(t) ? Number(t.amount || 0) : 0;
    if (!value) continue;
    const original = refund && t.refund_of_transaction_id ? byId.get(t.refund_of_transaction_id) : undefined;
    const resolved = resolveTx(original ?? t);
    const merchant = merged.get(resolved.key) ?? resolved;
    const date = reportingCompetenceDate(t);
    out.push({
      id: t.id,
      date,
      month: date.slice(0, 7),
      category_id: effectiveCategoryId(t, attribution),
      merchant_key: merchant.key,
      merchant_label: merchant.label,
      amount: round2(value),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Acompanhamento da meta: submetas, "Outros", contribuição e projeção
// ---------------------------------------------------------------------------

export type MerchantTargetStatus =
  | "on_track"
  | "attention"
  | "at_risk"
  | "exceeded"
  | "zero_violated"
  | "monitoring"
  | "completed_ok"
  | "completed_over"
  | "paused";

export interface MerchantTargetEvaluation {
  id: string;
  label: string;
  merchant_keys: string[];
  limit_kind: MerchantTargetKind;
  limit: number | null;
  actual: number;
  remaining: number | null;
  pct_used: number | null;
  projected: number;
  projected_overage: number;
  /** Participação no gasto da categoria no período (0..1). */
  share_of_category: number;
  /** Referência mensal congelada na criação. */
  baseline: number | null;
  /** Economia frente à referência, pela projeção (negativa = gasto acima). */
  savings: number | null;
  status: MerchantTargetStatus;
  charges: number;
  last_charge: { date: string; amount: number } | null;
  daily_allowance: number | null;
  message: string;
}

export interface GoalBreakdown {
  version: typeof SPENDING_GOALS_VERSION;
  goal_id: string;
  category_id: string;
  period: { start: string; end: string };
  elapsed_days: number;
  total_days: number;
  remaining_days: number;
  /** Fração do período já transcorrida (0..1). */
  elapsed_share: number;
  /** Fração do limite da categoria já consumida (0..1+). */
  consumed_share: number;
  /** Consumo comparado ao tempo: à frente do ritmo, no ritmo ou abaixo. */
  pace: "ahead" | "on_pace" | "below";
  targets: MerchantTargetEvaluation[];
  others: { actual: number; share: number; budget: number | null; top: Array<{ label: string; amount: number }> };
  contributors: Array<{ key: string; label: string; amount: number; share: number; target_id: string | null }>;
  /** Quem mais explica o desvio: submeta mais acima do limite, senão o maior gasto. */
  main_driver: { label: string; amount: number; share: number; target_id: string | null; reason: "over_target" | "largest" } | null;
}

export interface GoalBreakdownInput {
  goal: { id: string; category_id: string; limit: number };
  period: { start: string; end: string };
  today: string;
  targets: MerchantTargetRow[];
  entries: SpendingEntry[];
}

function statusFor(args: {
  kind: MerchantTargetKind; limit: number | null; actual: number; projected: number; closed: boolean;
}): MerchantTargetStatus {
  const { kind, limit, actual, projected, closed } = args;
  if (kind === "track" || limit == null) return "monitoring";
  if (kind === "zero") return actual > 0.009 ? "zero_violated" : closed ? "completed_ok" : "on_track";
  if (closed) return actual <= limit ? "completed_ok" : "completed_over";
  if (actual > limit) return "exceeded";
  const over = projected - limit;
  if (over > Math.max(1, limit * 0.1)) return "at_risk";
  if (over > 0.009) return "attention";
  return "on_track";
}

function targetMessage(e: Omit<MerchantTargetEvaluation, "message">, remainingDays: number): string {
  switch (e.status) {
    case "zero_violated":
      return `${e.charges === 1 ? "Houve 1 cobrança" : `Houve ${e.charges} cobranças`} em ${e.label} (${brl(e.actual)}), mas a submeta é zero. Pode ser uma assinatura ainda ativa ou renovação automática.`;
    case "exceeded":
      return `${e.label} já passou o limite de ${brl(e.limit ?? 0)} em ${brl(e.actual - (e.limit ?? 0))}.`;
    case "at_risk":
    case "attention":
      return `No ritmo atual, ${e.label} fecha em ${brl(e.projected)}, ${brl(e.projected_overage)} acima do limite.${e.daily_allowance != null && remainingDays > 0 ? ` Para cumprir, o disponível é ${brl(e.daily_allowance)} por dia.` : ""}`;
    case "completed_ok":
      return `${e.label} fechou em ${brl(e.actual)}, dentro do limite.`;
    case "completed_over":
      return `${e.label} fechou em ${brl(e.actual)}, acima do limite de ${brl(e.limit ?? 0)}.`;
    case "monitoring":
      return `${e.label}: ${brl(e.actual)} no período (${pctText(e.share_of_category)} da categoria).`;
    case "paused":
      return `Submeta de ${e.label} pausada.`;
    default:
      return e.limit === 0
        ? `Nenhuma cobrança em ${e.label} no período.`
        : `${e.label}: ${brl(e.actual)} de ${brl(e.limit ?? 0)}; no ritmo, fecha em ${brl(e.projected)}.`;
  }
}

/** Histórico mensal (meses fechados antes do período) de um conjunto de chaves na categoria. */
function keyHistory(entries: SpendingEntry[], categoryId: string, keys: Set<string>, periodStart: string) {
  const firstMonth = shiftMonth(periodStart.slice(0, 7), -6);
  const lastMonth = shiftMonth(periodStart.slice(0, 7), -1);
  const totals = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.category_id !== categoryId || !keys.has(e.merchant_key)) continue;
    if (e.month < firstMonth || e.month > lastMonth) continue;
    totals.set(e.month, (totals.get(e.month) ?? 0) + e.amount);
    if (e.amount > 0) counts.set(e.month, (counts.get(e.month) ?? 0) + 1);
  }
  const months = monthsBetween(firstMonth, lastMonth);
  const present = months.filter((m) => (totals.get(m) ?? 0) > 0);
  return {
    monthlyMedian: medianOf(present.map((m) => totals.get(m) ?? 0)),
    monthlyAverage: meanOf(months.map((m) => Math.max(0, totals.get(m) ?? 0))),
    chargesPerMonth: present.length ? sumOf(present.map((m) => counts.get(m) ?? 0)) / present.length : 0,
    monthsPresent: present.length,
  };
}

/**
 * Projeção de fechamento de uma submeta. Cobrança fixa (≈1 por mês e presente
 * na maior parte dos meses) projeta pela cobrança; consumo contínuo mistura o
 * ritmo do período com o padrão histórico para não extrapolar uma compra só.
 */
function projectKeys(actual: number, history: ReturnType<typeof keyHistory>, elapsed: number, remaining: number, total: number): number {
  if (remaining <= 0) return round2(actual);
  const fixedLike = history.monthsPresent >= 3 && history.chargesPerMonth <= 1.5;
  if (fixedLike) return round2(actual > 0 ? actual : history.monthlyMedian);
  const historicalRate = history.monthlyAverage / Math.max(1, total);
  const currentRate = elapsed > 0 ? actual / elapsed : 0;
  const rate = elapsed >= 7
    ? (history.monthlyAverage > 0 ? 0.5 * currentRate + 0.5 * historicalRate : currentRate)
    : (history.monthlyAverage > 0 ? historicalRate : currentRate);
  return round2(actual + rate * remaining);
}

export function evaluateGoalBreakdown(input: GoalBreakdownInput): GoalBreakdown {
  const { goal, period, today } = input;
  const totalDays = Math.max(1, daysBetweenInclusive(period.start, period.end));
  const reference = today < period.end ? today : period.end;
  const elapsedDays = today < period.start ? 0 : Math.min(totalDays, daysBetweenInclusive(period.start, reference));
  const remainingDays = today < period.start ? totalDays : today >= period.end ? 0 : Math.max(0, totalDays - elapsedDays);
  const closed = today > period.end;

  const inPeriod = input.entries.filter((e) =>
    e.category_id === goal.category_id && e.date >= period.start && e.date <= period.end);
  const categoryActual = round2(Math.max(0, sumOf(inPeriod.map((e) => e.amount))));
  const denominator = categoryActual > 0 ? categoryActual : 1;

  const byKey = new Map<string, { label: string; amount: number; charges: number; last: { date: string; amount: number } | null }>();
  for (const e of inPeriod) {
    const row = byKey.get(e.merchant_key) ?? { label: e.merchant_label, amount: 0, charges: 0, last: null };
    row.amount += e.amount;
    if (e.amount > 0) {
      row.charges += 1;
      if (!row.last || e.date >= row.last.date) row.last = { date: e.date, amount: e.amount };
    }
    byKey.set(e.merchant_key, row);
  }

  const active = input.targets.filter((t) => t.status !== "cancelled" && t.goal_id === goal.id);
  const targetOfKey = new Map<string, string>();
  // Uma chave pertence a uma submeta só (a mais antiga vence): sem dupla contagem.
  for (const t of active) for (const k of t.merchant_keys) if (!targetOfKey.has(k)) targetOfKey.set(k, t.id);

  const targets: MerchantTargetEvaluation[] = active.map((t) => {
    const keys = new Set(t.merchant_keys.filter((k) => targetOfKey.get(k) === t.id));
    const rows = [...keys].map((k) => byKey.get(k)).filter(Boolean) as Array<NonNullable<ReturnType<typeof byKey.get>>>;
    const actual = round2(Math.max(0, sumOf(rows.map((r) => r.amount))));
    const charges = sumOf(rows.map((r) => r.charges));
    const last = rows.map((r) => r.last).filter(Boolean).sort((a, b) => (a!.date < b!.date ? 1 : -1))[0] ?? null;
    const history = keyHistory(input.entries, goal.category_id, keys, period.start);
    const projected = Math.max(actual, projectKeys(actual, history, elapsedDays, remainingDays, totalDays));
    const kind = t.limit_kind;
    const limit = kind === "track" ? null : kind === "zero" ? 0 : t.computed_limit ?? merchantTargetLimit(kind, {
      amount: t.limit_amount, reductionPct: t.reduction_pct, baseline: t.baseline_amount,
    });
    const paused = t.status === "paused";
    const status: MerchantTargetStatus = paused ? "paused" : statusFor({ kind, limit, actual, projected, closed });
    const baseline = t.baseline_amount != null ? round2(Number(t.baseline_amount)) : null;
    const partial: Omit<MerchantTargetEvaluation, "message"> = {
      id: t.id,
      label: t.label,
      merchant_keys: t.merchant_keys,
      limit_kind: kind,
      limit,
      actual,
      remaining: limit == null ? null : round2(limit - actual),
      pct_used: limit == null ? null : limit > 0 ? round2(actual / limit) : actual > 0 ? 1 : 0,
      projected: round2(projected),
      projected_overage: limit == null ? 0 : round2(Math.max(0, projected - limit)),
      share_of_category: round2(actual / denominator),
      baseline,
      savings: baseline == null ? null : round2(baseline - (closed ? actual : projected)),
      status,
      charges,
      last_charge: last,
      daily_allowance: limit != null && limit > 0 && remainingDays > 0 && actual < limit ? round2((limit - actual) / remainingDays) : null,
    };
    return { ...partial, message: targetMessage(partial, remainingDays) };
  });

  const othersRows = [...byKey.entries()].filter(([key]) => !targetOfKey.has(key));
  const othersActual = round2(Math.max(0, sumOf(othersRows.map(([, r]) => r.amount))));
  const limitedSum = sumOf(targets.map((t) => t.limit ?? 0));
  const hasLimited = targets.some((t) => t.limit != null);
  const othersBudget = hasLimited ? round2(Math.max(0, goal.limit - limitedSum - sumOf(targets.filter((t) => t.limit == null).map((t) => t.actual)))) : null;

  const contributors = [...byKey.entries()]
    .map(([key, r]) => ({ key, label: r.label, amount: round2(r.amount), share: round2(r.amount / denominator), target_id: targetOfKey.get(key) ?? null }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  const overTarget = targets
    .filter((t) => t.limit != null && (t.status === "exceeded" || t.status === "at_risk" || t.status === "attention" || t.status === "zero_violated" || t.status === "completed_over"))
    .sort((a, b) => (Math.max(b.projected_overage, b.actual - (b.limit ?? 0))) - (Math.max(a.projected_overage, a.actual - (a.limit ?? 0))))[0];
  const main_driver = overTarget
    ? { label: overTarget.label, amount: overTarget.actual, share: overTarget.share_of_category, target_id: overTarget.id, reason: "over_target" as const }
    : contributors[0]
      ? { label: contributors[0].label, amount: contributors[0].amount, share: contributors[0].share, target_id: contributors[0].target_id, reason: "largest" as const }
      : null;

  const elapsedShare = round2(elapsedDays / totalDays);
  const consumedShare = goal.limit > 0 ? round2(categoryActual / goal.limit) : 0;
  const pace = consumedShare > elapsedShare + 0.1 ? "ahead" : consumedShare < elapsedShare - 0.1 ? "below" : "on_pace";

  return {
    version: SPENDING_GOALS_VERSION,
    goal_id: goal.id,
    category_id: goal.category_id,
    period,
    elapsed_days: elapsedDays,
    total_days: totalDays,
    remaining_days: remainingDays,
    elapsed_share: elapsedShare,
    consumed_share: consumedShare,
    pace,
    targets,
    others: {
      actual: othersActual,
      share: round2(othersActual / denominator),
      budget: othersBudget,
      top: othersRows.filter(([, r]) => r.amount > 0).sort((a, b) => b[1].amount - a[1].amount).slice(0, 3)
        .map(([, r]) => ({ label: r.label, amount: round2(r.amount) })),
    },
    contributors,
    main_driver,
  };
}

// ---------------------------------------------------------------------------
// Análise do histórico: categorias críticas, estabelecimentos e recomendação
// ---------------------------------------------------------------------------

/** Grupos de estabelecimentos semelhantes que costumam ser controlados juntos. */
export const MERCHANT_GROUPS: Array<{ id: string; label: string; keys: string[] }> = [
  { id: "mobility", label: "Apps de transporte", keys: ["uber", "99"] },
  { id: "delivery", label: "Delivery", keys: ["ifood", "99 food", "rappi", "uber eats"] },
  { id: "streaming", label: "Streaming", keys: ["netflix", "spotify", "disney+", "hbo max", "amazon prime", "youtube"] },
  { id: "tech", label: "Ferramentas de tecnologia", keys: ["chatgpt", "lovable", "github", "google"] },
];

/** A chave pertence ao grupo? ("99food" e "99 food" são o mesmo estabelecimento.) */
export function merchantInGroup(group: { keys: string[] }, key: string): boolean {
  const k = compactKey(key);
  return group.keys.some((member) => compactKey(member) === k);
}

/** Categorias de obrigação: entram na análise, mas o Nino não sugere cortá-las. */
export function isObligationCategory(name: string): boolean {
  return OBLIGATION_RX.test(name);
}
const OBLIGATION_RX = /d[ií]vida|empr[eé]stimo|financiamento|d[ií]zimo|oferta|doa[cç]|imposto|tributo|moradia|aluguel|condom[ií]nio|investiment|educa[cç]|escola|faculdade|sa[uú]de|seguro|pens[aã]o|tarifa|juros/i;

export type MerchantBehavior = "fixed" | "habit" | "sporadic";

export interface MerchantHistoryProfile {
  key: string;
  label: string;
  /** Média mensal na janela (inclui meses sem gasto). */
  monthly_average: number;
  share: number;
  months_present: number;
  charges_per_month: number;
  behavior: MerchantBehavior;
  /** Custo fixo de assinatura/serviço que vale revisar se ainda é usado. */
  review: boolean;
}

export interface SuggestedMerchantTarget {
  label: string;
  merchant_keys: string[];
  limit_kind: MerchantTargetKind;
  limit: number | null;
  reduction_pct: number | null;
  baseline: number;
  rationale: string;
}

export interface CategorySpendingAdvice {
  category_id: string;
  name: string;
  discretionary: boolean;
  months: Array<{ month: string; amount: number }>;
  average: number;
  median: number;
  recent_average: number;
  /** Referência recomendada: período recente pesa mais que o histórico. */
  reference: number;
  max: { month: string; amount: number } | null;
  min: { month: string; amount: number } | null;
  trend: { direction: "up" | "down" | "stable"; pct: number };
  atypical: Array<{ month: string; amount: number }>;
  fixed_floor: number;
  recommended_limit: number;
  reduction_pct: number;
  potential_monthly: number;
  impact: { m3: number; m6: number; m12: number };
  merchants: MerchantHistoryProfile[];
  suggested_targets: SuggestedMerchantTarget[];
  existing_goal_id: string | null;
  summary: string;
}

export interface SpendingHistoryAdvice {
  version: typeof SPENDING_GOALS_VERSION;
  as_of: string;
  months_analyzed: number;
  categories: CategorySpendingAdvice[];
  total_potential_monthly: number;
  total_impact_12m: number;
}

export interface SpendingHistoryInput {
  entries: SpendingEntry[];
  categories: Array<{ id: string; name: string }>;
  today: string;
  /** Metas de categoria ativas (para não sugerir duplicata). */
  activeGoals?: Array<{ id: string; category_id: string }>;
  monthsBack?: number;
  /** Só estas categorias (pedido direto do usuário). */
  onlyCategoryIds?: string[];
}

function roundLimit(value: number): number {
  if (value <= 0) return 0;
  const step = value < 300 ? 10 : value < 2000 ? 50 : 100;
  return Math.round(value / step) * step;
}

function profileMerchants(entries: SpendingEntry[], months: string[], categoryId: string, categoryName: string): MerchantHistoryProfile[] {
  const window = months.slice(-6);
  const windowSet = new Set(window);
  const map = new Map<string, { label: string; totals: Map<string, number>; counts: Map<string, number> }>();
  for (const e of entries) {
    if (e.category_id !== categoryId || !windowSet.has(e.month)) continue;
    const row = map.get(e.merchant_key) ?? { label: e.merchant_label, totals: new Map(), counts: new Map() };
    row.totals.set(e.month, (row.totals.get(e.month) ?? 0) + e.amount);
    if (e.amount > 0) row.counts.set(e.month, (row.counts.get(e.month) ?? 0) + 1);
    map.set(e.merchant_key, row);
  }
  const categoryTotal = sumOf([...map.values()].flatMap((r) => [...r.totals.values()]));
  const subscriptionCategory = /assinatura|servi[cç]o|streaming|software/i.test(categoryName);
  const reviewKeys = new Set(MERCHANT_GROUPS.filter((g) => g.id === "streaming" || g.id === "tech").flatMap((g) => g.keys.map(compactKey)));
  return [...map.entries()].map(([key, r]) => {
    const values = window.map((m) => Math.max(0, r.totals.get(m) ?? 0));
    const present = window.filter((m) => (r.totals.get(m) ?? 0) > 0);
    const chargesPerMonth = present.length ? sumOf(present.map((m) => r.counts.get(m) ?? 0)) / present.length : 0;
    const presentValues = present.map((m) => r.totals.get(m) ?? 0);
    const mean = meanOf(presentValues);
    const cv = mean > 0 ? Math.sqrt(meanOf(presentValues.map((v) => (v - mean) ** 2))) / mean : 0;
    const behavior: MerchantBehavior = present.length >= Math.min(4, window.length) && chargesPerMonth <= 1.5 && cv <= 0.25
      ? "fixed"
      : present.length >= 3 ? "habit" : "sporadic";
    const total = sumOf(values);
    return {
      key,
      label: r.label,
      monthly_average: round2(total / Math.max(1, window.length)),
      share: categoryTotal > 0 ? round2(total / categoryTotal) : 0,
      months_present: present.length,
      charges_per_month: round2(chargesPerMonth),
      behavior,
      review: behavior === "fixed" && (subscriptionCategory || reviewKeys.has(compactKey(key))),
    };
  }).filter((m) => m.monthly_average > 0).sort((a, b) => b.monthly_average - a.monthly_average);
}

function suggestTargets(merchants: MerchantHistoryProfile[]): SuggestedMerchantTarget[] {
  const used = new Set<string>();
  const candidates: Array<{ label: string; keys: string[]; monthly: number; share: number; behavior: MerchantBehavior; review: boolean }> = [];
  for (const group of MERCHANT_GROUPS) {
    const members = merchants.filter((m) => merchantInGroup(group, m.key));
    if (members.length < 2) continue;
    members.forEach((m) => used.add(m.key));
    candidates.push({
      label: members.map((m) => m.label).join(" + "),
      keys: members.map((m) => m.key),
      monthly: round2(sumOf(members.map((m) => m.monthly_average))),
      share: round2(sumOf(members.map((m) => m.share))),
      behavior: members.some((m) => m.behavior === "habit") ? "habit" : members[0].behavior,
      review: members.every((m) => m.review),
    });
  }
  for (const m of merchants) {
    if (used.has(m.key) || m.key.startsWith("raw:")) continue;
    candidates.push({ label: m.label, keys: [m.key], monthly: m.monthly_average, share: m.share, behavior: m.behavior, review: m.review });
  }
  return candidates
    .filter((c) => c.monthly >= 50 && (c.share >= 0.12 || c.review))
    .sort((a, b) => b.monthly - a.monthly)
    .slice(0, 3)
    .flatMap<SuggestedMerchantTarget>((c) => {
      if (c.behavior === "habit") {
        const limit = roundLimit(c.monthly * 0.7);
        return [{
          label: c.label, merchant_keys: c.keys, limit_kind: "percent_reduction", limit, reduction_pct: 30, baseline: c.monthly,
          rationale: `Gasto frequente de ${brl(c.monthly)} por mês (${pctText(c.share)} da categoria). Reduzir 30% libera ${brl(c.monthly - limit)} por mês.`,
        }];
      }
      if (c.behavior === "fixed") {
        return [{
          label: c.label, merchant_keys: c.keys, limit_kind: "track", limit: null, reduction_pct: null, baseline: c.monthly,
          rationale: c.review
            ? `Cobrança fixa de ${brl(c.monthly)} por mês. Se não usa mais, dá para zerar e economizar ${brl(c.monthly * 12)} em um ano.`
            : `Cobrança fixa de ${brl(c.monthly)} por mês: acompanhar evita reajuste despercebido.`,
        }];
      }
      if (c.share >= 0.3) {
        return [{
          label: c.label, merchant_keys: c.keys, limit_kind: "track", limit: null, reduction_pct: null, baseline: c.monthly,
          rationale: `Gasto pontual, mas pesou ${pctText(c.share)} da categoria nos últimos meses.`,
        }];
      }
      return [];
    });
}

/**
 * Analisa o histórico completo e propõe metas: o histórico mostra padrão e
 * sazonalidade; o período recente pesa mais na sugestão porque representa
 * melhor o comportamento atual.
 */
export function analyzeSpendingHistory(input: SpendingHistoryInput): SpendingHistoryAdvice {
  const current = input.today.slice(0, 7);
  const lastClosed = shiftMonth(current, -1);
  const monthsBack = Math.max(3, Math.min(24, input.monthsBack ?? 12));
  const firstData = input.entries.reduce<string | null>((min, e) => (e.amount > 0 && (!min || e.month < min) ? e.month : min), null);
  const floorMonth = shiftMonth(current, -monthsBack);
  const windowStart = firstData && firstData > floorMonth ? firstData : floorMonth;
  const months = windowStart <= lastClosed ? monthsBetween(windowStart, lastClosed) : [];
  const monthSet = new Set(months);
  const names = new Map(input.categories.map((c) => [c.id, c.name]));
  const goalByCategory = new Map((input.activeGoals ?? []).map((g) => [g.category_id, g.id]));
  const only = input.onlyCategoryIds?.length ? new Set(input.onlyCategoryIds) : null;

  const totals = new Map<string, Map<string, number>>();
  for (const e of input.entries) {
    if (!e.category_id || !monthSet.has(e.month) || !names.has(e.category_id)) continue;
    if (only && !only.has(e.category_id)) continue;
    const row = totals.get(e.category_id) ?? new Map<string, number>();
    row.set(e.month, (row.get(e.month) ?? 0) + e.amount);
    totals.set(e.category_id, row);
  }

  const categories: CategorySpendingAdvice[] = [];
  for (const [categoryId, byMonth] of totals.entries()) {
    const name = names.get(categoryId) ?? "Categoria";
    const series = months.map((m) => ({ month: m, amount: round2(Math.max(0, byMonth.get(m) ?? 0)) }));
    const values = series.map((s) => s.amount);
    if (sumOf(values) <= 0) continue;
    const median = medianOf(values);
    const mad = medianOf(values.map((v) => Math.abs(v - median)));
    const atypical = series.filter((s) => s.amount > median + 2.5 * Math.max(mad, median * 0.1) && s.amount > 1.5 * median && median > 0);
    const atypicalSet = new Set(atypical.map((a) => a.month));
    const clean = series.filter((s) => !atypicalSet.has(s.month));
    const recent = clean.slice(-3).map((s) => s.amount);
    const recentAverage = meanOf(recent);
    const cleanMedian = medianOf(clean.map((s) => s.amount));
    const reference = round2(recent.length ? 0.6 * recentAverage + 0.4 * cleanMedian : cleanMedian);
    const prior = clean.slice(-6, -3).map((s) => s.amount);
    const priorAverage = meanOf(prior);
    const trendPct = priorAverage > 0 ? round2((recentAverage - priorAverage) / priorAverage) : 0;
    const direction = !prior.length || Math.abs(trendPct) < 0.15 ? "stable" : trendPct > 0 ? "up" : "down";
    const sortedByAmount = [...series].filter((s) => s.amount > 0).sort((a, b) => b.amount - a.amount);

    const merchants = profileMerchants(input.entries, months, categoryId, name);
    const fixedFloor = round2(sumOf(merchants.filter((m) => m.behavior === "fixed").map((m) => m.monthly_average)));
    // Categoria só de custo fixo continua acompanhável quando há assinatura a revisar.
    const discretionary = !OBLIGATION_RX.test(name)
      && (reference <= 0 || fixedFloor / reference < 0.7 || merchants.some((m) => m.review));
    const reductionTarget = !discretionary ? 0 : direction === "up" ? 0.2 : 0.15;
    const variable = Math.max(0, reference - fixedFloor);
    // O corte sai da parte variável (no máximo 40% dela); custo fixo não some com limite.
    const cut = Math.min(reductionTarget * reference, 0.4 * variable);
    const recommended = discretionary ? Math.max(roundLimit(fixedFloor), roundLimit(reference - cut)) : roundLimit(reference);
    const potential = round2(Math.max(0, reference - recommended));
    const suggested = discretionary ? suggestTargets(merchants) : [];
    const trendText = direction === "up" ? `subindo ${pctText(Math.abs(trendPct))} nos últimos 3 meses` : direction === "down" ? `caindo ${pctText(Math.abs(trendPct))} nos últimos 3 meses` : "estável";
    const top = merchants.slice(0, 2).map((m) => `${m.label} (${pctText(m.share)})`).join(" e ");

    categories.push({
      category_id: categoryId,
      name,
      discretionary,
      months: series,
      average: round2(meanOf(values)),
      median: round2(median),
      recent_average: round2(recentAverage),
      reference,
      max: sortedByAmount[0] ?? null,
      min: sortedByAmount[sortedByAmount.length - 1] ?? null,
      trend: { direction, pct: trendPct },
      atypical,
      fixed_floor: fixedFloor,
      recommended_limit: recommended,
      reduction_pct: reference > 0 ? round2((reference - recommended) / reference) : 0,
      potential_monthly: potential,
      impact: { m3: round2(potential * 3), m6: round2(potential * 6), m12: round2(potential * 12) },
      merchants: merchants.slice(0, 6),
      suggested_targets: suggested,
      existing_goal_id: goalByCategory.get(categoryId) ?? null,
      summary: discretionary && potential <= 0
        ? `${name}: ${brl(reference)} por mês, ${trendText}.${top ? ` Quem mais explica: ${top}.` : ""} Quase tudo é cobrança fixa: a economia vem de cancelar o que você não usa mais.`
        : discretionary
        ? `${name}: referência de ${brl(reference)} por mês, ${trendText}.${top ? ` Quem mais explica: ${top}.` : ""} Um limite de ${brl(recommended)} economiza ${brl(potential)} por mês (${brl(potential * 12)} em 12 meses).`
        : `${name}: ${brl(reference)} por mês, ${trendText}. É um gasto de obrigação ou fixo, então o Nino acompanha sem sugerir corte.`,
    });
  }

  categories.sort((a, b) => Number(b.discretionary) - Number(a.discretionary) || b.potential_monthly - a.potential_monthly || b.reference - a.reference);
  const totalPotential = round2(sumOf(categories.filter((c) => c.discretionary).map((c) => c.potential_monthly)));
  return {
    version: SPENDING_GOALS_VERSION,
    as_of: input.today,
    months_analyzed: months.length,
    categories,
    total_potential_monthly: totalPotential,
    total_impact_12m: round2(totalPotential * 12),
  };
}

// ---------------------------------------------------------------------------
// Comunicação: fim de semana, fechamento semanal e mensal
// ---------------------------------------------------------------------------

/**
 * Quanto do saldo da meta cabe no próximo fim de semana, respeitando o peso
 * que o fim de semana costuma ter nessa categoria. Só existe quando o fim de
 * semana é, de fato, mais caro (≥ 1,4× um dia útil) nos últimos 90 dias.
 */
export function weekendAllowance(args: {
  entries: SpendingEntry[];
  categoryId: string;
  today: string;
  period: { start: string; end: string };
  remainingBudget: number;
}): { weekend_days: string[]; allowance: number; weekend_weight: number } | null {
  if (!(args.remainingBudget > 0)) return null;
  const since = addDaysIso(args.today, -90);
  let weekendSum = 0;
  let weekdaySum = 0;
  for (const e of args.entries) {
    if (e.category_id !== args.categoryId || e.date < since || e.date > args.today || e.amount <= 0) continue;
    const dow = new Date(`${e.date}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 5 || dow === 6) weekendSum += e.amount; else weekdaySum += e.amount;
  }
  const weekendPerDay = weekendSum / 3;
  const weekdayPerDay = weekdaySum / 4;
  if (!(weekendPerDay > 0) || weekendPerDay < 1.4 * weekdayPerDay) return null;
  const weight = weekdayPerDay > 0 ? weekendPerDay / weekdayPerDay : 3;

  const days: string[] = [];
  for (let d = addDaysIso(args.today, 1); d <= args.period.end && days.length < 40; d = addDaysIso(d, 1)) days.push(d);
  const isWeekend = (d: string) => [0, 5, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
  const firstWeekend = days.findIndex(isWeekend);
  if (firstWeekend < 0) return null;
  const weekendDays: string[] = [];
  for (let i = firstWeekend; i < days.length && isWeekend(days[i]) && weekendDays.length < 3; i += 1) weekendDays.push(days[i]);
  const totalWeight = sumOf(days.map((d) => (isWeekend(d) ? weight : 1)));
  const allowance = round2(args.remainingBudget * (weekendDays.length * weight) / Math.max(1, totalWeight));
  return { weekend_days: weekendDays, allowance, weekend_weight: round2(weight) };
}

export interface ClosedCycleSummary {
  goal_id: string;
  month: string;
  limit: number;
  actual: number;
  met: boolean;
  /** Economia frente à referência histórica (baseline da meta). */
  savings: number | null;
  best_target: { label: string; savings: number } | null;
  targets: Array<{ label: string; actual: number; limit: number | null; met: boolean | null; savings: number | null }>;
  text: string;
}

/** Fechamento mensal de uma meta: cumpriu? de onde veio a economia? */
export function summarizeClosedCycle(args: {
  goal: { id: string; category_id: string; limit: number; baseline: number | null; name: string };
  month: string;
  targets: MerchantTargetRow[];
  entries: SpendingEntry[];
}): ClosedCycleSummary {
  const [y, m] = args.month.split("-").map(Number);
  const period = { start: `${args.month}-01`, end: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
  const breakdown = evaluateGoalBreakdown({
    goal: { id: args.goal.id, category_id: args.goal.category_id, limit: args.goal.limit },
    period,
    today: addDaysIso(period.end, 1),
    targets: args.targets,
    entries: args.entries,
  });
  const actual = round2(Math.max(0, sumOf(args.entries
    .filter((e) => e.category_id === args.goal.category_id && e.date >= period.start && e.date <= period.end)
    .map((e) => e.amount))));
  const met = actual <= args.goal.limit;
  const savings = args.goal.baseline != null && args.goal.baseline > 0 ? round2(args.goal.baseline - actual) : null;
  const targets = breakdown.targets.map((t) => ({
    label: t.label,
    actual: t.actual,
    limit: t.limit,
    met: t.limit == null ? null : t.actual <= t.limit,
    savings: t.baseline == null ? null : round2(t.baseline - t.actual),
  }));
  const best = targets.filter((t) => (t.savings ?? 0) > 0).sort((a, b) => (b.savings ?? 0) - (a.savings ?? 0))[0];
  const monthName = spendingMonthLabel(args.month).split(" de ")[0];
  const text = met
    ? `A meta de ${args.goal.name} em ${monthName} foi cumprida: ${brl(actual)} de ${brl(args.goal.limit)}.${best ? ` A maior contribuição veio de ${best.label}.` : ""}${savings != null && savings > 0 ? ` Economia de ${brl(savings)} frente à sua referência.` : ""}`
    : `${args.goal.name} fechou ${monthName} em ${brl(actual)}, ${brl(actual - args.goal.limit)} acima do limite de ${brl(args.goal.limit)}.${breakdown.main_driver ? ` O principal responsável foi ${breakdown.main_driver.label}.` : ""}`;
  return {
    goal_id: args.goal.id,
    month: args.month,
    limit: args.goal.limit,
    actual,
    met,
    savings,
    best_target: best ? { label: best.label, savings: best.savings ?? 0 } : null,
    targets,
    text,
  };
}
