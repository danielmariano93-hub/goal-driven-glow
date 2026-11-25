// GERADO POR scripts/sync-finance-core.mjs — NÃO EDITAR À MÃO.
// Fonte canônica: src/lib/engine/<module>.ts (finance_contract.v4)
/* eslint-disable @typescript-eslint/no-explicit-any */
// Relatórios inteligentes (`report_v2`): o mês contado em quatro perguntas, sobre UMA base de consumo.
//
//   A. O que aconteceu?            consumo, habitual, receitas, resultado, saldo, curva
//   B. O que mudou no comportamento? categorias, estabelecimentos, fixos x ajustáveis, fatores, dia da semana
//   C. Para onde estou indo?       projeção de consumo e de caixa, compromissos, a receber, poupança
//   D. Estou evoluindo?            resultado mensal, patrimônio, metas
//   E. O que fazer agora?          recomendações priorizadas
//
// Definição canônica de CONSUMO (uma só, em todas as telas):
//   gasto do livro por competência, líquido de estornos vinculados;
//   fora: pagamento de fatura, transferências, aplicações e a AMORTIZAÇÃO de principal de dívida
//   (que aparece à parte como "dívida paga"); dentro: juros e encargos.
// Cada lançamento de consumo cai em exatamente uma classe (fixo, ajustável, extraordinário ou sem categoria),
// então as partes sempre somam o total. Módulo puro e determinístico, sem I/O; espelhado para as Edge Functions.
import type { DashEntry } from "./reportDashboard.ts";

export const REPORT_V2_VERSION = "report_v2.1";

export type Klass = "estrutural" | "ajustavel" | "extraordinario" | "nao_classificado";
export type CompareKind = "previous" | "year" | "none";

// ---------------------------------------------------------------------------
// Entradas
// ---------------------------------------------------------------------------

export interface V2Entry extends DashEntry {
  id?: string;
  /** Pagamento de dívida/empréstimo (o valor inteiro está em `amount`). */
  debt_payment?: boolean;
}

export interface DebtSplit { principal: number; interest: number }

export interface V2Inputs {
  today: string;
  /** YYYY-MM do mês contado. */
  month: string;
  compare: CompareKind;
  entries: V2Entry[];
  /** `debt_payments` por id de lançamento: o que amortizou e o que foi juros/encargos. */
  debtSplits: Record<string, DebtSplit>;
  /** Classificador de flexibilidade por nome de categoria (o mesmo do perfil financeiro). */
  isStructuralCategory: (name: string) => boolean;
  profile: ProfileLite | null;
  /** `financial_current_snapshots.payload.snapshot`, só se for de hoje. */
  snapshot: any | null;
  monthlyFact: { accountIn: number; accountOut: number; externalIn: number; externalOut: number } | null;
  receivables: ReceivableRow[];
  commitmentMonths: CommitmentMonth[];
  patterns: PatternRow[];
  situationActions: SituationActionRow[];
  savingsGoalIds: string[];
  netWorthSeries: Array<{ month: string; value: number }>;
  /** Movimentos de conta do mês (entradas e saídas de caixa por tipo), sem transferência entre contas próprias. */
  cashMovements?: Array<{ dir: "in" | "out"; key: string; amount: number }>;
  /** Última previsão gravada de cada mês (para comparar previsto x realizado). */
  projectionHistory?: Array<{ month: string; asOf: string; projectedConsumption: number | null; projectedEnd: number | null }>;
  /** Ações aceitas/dispensadas pelo usuário. */
  recommendationActions?: Array<{ month: string; recKey: string; kind: string; title: string; action: "accepted" | "dismissed"; merchantKey: string | null; category: string | null; baselineAmount: number | null; monthlyImpact: number | null }>;
}

export interface ProfileLite {
  asOf: string;
  closedMonths: number;
  incomeBaseline: number | null;
  savingsRateMedian: number | null;
  sustainableMonthlySaving: number | null;
  recoverableMonthly: number | null;
  netWorth: number | null;
  confidence: string | null;
  flexibleSources: Array<{ label: string; baseline_monthly: number; observed_monthly: number; recoverable_monthly: number }>;
}

export interface ReceivableRow { balance: number; dueDate: string; state: string; paidAmount: number; paidAt: string | null }
export interface CommitmentMonth { month: string; cards: number; debts: number; recurring: number }
export interface PatternRow { label: string; status: string; upliftPct: number | null; absoluteDelta: number | null; sampleSize: number; confidence: number | null; coverage: number | null }
export interface SituationActionRow { key: string; title: string; explanation: string | null; impact: number | null; route: string | null; confidence: number | null }

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

export interface ClassTotals { estrutural: number; ajustavel: number; extraordinario: number; nao_classificado: number }

export interface HabitualV2 { value: number; months: string[]; deltaAbs: number; deltaPct: number | null }

export interface CurvePoint { day: number; current: number; habitual: number }
export interface ProjectionPoint { day: number; value: number; low: number; high: number }

export interface OverviewV2 {
  consumption: number;
  classes: ClassTotals;
  /** Principal de dívida amortizado no período (fora do consumo). */
  debtPaid: number;
  /** Estornos que abateram o consumo. */
  refunds: number;
  habitual: HabitualV2 | null;
  income: { realized: number; recurring: number; extraordinary: number; typical: number; incomplete: boolean; expected: { amount: number; date: string } | null };
  /** Resultado = receitas realizadas − consumo. `partial` = a renda do mês ainda não entrou por inteiro. */
  result: { value: number; partial: boolean; reason: "income_pending" | null };
  /** Ponte do consumo: despesas do período − estornos = consumo (fecha em centavos). */
  reconciliation: { gross: number; refunds: number; consumption: number };
  /** Frase de diagnóstico do mês, montada só com fatos do próprio relatório. */
  headline: string;
  /** As três maiores causas da diferença contra o habitual. */
  causes: DriverRow[];
  /** Ponte do caixa do mês: saldo inicial (derivado) + entradas − saídas = saldo hoje. Só no mês corrente com retrato do dia. */
  cashBridge: { opening: number; inflows: Array<{ label: string; amount: number }>; outflows: Array<{ label: string; amount: number }>; closing: number; openingDerived: true } | null;
  /** Dívida paga no período: fora do consumo, com a lista do que entrou e se os juros são conhecidos. */
  debt: { paid: number; items: DebtItem[]; unsplit: number };
  balance: { available: number | null; asOf: string | null };
  /** Frases que ligam consumo, resultado, caixa e saldo. */
  bridge: string[];
  curve: CurvePoint[] | null;
  curveProjection: ProjectionPoint[] | null;
  windowDays: number;
}

export interface CategoryRowV2 {
  id: string | null;
  name: string;
  klass: Klass;
  total: number;
  share: number;
  count: number;
  ticket: number | null;
  previous: number;
  deltaAbs: number;
  deltaPct: number | null;
  merchants: MerchantRowV2[];
}

export interface MerchantRowV2 {
  key: string;
  label: string;
  category: string;
  total: number;
  count: number;
  ticket: number | null;
  previous: number;
  deltaAbs: number;
  deltaPct: number | null;
}

export interface DriverRow { name: string; impact: number; klass: Klass }

export interface WeekdayRowV2 { dow: number; label: string; avg: number; habitualAvg: number | null; days: number }

export interface BehaviorV2 {
  categories: CategoryRowV2[];
  merchants: MerchantRowV2[];
  /** Quando a comparação não existe (sem base), vem nula. */
  previousLabel: string | null;
  /** Dias comparados no período anterior (mesmos dias do mês). */
  previousRange: { start: string; end: string } | null;
  /** Base do habitual usada nos fatores. */
  habitualBase: { months: number } | null;
  split: { classes: ClassTotals; total: number } ;
  drivers: { rows: DriverRow[]; totalDelta: number; residual: number } | null;
  weekday: {
    rows: WeekdayRowV2[]; peakDow: number; weekend: { weekendAvg: number; weekdayAvg: number; pct: number } | null;
    /** Janela e amostra do cálculo, e se o padrão se repete nos meses de referência. */
    sample: { days: number; refMonths: number; observations: number };
    persistence: { months: number; withPattern: number } | null;
    habitualWeekend: { weekendAvg: number; weekdayAvg: number } | null;
  } | null;
  signals: Signal[];
  smallSpend: { ceiling: number; total: number; count: number; share: number; topMerchants: Array<{ label: string; total: number; count: number }>; history: Array<{ month: string; total: number }> } | null;
  patterns: Array<{ label: string; status: string; upliftPct: number | null; absoluteDelta: number | null; sampleSize: number; confidence: number | null }>;
  priceChanges: Array<{ key: string; label: string; from: number; to: number; deltaAbs: number; deltaPct: number }>;
}

export interface ProjectionStep { key: string; label: string; value: number; sign: "start" | "plus" | "minus" | "result"; uncertain?: boolean }

export interface ProjectionsV2 {
  consumption: { realized: number; structuralPending: number; structuralItems: Array<{ label: string; amount: number; date: string }>; adjustableFuture: number; total: number; low: number; high: number; method: string } | null;
  cash: { freeCash: number | null; steps: ProjectionStep[]; projectedEnd: number; conservativeEnd: number; reconciles: boolean; expectedIncome: { amount: number; date: string; label: string; configured: boolean } | null; uncertainReceivables: number } | null;
  commitments: { next30: number; groups: Array<{ key: "cards" | "debts" | "recurring"; amount: number; estimated?: boolean }>; months: CommitmentMonth[]; hasEstimates: boolean; horizonEnd: string | null } | null;
  committedIncome: { pct: number; income: number; obligations: number; basis: string } | null;
  receivables: { toDue: number; overdue: number; receivedInPeriod: number; count: number } | null;
  savings: { monthly: number | null; status: "ok" | "zero_real" | "insufficient_history" | "stale"; closedMonths: number; incomeBaseline: number | null; savingsRateMedian: number | null } | null;
  recoverable: { monthly: number; sources: Array<{ label: string; monthly: number }> } | null;
}

export interface EvolutionMonth { month: string; income: number; consumption: number; debtPaid: number; result: number; open: boolean; partial: boolean }

export interface ForecastRow { month: string; asOf: string; predictedConsumption: number | null; actualConsumption: number; consumptionErrorPct: number | null; predictedEnd: number | null }
export interface TrackedAction { key: string; title: string; kind: string; acceptedMonth: string; baseline: number; current: number; delta: number; status: "reduzindo" | "sem_mudanca" | "aumentou" | "sem_dado" }

export interface EvolutionV2 {
  /** Previsão gravada x realizado dos meses fechados. */
  forecast: ForecastRow[];
  /** Ações aceitas e o que mudou desde o ponto de partida. */
  tracked: TrackedAction[];
  months: EvolutionMonth[];
  netWorth: {
    series: Array<{ month: string; value: number }>; current: number | null; label: string;
    composition: { asOf: string; cash: number; invested: number; assets: number; cardsOwed: number; otherDebts: number; liabilities: number; net: number } | null;
  } | null;
  goals: {
    spending: Array<{ id: string; category: string; spent: number; limit: number; pct: number; status: string; projectedPct: number | null; daysRemaining: number | null; verdict: "no_ritmo" | "atencao" | "vai_estourar" | "estourou" }>;
    savings: Array<{ id: string; name: string; target: number; contributed: number; pct: number; remaining: number }>;
    summary: string | null;
  };
}

export interface Recommendation {
  key: string;
  kind: "merchant" | "price" | "small_spend" | "weekend" | "recoverable" | "situation";
  /** `saving` = reduz gasto (impacto estimado); `cash` = organiza o caixa, sem economia mensurável. */
  nature: "saving" | "cash";
  title: string;
  body: string;
  /** De onde vem o número (baseline e premissa). Sem premissa, não há impacto. */
  basis: string;
  monthlyImpact: number;
  /** Chave do estabelecimento (quando a ação é sobre um) e valor de partida, para medir depois. */
  merchantKey?: string | null;
  baselineAmount?: number | null;
  category?: string | null;
  confidence: number;
  score: number;
  route: string | null;
  routeLabel: string | null;
}

export interface QualityNote { code: string; level: "info" | "warn"; text: string; /** indicadores afetados (números da especificação) */ affects?: string[]; /** o que fazer para corrigir */ fix?: string }

export interface Signal { key: string; title: string; evidence: string; sample: string; confidence: "alta" | "media" | "baixa"; query: { category?: string } | null }

export interface ReportMeta {
  formulaVersion: string;
  asOf: string;
  competenceRule: string;
  /** Cobertura: o que sustenta os números. */
  coverage: { categorizedShare: number; historyMonths: number; debtSplitShare: number | null; snapshotFresh: boolean };
  previousVersionNote: string;
}

export interface ReportV2 {
  version: typeof REPORT_V2_VERSION;
  month: string;
  today: string;
  isCurrentMonth: boolean;
  overview: OverviewV2 | null;
  behavior: BehaviorV2 | null;
  projections: ProjectionsV2;
  evolution: EvolutionV2;
  recommendations: { items: Recommendation[] };
  quality: QualityNote[];
  meta: ReportMeta;
}

// ---------------------------------------------------------------------------
// Datas e estatística
// ---------------------------------------------------------------------------

const DAY = 86_400_000;
const toMs = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const monthOf = (iso: string) => iso.slice(0, 7);
const dayOfMonth = (iso: string) => Number(iso.slice(8, 10));
const daysInMonth = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const shiftMonth = (ym: string, d: number) => {
  const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + d;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
const weekdayIndex = (iso: string) => (new Date(toMs(iso)).getUTCDay() + 6) % 7; // 0 = segunda
const isoOf = (ym: string, d: number) => `${ym}-${String(d).padStart(2, "0")}`;
const brlTxt = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
const WEEKDAY_LABEL = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Só estabelecimentos reconhecíveis: PIX/transferência para pessoa e descrição longa de intermediário ficam de fora. */
export function isDisplayableMerchant(label: string | null | undefined): boolean {
  const text = String(label ?? "").trim();
  if (text.length < 2 || text.length > 28) return false;
  return !/\b(pix|ted|doc|transfer\w*|enviado|recebido|pagamento|sociedade|financiamento)\b/i.test(text);
}

export const SMALL_SPEND_CEILING = 50;
export const HABITUAL_MAX_MONTHS = 6;
export const HABITUAL_MIN_MONTHS = 3;
const EXTRAORDINARY_FLOOR = 500;

// ---------------------------------------------------------------------------
// Classificação do consumo
// ---------------------------------------------------------------------------

export interface Cls {
  date: string;
  month: string;
  day: number;
  /** Parte que conta como consumo (negativa em estorno). */
  amount: number;
  klass: Klass;
  categoryId: string | null;
  category: string;
  merchantKey: string | null;
  merchant: string | null;
  chartDay: string | null;
  /** Encargo de dívida (juros e taxas). */
  charge: boolean;
}

export interface DebtItem { date: string; label: string; amount: number; principal: number; interest: number; /** juros/encargos conhecidos pelo registro da dívida */ split: boolean; /** categoria de dívida sem registro de pagamento de dívida */ fromCategory: boolean }

export interface ClassifyResult {
  debtItems: DebtItem[];
  rows: Cls[];
  debtPaidByMonth: Map<string, number>;
  debtUnsplit: number;
  incomeRows: Array<{ date: string; month: string; amount: number; category: string }>;
}

/** Categoria de dívida/empréstimo/financiamento: pagamento de dívida lançado como despesa comum (ex.: Pix para financeira). */
export const isDebtCategoryName = (name: string | null | undefined): boolean => /d[ií]vid|empr[eé]stim|financiamento|consignado|credi[aá]rio/i.test(String(name ?? ""));

export function classifyLedger(entries: V2Entry[], debtSplits: Record<string, DebtSplit>, isStructural: (name: string) => boolean, referenceMonth: string): ClassifyResult {
  const rows: Cls[] = [];
  const debtItems: DebtItem[] = [];
  const debtPaidByMonth = new Map<string, number>();
  const incomeRows: ClassifyResult["incomeRows"] = [];
  let debtUnsplit = 0;
  const addDebt = (m: string, v: number) => debtPaidByMonth.set(m, round2((debtPaidByMonth.get(m) ?? 0) + v));

  for (const e of entries) {
    const month = monthOf(e.date);
    if (e.kind === "income") { if (e.amount > 0) incomeRows.push({ date: e.date, month, amount: e.amount, category: e.category || "Receita" }); continue; }
    if (e.kind !== "expense" || e.amount === 0) continue;
    const base = { date: e.date, month, day: dayOfMonth(e.date), categoryId: e.category_id, merchantKey: e.merchant_key, merchant: e.merchant, chartDay: e.chart_carried ? null : (e.chart_date ?? e.date) };
    const fromCategory = !e.debt_payment && e.amount > 0 && e.category_id != null && isDebtCategoryName(e.category);
    if (e.debt_payment || fromCategory) {
      const split = e.id ? debtSplits[e.id] : undefined;
      const label = e.merchant ?? e.category ?? "Dívida";
      if (split && split.principal + split.interest > 0) {
        addDebt(month, split.principal);
        debtItems.push({ date: e.date, label, amount: e.amount, principal: round2(split.principal), interest: round2(split.interest), split: true, fromCategory });
        if (split.interest > 0) rows.push({ ...base, amount: round2(split.interest), klass: "estrutural", category: "Juros e encargos de dívida", categoryId: null, merchantKey: null, merchant: null, charge: true });
      } else {
        // Sem separação de juros: o pagamento inteiro fica fora do consumo (não se inventa juros) e a lacuna é declarada.
        addDebt(month, e.amount);
        if (e.amount > 0) debtUnsplit += e.amount;
        debtItems.push({ date: e.date, label, amount: e.amount, principal: round2(e.amount), interest: 0, split: false, fromCategory });
      }
      continue;
    }
    const name = e.category_id ? e.category || "Sem categoria" : "Sem categoria";
    const klass: Klass = e.category_id == null ? "nao_classificado" : isStructural(name) ? "estrutural" : "ajustavel";
    rows.push({ ...base, amount: e.amount, klass, category: name, charge: false });
  }

  // Compra atípica: sai de "ajustável" para "extraordinário" (valor muito acima do padrão do próprio usuário).
  const window = rows.filter((r) => r.klass === "ajustavel" && r.amount > 0 && r.month < referenceMonth && r.month >= shiftMonth(referenceMonth, -6)).map((r) => r.amount).sort((a, b) => a - b);
  let fence = Number.POSITIVE_INFINITY;
  if (window.length >= 12) fence = Math.max(EXTRAORDINARY_FLOOR, quantile(window, 0.75) + 3 * (quantile(window, 0.75) - quantile(window, 0.25)));
  if (Number.isFinite(fence)) for (const r of rows) if (r.klass === "ajustavel" && r.amount >= fence) r.klass = "extraordinario";

  return { rows, debtPaidByMonth, debtUnsplit: round2(debtUnsplit), incomeRows, debtItems };
}

const emptyClasses = (): ClassTotals => ({ estrutural: 0, ajustavel: 0, extraordinario: 0, nao_classificado: 0 });
const sumClasses = (c: ClassTotals) => c.estrutural + c.ajustavel + c.extraordinario + c.nao_classificado;
const roundClasses = (c: ClassTotals): ClassTotals => ({ estrutural: round2(c.estrutural), ajustavel: round2(c.ajustavel), extraordinario: round2(c.extraordinario), nao_classificado: round2(c.nao_classificado) });

/** Consumo de um mês, do dia 1 até `upTo`, por classe. */
function monthClasses(rows: Cls[], month: string, upTo: number): ClassTotals {
  const c = emptyClasses();
  for (const r of rows) if (r.month === month && r.day <= upTo) c[r.klass] += r.amount;
  return c;
}

// ---------------------------------------------------------------------------
// Construção
// ---------------------------------------------------------------------------

export function buildReportV2(input: V2Inputs): ReportV2 {
  const { today, month } = input;
  const thisMonth = monthOf(today);
  const isCurrentMonth = month === thisMonth;
  const windowDays = isCurrentMonth ? dayOfMonth(today) : daysInMonth(month);
  const cls = classifyLedger(input.entries, input.debtSplits, input.isStructuralCategory, month);
  const rows = cls.rows;
  const quality: QualityNote[] = [];

  // ---- Meses de referência do habitual ----------------------------------------
  const refCandidates = Array.from({ length: HABITUAL_MAX_MONTHS }, (_, i) => shiftMonth(month, -(i + 1)));
  const refMonths = refCandidates.filter((m) => rows.some((r) => r.month === m && r.amount > 0)).sort();
  const windowOf = (m: string) => Math.min(windowDays, daysInMonth(m));
  const haveHabitual = refMonths.length >= 2;
  const totalOf = (m: string, upTo: number) => sumClasses(monthClasses(rows, m, upTo));

  const classes = monthClasses(rows, month, windowDays);
  const consumption = round2(sumClasses(classes));
  const refunds = round2(rows.filter((r) => r.month === month && r.day <= windowDays && r.amount < 0).reduce((a, r) => a - r.amount, 0));
  const gross = round2(rows.filter((r) => r.month === month && r.day <= windowDays && r.amount > 0).reduce((a, r) => a + r.amount, 0));
  const debtPaid = round2(Array.from({ length: 1 }, () => cls.debtPaidByMonth.get(month) ?? 0)[0]);

  let habitual: HabitualV2 | null = null;
  if (haveHabitual) {
    const v = median(refMonths.map((m) => totalOf(m, windowOf(m))));
    if (v > 0) habitual = { value: round2(v), months: refMonths, deltaAbs: round2(consumption - v), deltaPct: Math.round(((consumption - v) / v) * 1000) / 1000 };
  }
  if (refMonths.length > 0 && refMonths.length < HABITUAL_MIN_MONTHS) quality.push({ code: "habitual_thin", level: "info", text: `O habitual usa ${refMonths.length} meses de histórico; fica mais firme com ${HABITUAL_MIN_MONTHS} ou mais.` });
  if (refMonths.length === 0) quality.push({ code: "habitual_none", level: "info", text: "Ainda não há histórico para comparar com o seu habitual." });

  // ---- Receitas ----------------------------------------------------------------
  const incomeOf = (m: string, upTo: number) => cls.incomeRows.filter((r) => r.month === m && dayOfMonth(r.date) <= upTo);
  const incomeRealizedRows = incomeOf(month, windowDays);
  const realizedIncome = round2(incomeRealizedRows.reduce((a, r) => a + r.amount, 0));
  const priorIncomeMonths = refCandidates.map((m) => round2(cls.incomeRows.filter((r) => r.month === m).reduce((a, r) => a + r.amount, 0))).filter((v) => v > 0);
  const typicalIncome = round2(median(priorIncomeMonths));
  const recurringCategories = new Set<string>();
  for (const cat of new Set(cls.incomeRows.map((r) => r.category))) {
    const monthsWith = refCandidates.filter((m) => cls.incomeRows.some((r) => r.month === m && r.category === cat)).length;
    if (monthsWith >= 3) recurringCategories.add(cat);
  }
  const recurringIncome = round2(incomeRealizedRows.filter((r) => recurringCategories.has(r.category)).reduce((a, r) => a + r.amount, 0));
  const incomplete = isCurrentMonth && typicalIncome > 0 && realizedIncome < typicalIncome * 0.5;

  // ---- Resultado operacional -----------------------------------------------------
  const result = { value: round2(realizedIncome - consumption), partial: incomplete, reason: incomplete ? ("income_pending" as const) : null };

  // ---- Saldo e ponte ---------------------------------------------------------------
  const snapshot = input.snapshot;
  const available = snapshot ? num(snapshot.availableToday) : null;
  const futureIncome = (Array.isArray(snapshot?.projection?.estimatedIncomeEvents) ? snapshot.projection.estimatedIncomeEvents : [])
    .filter((e: any) => typeof e?.date === "string" && e.date >= today && (num(e.amount) ?? 0) > 0).sort((x: any, y: any) => (x.date < y.date ? -1 : 1))[0];
  const expectedIncome = futureIncome ? { amount: round2(num(futureIncome.amount) ?? 0), date: String(futureIncome.date) } : null;
  const bridge: string[] = [];
  if (isCurrentMonth) {
    if (incomplete) bridge.push(`A renda do mês ainda não entrou${expectedIncome ? ` (R$ ${Math.round(expectedIncome.amount).toLocaleString("pt-BR")} previstos para ${expectedIncome.date.slice(8, 10)}/${expectedIncome.date.slice(5, 7)})` : ` (costuma ser R$ ${Math.round(typicalIncome).toLocaleString("pt-BR")})`}, então o resultado é parcial: só consumo e receitas já realizadas.`);
    if (input.monthlyFact && input.monthlyFact.externalIn > 0) bridge.push(`Entraram R$ ${Math.round(input.monthlyFact.externalIn).toLocaleString("pt-BR")} em transferências de fora: movimentam o caixa, mas não são receita.`);
    if (debtPaid > 0) bridge.push(`Você pagou R$ ${Math.round(debtPaid).toLocaleString("pt-BR")} de principal de dívida: sai do caixa, mas não é consumo.`);
    if (available != null) bridge.push("O saldo disponível vem de meses anteriores e dos movimentos de caixa; ele não é o resultado do mês.");
  }

  // ---- Curva acumulada ---------------------------------------------------------------
  const cumulativeOf = (m: string, upTo: number) => {
    const perDay = new Array<number>(32).fill(0);
    for (const r of rows) if (r.month === m && r.day <= upTo) perDay[r.day] += r.amount;
    let run = 0;
    const out: number[] = [];
    for (let d = 1; d <= upTo; d += 1) { run += perDay[d]; out.push(run); }
    return out;
  };
  let curve: CurvePoint[] | null = null;
  if (habitual) {
    const cur = cumulativeOf(month, windowDays);
    const refs = refMonths.map((m) => {
      const own = cumulativeOf(m, windowOf(m));
      return Array.from({ length: windowDays }, (_, i) => own[Math.min(i, own.length - 1)] ?? 0);
    });
    curve = cur.map((v, i) => ({ day: i + 1, current: round2(v), habitual: round2(median(refs.map((r) => r[i]))) }));
  }

  // Ponte do caixa: o saldo inicial é derivado (saldo de hoje − movimento líquido do mês); a ponte mostra o que moveu o caixa.
  const CASH_LABEL: Record<string, string> = {
    in_income: "Receitas (renda e outras)", in_external: "Transferências recebidas de fora", in_loan: "Empréstimos recebidos", in_refund: "Estornos e reembolsos", in_invest: "Resgates e rendimentos", in_other: "Outras entradas",
    out_spend: "Gastos à vista e no débito", out_debt: "Dívidas pagas", out_card: "Fatura do cartão paga", out_external: "Transferências enviadas para fora", out_invest: "Aplicações", out_other: "Outras saídas",
  };
  let cashBridge: OverviewV2["cashBridge"] = null;
  if (isCurrentMonth && available != null && (input.cashMovements?.length ?? 0) > 0) {
    const sum = (dir: "in" | "out") => {
      const by = new Map<string, number>();
      for (const m of input.cashMovements ?? []) if (m.dir === dir) by.set(m.key, (by.get(m.key) ?? 0) + m.amount);
      return [...by.entries()].map(([k, v]) => ({ label: CASH_LABEL[k] ?? k, amount: round2(v) })).filter((x) => x.amount !== 0).sort((x, y) => y.amount - x.amount);
    };
    const inflows = sum("in"); const outflows = sum("out");
    const net = inflows.reduce((t, x) => t + x.amount, 0) - outflows.reduce((t, x) => t + x.amount, 0);
    cashBridge = { opening: round2(available - net), inflows, outflows, closing: round2(available), openingDerived: true };
  }
  const overview: OverviewV2 | null = consumption === 0 && rows.every((r) => r.month !== month) && realizedIncome === 0 && debtPaid === 0
    ? null
    : {
        consumption, classes: roundClasses(classes), debtPaid, refunds, habitual,
        income: { realized: realizedIncome, recurring: recurringIncome, extraordinary: round2(realizedIncome - recurringIncome), typical: typicalIncome, incomplete, expected: incomplete ? expectedIncome : null },
        result, reconciliation: { gross, refunds, consumption }, headline: "", causes: [], cashBridge, debt: { paid: debtPaid, items: cls.debtItems.filter((d) => monthOf(d.date) === month && dayOfMonth(d.date) <= windowDays), unsplit: round2(cls.debtItems.filter((d) => !d.split && monthOf(d.date) === month && dayOfMonth(d.date) <= windowDays).reduce((a, d) => a + d.amount, 0)) }, balance: { available, asOf: snapshot ? today : null }, bridge, curve, curveProjection: null, windowDays,
      };

  // ---- Comportamento ---------------------------------------------------------------------
  const previousMonth = input.compare === "year" ? shiftMonth(month, -12) : shiftMonth(month, -1);
  const prevUpTo = Math.min(windowDays, daysInMonth(previousMonth));
  const hasPrevious = input.compare !== "none" && rows.some((r) => r.month === previousMonth);
  const behavior = buildBehavior({ rows, month, windowDays, previousMonth: hasPrevious ? previousMonth : null, prevUpTo, refMonths, windowOf, habitual, input, classes, consumption, incomeRows: cls.incomeRows });
  if (behavior && hasPrevious) behavior.previousRange = { start: isoOf(previousMonth, 1), end: isoOf(previousMonth, prevUpTo) };

  // ---- Projeções ---------------------------------------------------------------------------
  const projections = buildProjections({ rows, month, today, windowDays, isCurrentMonth, refMonths, windowOf, consumption, classes, snapshot, input, cls, realizedIncome, typicalIncome, quality });
  if (overview && habitual && projections.consumption && curve) {
    const c = projections.consumption;
    const total = daysInMonth(month);
    const last = curve[curve.length - 1];
    const span = Math.max(1, total - windowDays);
    overview.curveProjection = [{ day: last.day, value: last.current, low: last.current, high: last.current }];
    for (let d = windowDays + 1; d <= total; d += 1) {
      const t = (d - windowDays) / span;
      overview.curveProjection.push({ day: d, value: round2(last.current + (c.total - last.current) * t), low: round2(last.current + (c.low - last.current) * t), high: round2(last.current + (c.high - last.current) * t) });
    }
  }

  // ---- Evolução ----------------------------------------------------------------------------
  const evolution = buildEvolution({ rows, cls, month, today, isCurrentMonth, input, snapshot, typicalIncome, behavior });

  // ---- Recomendações -----------------------------------------------------------------------
  const recommendations = buildRecommendations({ behavior, projections, input, month });
  if (overview) {
    overview.headline = makeHeadline(overview, isCurrentMonth);
    overview.causes = (behavior?.drivers?.rows ?? []).slice(0, 3);
  }

  // ---- Qualidade ---------------------------------------------------------------------------
  const cats = rows.filter((r) => r.month === month && r.day <= windowDays && r.amount > 0);
  const totalPos = cats.reduce((a, r) => a + r.amount, 0);
  const uncategorized = cats.filter((r) => r.klass === "nao_classificado").reduce((a, r) => a + r.amount, 0);
  if (totalPos > 0 && uncategorized / totalPos >= 0.1) quality.push({ code: "uncategorized", level: "warn", affects: ["07 Categorias", "08 Fixos e ajustáveis", "09 Fatores"], fix: "Categorize os lançamentos sem categoria em Movimentos.", text: `R$ ${Math.round(uncategorized).toLocaleString("pt-BR")} (${Math.round((uncategorized / totalPos) * 100)}%) dos gastos estão sem categoria, então comparações por categoria e a divisão entre fixos e ajustáveis ficam menos precisas.` });
  if (cls.debtUnsplit > 0) {
    const unsplitMonth = overview?.debt.unsplit ?? 0;
    quality.push({
      code: "debt_unsplit", level: "info",
      text: `${unsplitMonth > 0 ? `Neste mês, R$ ${Math.round(unsplitMonth).toLocaleString("pt-BR")} de pagamentos de dívida não informam juros e encargos; no histórico são R$ ${Math.round(cls.debtUnsplit).toLocaleString("pt-BR")}.` : `Pagamentos de dívida do histórico (R$ ${Math.round(cls.debtUnsplit).toLocaleString("pt-BR")}) não informam juros e encargos.`} Eles ficam inteiros fora do consumo; os juros reais, se houver, não estão contados.`,
      affects: ["01 Consumo", "02 Habitual", "04 Resultado", "09 Fatores", "20 Resultado histórico"],
      fix: "Ao registrar o pagamento da dívida, informe quanto foi juros e encargos. Pagamentos lançados só como despesa comum precisam ser registrados como pagamento de dívida.",
    });
  }
  if (isCurrentMonth && !snapshot) quality.push({ code: "snapshot_stale", level: "warn", text: "A previsão de caixa e os compromissos ainda não foram atualizados hoje; saldo e projeções ficam indisponíveis até a próxima atualização." });
  if (input.profile) {
    const age = Math.round((toMs(today) - toMs(input.profile.asOf)) / DAY);
    if (age > 3) quality.push({ code: "profile_stale", level: "warn", text: `O perfil financeiro (poupança sustentável e gasto recuperável) foi calculado há ${age} dias.` });
  }

  const debtMonthItems = cls.debtItems;
  const meta: ReportMeta = {
    formulaVersion: REPORT_V2_VERSION,
    asOf: today,
    competenceRule: "Despesa pelo dia do lançamento; compra no cartão pelo mês da fatura (competência). Estornos abatem o consumo.",
    coverage: {
      categorizedShare: totalPos > 0 ? Math.round(((totalPos - uncategorized) / totalPos) * 1000) / 1000 : 1,
      historyMonths: refMonths.length,
      debtSplitShare: debtMonthItems.length > 0 ? Math.round((debtMonthItems.filter((d) => d.split).length / debtMonthItems.length) * 1000) / 1000 : null,
      snapshotFresh: Boolean(snapshot),
    },
    previousVersionNote: "Versão anterior contava o pagamento de dívida inteiro como consumo e não abatia estornos; a atual separa o principal da dívida e abate estornos, por isso o consumo é menor.",
  };
  return {
    version: REPORT_V2_VERSION, month, today, isCurrentMonth, overview, behavior, projections, evolution, recommendations, quality, meta,
  };
}

// ---------------------------------------------------------------------------
// B. Comportamento
// ---------------------------------------------------------------------------

function buildBehavior(a: {
  rows: Cls[]; month: string; windowDays: number; previousMonth: string | null; prevUpTo: number; refMonths: string[]; windowOf: (m: string) => number;
  habitual: HabitualV2 | null; input: V2Inputs; classes: ClassTotals; consumption: number; incomeRows: ClassifyResult["incomeRows"];
}): BehaviorV2 | null {
  const { rows, month, windowDays, previousMonth, prevUpTo } = a;
  const cur = rows.filter((r) => r.month === month && r.day <= windowDays);
  if (cur.length === 0) return null;
  const prev = previousMonth ? rows.filter((r) => r.month === previousMonth && r.day <= prevUpTo) : [];

  // Categorias
  type CatAcc = { id: string | null; name: string; klass: Klass; total: number; count: number; previous: number; merchants: Map<string, { label: string; total: number; count: number; previous: number }> };
  const cats = new Map<string, CatAcc>();
  const touch = (r: Cls) => {
    const k = r.categoryId ?? `__${r.category}`;
    let c = cats.get(k);
    if (!c) { c = { id: r.categoryId, name: r.category, klass: r.klass, total: 0, count: 0, previous: 0, merchants: new Map() }; cats.set(k, c); }
    return c;
  };
  const addMerchant = (c: CatAcc, r: Cls, side: "total" | "previous") => {
    if (!r.merchantKey || !isDisplayableMerchant(r.merchant)) return;
    const m = c.merchants.get(r.merchantKey) ?? { label: r.merchant ?? r.merchantKey, total: 0, count: 0, previous: 0 };
    m[side] += r.amount;
    if (side === "total" && r.amount > 0) m.count += 1;
    c.merchants.set(r.merchantKey, m);
  };
  for (const r of cur) { const c = touch(r); c.total += r.amount; if (r.amount > 0) c.count += 1; addMerchant(c, r, "total"); }
  for (const r of prev) { const c = touch(r); c.previous += r.amount; addMerchant(c, r, "previous"); }

  const total = a.consumption > 0 ? a.consumption : 1;
  const allMerchants: MerchantRowV2[] = [];
  const categories: CategoryRowV2[] = [...cats.values()].filter((c) => c.total > 0).sort((x, y) => y.total - x.total).map((c) => {
    const merchants: MerchantRowV2[] = [...c.merchants.entries()].filter(([, m]) => m.total > 0).map(([key, m]) => ({
      key, label: m.label, category: c.name, total: round2(m.total), count: m.count, ticket: m.count > 0 ? round2(m.total / m.count) : null,
      previous: round2(Math.max(0, m.previous)), deltaAbs: round2(m.total - Math.max(0, m.previous)),
      deltaPct: previousMonth && m.previous > 0 ? Math.round(((m.total - m.previous) / m.previous) * 1000) / 1000 : null,
    })).sort((x, y) => y.total - x.total);
    allMerchants.push(...merchants);
    return {
      id: c.id, name: c.name, klass: c.klass, total: round2(c.total), share: Math.round((c.total / total) * 1000) / 1000, count: c.count,
      ticket: c.count > 0 ? round2(c.total / c.count) : null, previous: round2(Math.max(0, c.previous)), deltaAbs: round2(c.total - Math.max(0, c.previous)),
      deltaPct: previousMonth && c.previous > 0 ? Math.round(((c.total - c.previous) / c.previous) * 1000) / 1000 : null, merchants: merchants.slice(0, 8),
    };
  });
  // Estabelecimentos: soma entre categorias onde o mesmo aparece
  const mAgg = new Map<string, MerchantRowV2>();
  for (const m of allMerchants) {
    const cur2 = mAgg.get(m.key);
    if (!cur2) { mAgg.set(m.key, { ...m }); continue; }
    cur2.total = round2(cur2.total + m.total); cur2.count += m.count; cur2.previous = round2(cur2.previous + m.previous);
    cur2.ticket = cur2.count > 0 ? round2(cur2.total / cur2.count) : null;
    cur2.deltaAbs = round2(cur2.total - cur2.previous);
    cur2.deltaPct = previousMonth && cur2.previous > 0 ? Math.round(((cur2.total - cur2.previous) / cur2.previous) * 1000) / 1000 : null;
  }
  const merchants = [...mAgg.values()].sort((x, y) => y.total - x.total);

  // Fatores de mudança: impacto por categoria contra o habitual, com resíduo declarado (a referência é mediana)
  let drivers: BehaviorV2["drivers"] = null;
  if (a.habitual) {
    const perCat = new Map<string, { name: string; cur: number; refs: number[]; klass: Klass }>();
    const addRef = (m: string, r: Cls) => {
      const k = r.categoryId ?? `__${r.category}`;
      const e = perCat.get(k) ?? { name: r.category, cur: 0, refs: new Array(a.refMonths.length).fill(0), klass: r.klass };
      e.refs[a.refMonths.indexOf(m)] += r.amount;
      perCat.set(k, e);
    };
    for (const r of rows) if (a.refMonths.includes(r.month) && r.day <= a.windowOf(r.month)) addRef(r.month, r);
    for (const r of cur) { const k = r.categoryId ?? `__${r.category}`; const e = perCat.get(k) ?? { name: r.category, cur: 0, refs: new Array(a.refMonths.length).fill(0), klass: r.klass }; e.klass = r.klass; e.cur += r.amount; perCat.set(k, e); }
    const impacts: DriverRow[] = [...perCat.values()].map((e) => ({ name: e.name, impact: round2(e.cur - median(e.refs)), klass: e.klass })).filter((d) => Math.abs(d.impact) >= 1);
    const sumImpacts = impacts.reduce((s, d) => s + d.impact, 0);
    const totalDelta = a.habitual.deltaAbs;
    impacts.sort((x, y) => Math.abs(y.impact) - Math.abs(x.impact));
    drivers = { rows: impacts.slice(0, 6), totalDelta: round2(totalDelta), residual: round2(totalDelta - impacts.slice(0, 6).reduce((s, d) => s + d.impact, 0)) };
    void sumImpacts;
  }

  // Dia da semana: consumo ajustável / dias do mesmo tipo no período (incluindo dias sem gasto)
  let weekday: BehaviorV2["weekday"] = null;
  if (windowDays >= 14) {
    const adj = (r: Cls) => r.klass === "ajustavel" && (r.chartDay ?? r.date) >= `${month}-01`;
    const sums = new Array<number>(7).fill(0);
    const counts = new Array<number>(7).fill(0);
    for (let d = 1; d <= windowDays; d += 1) counts[weekdayIndex(isoOf(month, d))] += 1;
    for (const r of cur) if (adj(r) && r.chartDay) sums[weekdayIndex(r.chartDay)] += r.amount;
    const hist = new Array<number>(7).fill(0);
    const histDays = new Array<number>(7).fill(0);
    for (const m of a.refMonths) {
      const upTo = a.windowOf(m);
      for (let d = 1; d <= upTo; d += 1) histDays[weekdayIndex(isoOf(m, d))] += 1;
      for (const r of rows) if (r.month === m && r.day <= upTo && r.klass === "ajustavel" && r.chartDay) hist[weekdayIndex(r.chartDay)] += r.amount;
    }
    const wrows: WeekdayRowV2[] = sums.map((s, dow) => ({ dow, label: WEEKDAY_LABEL[dow], days: counts[dow], avg: counts[dow] > 0 ? round2(s / counts[dow]) : 0, habitualAvg: histDays[dow] > 0 && a.refMonths.length >= 2 ? round2(hist[dow] / histDays[dow]) : null }));
    if (wrows.some((w) => w.avg > 0)) {
      const peakDow = wrows.reduce((best, w) => (w.avg > wrows[best].avg ? w.dow : best), 0);
      const weekdayAvg = wrows.slice(0, 5).reduce((s, w) => s + w.avg, 0) / 5;
      const weekendAvg = (wrows[5].avg + wrows[6].avg) / 2;
      const pct = weekdayAvg > 0 ? weekendAvg / weekdayAvg - 1 : 0;
      // Persistência: em quantos meses de referência o fim de semana também pesou ≥20% mais por dia que os dias úteis.
      const monthAvgs = a.refMonths.map((m) => {
        const upTo = a.windowOf(m);
        const sum = new Array<number>(7).fill(0); const n = new Array<number>(7).fill(0);
        for (let d = 1; d <= upTo; d += 1) n[weekdayIndex(isoOf(m, d))] += 1;
        for (const r of rows) if (r.month === m && r.day <= upTo && r.klass === "ajustavel" && r.chartDay) sum[weekdayIndex(r.chartDay)] += r.amount;
        const wd = [0, 1, 2, 3, 4].reduce((t, i) => t + (n[i] > 0 ? sum[i] / n[i] : 0), 0) / 5;
        const we = [5, 6].reduce((t, i) => t + (n[i] > 0 ? sum[i] / n[i] : 0), 0) / 2;
        return { wd, we };
      });
      const habWd = monthAvgs.length ? median(monthAvgs.map((x) => x.wd)) : 0;
      const habWe = monthAvgs.length ? median(monthAvgs.map((x) => x.we)) : 0;
      const observations = cur.filter((r) => adj(r) && r.amount > 0).length;
      weekday = {
        rows: wrows, peakDow, weekend: weekdayAvg > 0 && pct >= 0.2 ? { weekendAvg: round2(weekendAvg), weekdayAvg: round2(weekdayAvg), pct: Math.round(pct * 100) / 100 } : null,
        sample: { days: windowDays, refMonths: a.refMonths.length, observations },
        persistence: monthAvgs.length >= 2 ? { months: monthAvgs.length, withPattern: monthAvgs.filter((x) => x.we > 0 && (x.wd === 0 || x.we / x.wd - 1 >= 0.2)).length } : null,
        habitualWeekend: monthAvgs.length >= 2 ? { weekendAvg: round2(habWe), weekdayAvg: round2(habWd) } : null,
      };
    }
  }

  // Pequenos gastos acumulados
  let smallSpend: BehaviorV2["smallSpend"] = null;
  {
    const smalls = cur.filter((r) => r.klass !== "estrutural" && r.amount > 0 && r.amount <= SMALL_SPEND_CEILING);
    if (smalls.length >= 5) {
      const tot = smalls.reduce((s, r) => s + r.amount, 0);
      const byM = new Map<string, { label: string; total: number; count: number }>();
      for (const r of smalls) {
        if (!r.merchantKey || !isDisplayableMerchant(r.merchant)) continue;
        const e = byM.get(r.merchantKey) ?? { label: r.merchant ?? r.merchantKey, total: 0, count: 0 };
        e.total += r.amount; e.count += 1; byM.set(r.merchantKey, e);
      }
      const history = a.refMonths.slice(-3).map((m) => ({ month: m, total: round2(rows.filter((r) => r.month === m && r.day <= a.windowOf(m) && r.klass !== "estrutural" && r.amount > 0 && r.amount <= SMALL_SPEND_CEILING).reduce((s, r) => s + r.amount, 0)) }));
      smallSpend = { ceiling: SMALL_SPEND_CEILING, total: round2(tot), count: smalls.length, share: a.consumption > 0 ? Math.round((tot / a.consumption) * 1000) / 1000 : 0, topMerchants: [...byM.values()].sort((x, y) => y.total - x.total).slice(0, 3).map((m) => ({ ...m, total: round2(m.total) })), history };
    }
  }

  // Padrões comportamentais (só o que a base validou, sem tratar hipótese como fato)
  const patterns = a.input.patterns
    .filter((p) => !/^compromisso/i.test(p.label) && (p.status === "validated" || (p.status === "candidate" && (p.confidence ?? 0) >= 0.6)))
    .filter((p) => (p.upliftPct ?? 0) > 0 && p.sampleSize >= 8)
    .sort((x, y) => (y.confidence ?? 0) - (x.confidence ?? 0))
    .slice(0, 4)
    .map((p) => ({ label: p.label, status: p.status, upliftPct: p.upliftPct, absoluteDelta: p.absoluteDelta, sampleSize: p.sampleSize, confidence: p.confidence }));

  // Preços que subiram (cobrança recorrente estável com reajuste plausível)
  const priceChanges: BehaviorV2["priceChanges"] = [];
  {
    type M = { total: number; count: number };
    const by = new Map<string, { label: string; months: Map<string, M> }>();
    const priorMonths = [shiftMonth(month, -1), shiftMonth(month, -2), shiftMonth(month, -3)];
    for (const r of rows) {
      if (r.amount <= 0 || !r.merchantKey || !isDisplayableMerchant(r.merchant)) continue;
      if (r.month !== month && !priorMonths.includes(r.month)) continue;
      const row = by.get(r.merchantKey) ?? { label: r.merchant ?? r.merchantKey, months: new Map() };
      const cell = row.months.get(r.month) ?? { total: 0, count: 0 };
      cell.total += r.amount; cell.count += 1; row.months.set(r.month, cell); by.set(r.merchantKey, row);
    }
    for (const [key, row] of by) {
      const c = row.months.get(month);
      const p = priorMonths.map((m) => row.months.get(m)).filter((x): x is M => Boolean(x));
      if (!c || p.length < 2 || c.count > 2 || p.some((x) => x.count > 2)) continue;
      const t = p.map((x) => x.total);
      if (Math.max(...t) / Math.max(1, Math.min(...t)) > 1.08) continue;
      const from = median(t); const delta = c.total - from;
      if (from <= 0 || delta < 3 || delta / from < 0.05 || delta / from > 0.6) continue;
      priceChanges.push({ key, label: row.label, from: round2(from), to: round2(c.total), deltaAbs: round2(delta), deltaPct: Math.round((delta / from) * 1000) / 1000 });
    }
    priceChanges.sort((x, y) => y.deltaAbs - x.deltaAbs);
  }

  // Sinais: frequência crescente e concentração após a renda, só com evidência e sem inferir motivo.
  const signals: Signal[] = [];
  if (previousMonth) {
    const prevCount = new Map<string, number>();
    for (const r of prev) if (r.amount > 0 && r.klass === "ajustavel") prevCount.set(r.category, (prevCount.get(r.category) ?? 0) + 1);
    for (const c of categories) {
      const before = prevCount.get(c.name) ?? 0;
      if (c.klass === "ajustavel" && c.count >= 5 && before >= 2 && c.count >= before * 1.5 && c.count - before >= 3 && c.total >= 100) {
        signals.push({ key: `freq:${c.name}`, title: `Mais compras em ${c.name}`, evidence: `${c.count} compras até agora contra ${before} no mesmo período anterior (${brlTxt(c.total)}).`, sample: `${c.count + before} compras em 2 períodos`, confidence: c.count >= 8 ? "media" : "baixa", query: { category: c.name } });
      }
    }
  }
  {
    const shares: number[] = [];
    for (const m of a.refMonths) {
      const inc = a.incomeRows.filter((r) => r.month === m);
      if (inc.length === 0) continue;
      const main = inc.reduce((best, r) => (r.amount > best.amount ? r : best));
      if (main.amount < 500) continue;
      const startDay = dayOfMonth(main.date);
      const upTo = a.windowOf(m);
      let after = 0; let total = 0;
      for (const r of rows) if (r.month === m && r.day <= upTo && r.klass === "ajustavel" && r.amount > 0) { total += r.amount; if (r.day >= startDay && r.day < startDay + 5) after += r.amount; }
      if (total >= 200) shares.push(after / total);
    }
    const expected = 5 / 30;
    if (shares.length >= 3 && median(shares) >= expected * 2 && shares.filter((x) => x >= expected * 2).length >= Math.ceil(shares.length * 0.6)) {
      signals.push({ key: "after_income", title: "Gasto concentrado logo após a renda", evidence: `Em média ${Math.round(median(shares) * 100)}% do gasto ajustável do mês acontece nos 5 dias seguintes à entrada da renda (o esperado, se fosse uniforme, seria ${Math.round(expected * 100)}%).`, sample: `${shares.length} meses fechados`, confidence: shares.length >= 5 ? "media" : "baixa", query: null });
    }
  }

  return {
    categories, merchants, signals,
    previousLabel: previousMonth ? `${previousMonth}` : null,
    previousRange: null,
    habitualBase: a.habitual ? { months: a.habitual.months.length } : null,
    split: { classes: roundClasses(a.classes), total: round2(a.consumption) },
    drivers, weekday, smallSpend, patterns, priceChanges: priceChanges.slice(0, 3),
  };
}

// ---------------------------------------------------------------------------
// C. Projeções
// ---------------------------------------------------------------------------

function buildProjections(a: {
  rows: Cls[]; month: string; today: string; windowDays: number; isCurrentMonth: boolean; refMonths: string[]; windowOf: (m: string) => number;
  consumption: number; classes: ClassTotals; snapshot: any | null; input: V2Inputs; cls: ClassifyResult; realizedIncome: number; typicalIncome: number; quality: QualityNote[];
}): ProjectionsV2 {
  const { snapshot, input } = a;
  const out: ProjectionsV2 = { consumption: null, cash: null, commitments: null, committedIncome: null, receivables: null, savings: null, recoverable: null };
  const total = daysInMonth(a.month);

  // 13. Consumo projetado: realizado + estrutural pendente + ajustável futuro (por dia da semana, ajustado pelo ritmo)
  if (a.isCurrentMonth && a.refMonths.length >= 2 && a.windowDays < total) {
    const pending: any[] = Array.isArray(snapshot?.commitmentAgenda?.pendingItems) ? snapshot.commitmentAgenda.pendingItems : [];
    const monthEnd = isoOf(a.month, total);
    const structuralItems = pending.filter((i) => i?.type === "expense" && ["recurring", "planned", "donation_goal"].includes(String(i.source)) && i.date > a.today && i.date <= monthEnd).map((i) => ({ label: String(i.name ?? "Obrigação"), amount: round2(num(i.amount) ?? 0), date: String(i.date) }));
    const structuralPending = round2(structuralItems.reduce((s, i) => s + i.amount, 0));
    // Base por dia da semana: ajustável médio dos dias restantes nos meses de referência
    const remainingByRef = a.refMonths.map((m) => {
      let s = 0;
      const upTo = daysInMonth(m);
      for (const r of a.rows) if (r.month === m && r.klass === "ajustavel" && r.day > Math.min(a.windowDays, upTo) && r.day <= Math.min(total, upTo)) s += r.amount;
      return s;
    });
    const adjToDate = a.classes.ajustavel;
    const refAdjToDate = median(a.refMonths.map((m) => a.rows.filter((r) => r.month === m && r.klass === "ajustavel" && r.day <= Math.min(a.windowDays, daysInMonth(m))).reduce((s, r) => s + r.amount, 0)));
    const pace = refAdjToDate > 0 ? Math.min(1.4, Math.max(0.6, adjToDate / refAdjToDate)) : 1;
    const base = median(remainingByRef);
    const adjustableFuture = round2(Math.max(0, base * pace));
    const sortedRem = [...remainingByRef].sort((x, y) => x - y);
    const low = round2(Math.max(0, quantile(sortedRem, 0.25) * pace));
    const high = round2(Math.max(adjustableFuture, quantile(sortedRem, 0.75) * pace));
    const realized = round2(a.consumption);
    out.consumption = { realized, structuralPending, structuralItems, adjustableFuture, total: round2(realized + structuralPending + adjustableFuture), low: round2(realized + structuralPending + low), high: round2(realized + structuralPending + high), method: `Faixa = percentis 25–75 do gasto ajustável que costuma restar do dia ${a.windowDays + 1} ao fim do mês, em ${a.refMonths.length} meses de histórico, ajustado ao seu ritmo deste mês.` };
  }

  // 14. Caixa: a conta aberta, passo a passo (mesma conta da Home)
  const proj = snapshot?.projection;
  if (a.isCurrentMonth && proj) {
    const avail = num(proj.currentAvailableBalance) ?? num(snapshot.availableToday) ?? 0;
    const events: any[] = Array.isArray(proj.estimatedIncomeEvents) ? proj.estimatedIncomeEvents.filter((e: any) => typeof e?.date === "string" && e.date >= a.today && (num(e.amount) ?? 0) > 0) : [];
    const configured = events.filter((e) => String(e.source) === "configured" || String(e.confidence) === "high");
    const uncertainEvents = events.filter((e) => !configured.includes(e));
    const incomeConfirmed = num(proj.confirmedFutureInflows) ?? 0;
    const incomeConfigured = round2(configured.reduce((s, e) => s + (num(e.amount) ?? 0), 0));
    const incomeUncertain = round2(uncertainEvents.reduce((s, e) => s + (num(e.amount) ?? 0), 0));
    const commitments = num(proj.upcomingConfirmedCommitments) ?? 0;
    const cardDue = num(proj.cardDueThisMonth) ?? 0;
    const variable = num(proj.projectedVariableSpending) ?? 0;
    const projectedEnd = round2(avail + incomeConfirmed + incomeConfigured + incomeUncertain - commitments - cardDue - variable);
    const homeEnd = num(proj.projectedEndBalance);
    const steps: ProjectionStep[] = [{ key: "start", label: "Saldo hoje", value: round2(avail), sign: "start" }];
    if (incomeConfirmed + incomeConfigured > 0) steps.push({ key: "income", label: "Receitas previstas", value: round2(incomeConfirmed + incomeConfigured), sign: "plus" });
    if (incomeUncertain > 0) steps.push({ key: "income_uncertain", label: "Receitas estimadas (incertas)", value: incomeUncertain, sign: "plus", uncertain: true });
    steps.push({ key: "commitments", label: "Obrigações até o fim do mês", value: round2(commitments), sign: "minus" });
    steps.push({ key: "card", label: "Fatura do cartão do mês", value: round2(cardDue), sign: "minus" });
    steps.push({ key: "variable", label: "Consumo variável previsto", value: round2(variable), sign: "minus" });
    steps.push({ key: "result", label: "Saldo projetado", value: projectedEnd, sign: "result" });
    const next = events.sort((x, y) => (x.date < y.date ? -1 : 1))[0];
    const uncertainReceivables = round2(input.receivables.filter((r) => r.state === "pending" || r.state === "overdue").reduce((s, r) => s + r.balance, 0));
    out.cash = {
      freeCash: num(snapshot?.projection?.freeAfterKnownCommitments),
      steps, projectedEnd, conservativeEnd: round2(projectedEnd - incomeUncertain), reconciles: homeEnd == null || Math.abs(homeEnd - projectedEnd) <= 1,
      expectedIncome: next ? { amount: round2(num(next.amount) ?? 0), date: next.date, label: String(next.label ?? "Renda prevista"), configured: configured.includes(next) } : null,
      uncertainReceivables,
    };
    if (homeEnd != null && Math.abs(homeEnd - projectedEnd) > 1) a.quality.push({ code: "cash_mismatch", level: "warn", text: "A projeção de caixa não fecha com a da Home; os passos mostrados são os da fonte, sem ajuste." });
  }

  // 15. Compromissos: 30 dias (agenda) e horizonte mensal
  if (snapshot?.commitmentAgenda) {
    const ag = snapshot.commitmentAgenda;
    const horizonEnd = typeof ag.horizonEnd === "string" ? ag.horizonEnd : isoOf(shiftMonth(a.month, 1), 1);
    const items: any[] = (Array.isArray(ag.pendingItems) ? ag.pendingItems : []).filter((i: any) => i?.type === "expense" && typeof i.date === "string" && i.date >= a.today && i.date <= horizonEnd && (num(i.amount) ?? 0) > 0);
    const groupDef: Array<{ key: "cards" | "debts" | "recurring"; sources: string[] }> = [
      { key: "cards", sources: ["card_statement", "card_installment"] }, { key: "debts", sources: ["debt_installment"] }, { key: "recurring", sources: ["recurring", "planned", "donation_goal"] },
    ];
    const groups: Array<{ key: "cards" | "debts" | "recurring"; amount: number; estimated?: boolean }> = groupDef.map((g) => ({ key: g.key, amount: round2(items.filter((i) => g.sources.includes(String(i.source))).reduce((s, i) => s + (num(i.amount) ?? 0), 0)) })).filter((g) => g.amount > 0);
    // Fatura do mês fora da agenda (a Home a estima à parte): entra como estimativa, senão o total esconde o cartão.
    const cardDue = num(snapshot?.projection?.cardDueThisMonth) ?? 0;
    if (!groups.some((g) => g.key === "cards") && cardDue > 0) groups.unshift({ key: "cards", amount: round2(cardDue), estimated: true });
    out.commitments = { next30: round2(groups.reduce((s, g) => s + g.amount, 0)), groups, months: input.commitmentMonths.slice(0, 6), hasEstimates: Boolean(ag.hasEstimates) || groups.some((g) => g.estimated), horizonEnd };
  } else if (input.commitmentMonths.length > 0) {
    out.commitments = { next30: 0, groups: [], months: input.commitmentMonths.slice(0, 6), hasEstimates: true, horizonEnd: null };
  }

  // 16. Renda comprometida
  // Denominador no mesmo horizonte das obrigações: a renda mensal informada no perfil; sem ela, a mediana dos meses anteriores.
  const configuredIncome = num(snapshot?.projection?.estimatedFixedInflows) ?? 0;
  const incomeBase = configuredIncome > 0 ? configuredIncome : a.typicalIncome > 0 ? a.typicalIncome : null;
  if (out.commitments && out.commitments.next30 > 0 && incomeBase && incomeBase > 0) {
    out.committedIncome = { pct: Math.round((out.commitments.next30 / incomeBase) * 1000) / 1000, income: round2(incomeBase), obligations: out.commitments.next30, basis: configuredIncome > 0 ? "renda mensal informada no seu perfil" : "mediana das receitas dos meses anteriores" };
  }

  // 17. A receber (de terceiros): a vencer, vencido e recebido no período
  if (input.receivables.length > 0) {
    const open = input.receivables.filter((r) => r.state === "pending" || r.state === "overdue");
    const received = input.receivables.filter((r) => r.paidAt && monthOf(r.paidAt) === a.month).reduce((s, r) => s + r.paidAmount, 0);
    out.receivables = {
      toDue: round2(open.filter((r) => r.dueDate >= a.today).reduce((s, r) => s + r.balance, 0)),
      overdue: round2(open.filter((r) => r.dueDate < a.today).reduce((s, r) => s + r.balance, 0)),
      receivedInPeriod: round2(received), count: open.length,
    };
  }

  // 18. Poupança sustentável (canônica do perfil), distinguindo zero real, histórico curto e cálculo velho
  if (input.profile) {
    const p = input.profile;
    const age = Math.round((toMs(a.today) - toMs(p.asOf)) / DAY);
    const status: NonNullable<ProjectionsV2["savings"]>["status"] = age > 3 ? "stale" : p.closedMonths < 3 ? "insufficient_history" : (p.sustainableMonthlySaving ?? 0) <= 0 ? "zero_real" : "ok";
    out.savings = { monthly: p.sustainableMonthlySaving, status, closedMonths: p.closedMonths, incomeBaseline: p.incomeBaseline, savingsRateMedian: p.savingsRateMedian };
    // 19. Gasto recuperável: composição proporcional (sem sobreposição) do total canônico
    const rec = p.recoverableMonthly ?? 0;
    const sumSrc = p.flexibleSources.reduce((s, x) => s + Math.max(0, x.recoverable_monthly), 0);
    if (rec > 0 && sumSrc > 0) {
      const k = rec / sumSrc;
      out.recoverable = { monthly: round2(rec), sources: p.flexibleSources.filter((x) => x.recoverable_monthly > 0).map((x) => ({ label: x.label, monthly: round2(x.recoverable_monthly * k) })).sort((x, y) => y.monthly - x.monthly) };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// D. Evolução
// ---------------------------------------------------------------------------

function buildEvolution(a: { rows: Cls[]; cls: ClassifyResult; month: string; today: string; isCurrentMonth: boolean; input: V2Inputs; snapshot: any | null; typicalIncome: number; behavior: BehaviorV2 | null }): EvolutionV2 {
  const months: EvolutionMonth[] = [];
  const openMonth = monthOf(a.today);
  for (let i = 5; i >= 0; i -= 1) {
    const m = shiftMonth(a.month, -i);
    const cons = round2(a.rows.filter((r) => r.month === m).reduce((s, r) => s + r.amount, 0));
    const inc = round2(a.cls.incomeRows.filter((r) => r.month === m).reduce((s, r) => s + r.amount, 0));
    const hasData = cons !== 0 || inc !== 0 || a.rows.some((r) => r.month === m);
    if (!hasData) continue;
    const open = m === openMonth;
    const incomplete = open && a.typicalIncome > 0 && inc < a.typicalIncome * 0.5;
    months.push({ month: m, income: inc, consumption: cons, debtPaid: round2(a.cls.debtPaidByMonth.get(m) ?? 0), result: round2(inc - cons), open, partial: incomplete });
  }

  const nwSeries = a.input.netWorthSeries.slice(-6);
  const nwSnap = a.snapshot?.netWorth;
  const composition = nwSnap && num(nwSnap.net) != null ? {
    asOf: a.today, cash: round2(num(nwSnap.cash) ?? 0), invested: round2(num(nwSnap.invested) ?? 0), assets: round2(num(nwSnap.assets) ?? 0),
    cardsOwed: round2(num(nwSnap.cardsOwed) ?? 0), otherDebts: round2(num(nwSnap.otherDebts) ?? 0), liabilities: round2(num(nwSnap.owed) ?? 0), net: round2(num(nwSnap.net) ?? 0),
  } : null;
  const nwCurrent = composition?.net ?? a.input.profile?.netWorth ?? null;
  const netWorth: EvolutionV2["netWorth"] = nwSeries.length > 0 || nwCurrent != null
    ? { series: nwSeries, current: nwCurrent, label: "Ativos (contas e investimentos) menos passivos (dívidas e cartões) informados no Nino", composition }
    : null;

  const LIVE = new Set(["on_track", "attention", "at_risk", "exceeded", "limit_reached"]);
  const spending = (Array.isArray(a.snapshot?.activeCategoryGoals) ? a.snapshot.activeCategoryGoals : [])
    .filter((g: any) => LIVE.has(String(g?.status)) && typeof g?.period?.start === "string" && g.period.start <= a.today && g.period.end >= a.today && (num(g?.targetAmount) ?? 0) > 0)
    .map((g: any) => {
      const limit = num(g.targetAmount) as number;
      const spent = num(g.actualSpend) ?? 0;
      const projected = num(g.projectedSpend);
      const pct = Math.round((spent / limit) * 1000) / 1000;
      const projectedPct = projected != null ? Math.round((projected / limit) * 1000) / 1000 : null;
      const verdict: "no_ritmo" | "atencao" | "vai_estourar" | "estourou" = pct >= 1 ? "estourou" : projectedPct != null && projectedPct > 1 ? "vai_estourar" : (projectedPct ?? pct) >= 0.85 ? "atencao" : "no_ritmo";
      return { id: String(g.goal?.id ?? g.categoryName), category: String(g.categoryName ?? "Categoria"), spent: round2(spent), limit: round2(limit), pct, status: String(g.status), projectedPct, daysRemaining: num(g.daysRemaining), verdict };
    })
    .sort((x: any, y: any) => (y.projectedPct ?? y.pct) - (x.projectedPct ?? x.pct));
  const savingsIds = new Set(a.input.savingsGoalIds);
  const savings = (Array.isArray(a.snapshot?.goalProgress) ? a.snapshot.goalProgress : [])
    .filter((g: any) => savingsIds.has(String(g?.id)) && (num(g?.target) ?? 0) > 0)
    .map((g: any) => { const target = num(g.target) as number; const contributed = num(g.contributed) ?? 0; return { id: String(g.id), name: String(g.name ?? "Meta"), target: round2(target), contributed: round2(contributed), pct: Math.min(1, Math.round((contributed / target) * 1000) / 1000), remaining: round2(Math.max(0, target - contributed)) }; });
  const onTrack = spending.filter((g: any) => g.verdict === "no_ritmo").length;
  const summary = spending.length > 0 ? `${onTrack} de ${spending.length} meta${spending.length === 1 ? "" : "s"} de gasto no ritmo${savings.length ? `; ${savings.length} de acumulação em andamento` : ""}.` : savings.length > 0 ? `${savings.length} meta${savings.length === 1 ? "" : "s"} de acumulação em andamento.` : null;
  // Previsto x realizado: última previsão gravada de cada mês fechado contra o consumo que de fato aconteceu.
  const forecast: ForecastRow[] = [];
  for (const h of (a.input.projectionHistory ?? []).filter((x) => x.month < openMonth).sort((x, y) => (x.month < y.month ? 1 : -1)).slice(0, 4)) {
    const actual = round2(a.rows.filter((r) => r.month === h.month).reduce((t, r) => t + r.amount, 0));
    const pred = h.projectedConsumption;
    forecast.push({ month: h.month, asOf: h.asOf, predictedConsumption: pred, actualConsumption: actual, consumptionErrorPct: pred != null && actual > 0 ? Math.round(((pred - actual) / actual) * 1000) / 1000 : null, predictedEnd: h.projectedEnd });
  }
  // Ações aceitas: partida (baseline) contra o gasto atual no mesmo estabelecimento.
  const tracked: TrackedAction[] = [];
  for (const act of (a.input.recommendationActions ?? []).filter((x) => x.action === "accepted" && x.baselineAmount != null && x.merchantKey)) {
    const m = a.behavior?.merchants.find((x) => x.key === act.merchantKey);
    const baseline = act.baselineAmount as number;
    const current = m ? m.total : 0;
    const delta = round2(current - baseline);
    tracked.push({ key: act.recKey, title: act.title, kind: act.kind, acceptedMonth: act.month, baseline, current, delta, status: !m && !a.isCurrentMonth ? "sem_dado" : delta < -0.05 * baseline ? "reduzindo" : delta > 0.05 * baseline ? "aumentou" : "sem_mudanca" });
  }
  return { forecast, tracked, months, netWorth, goals: { spending, savings, summary } };
}

// ---------------------------------------------------------------------------
// E. Recomendações priorizadas
// ---------------------------------------------------------------------------

function buildRecommendations(a: { behavior: BehaviorV2 | null; projections: ProjectionsV2; input: V2Inputs; month: string }): ReportV2["recommendations"] {
  const handled = new Set((a.input.recommendationActions ?? []).map((x) => x.recKey));
  // Cada ação traz baseline, premissa e impacto estimado próprios. Não há total agregado: as ações se sobrepõem
  // (a categoria contém o estabelecimento, que contém os pequenos gastos) e somar seria prometer o que não se mede.
  const items: Recommendation[] = [];
  const b = a.behavior;
  const fmt = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
  const catByName = new Map((b?.categories ?? []).map((c) => [c.name, c]));
  if (b) {
    for (const m of b.merchants.slice(0, 20)) {
      const cat = catByName.get(m.category);
      if (!cat || cat.klass !== "ajustavel" || m.deltaAbs < 30 || m.previous <= 0) continue;
      const recurrence = Math.min(1, m.count / 4);
      items.push({
        key: `merchant:${m.key}`, kind: "merchant", nature: "saving", title: `Voltar ${m.label} ao nível anterior`,
        body: `Você gastou ${fmt(m.total)} em ${m.label} (${m.count} ${m.count === 1 ? "compra" : "compras"}) contra ${fmt(m.previous)} no período anterior.`,
        basis: `Baseline: ${fmt(m.previous)} no mesmo período do mês anterior. Premissa: voltar a esse nível (diferença de ${fmt(m.deltaAbs)}).`,
        monthlyImpact: round2(m.deltaAbs), merchantKey: m.key, baselineAmount: m.previous, category: m.category, confidence: round2(0.5 + 0.4 * recurrence), score: 0, route: cat.id ? `/app/metas/categoria/${cat.id}` : "/app/metas", routeLabel: "Criar meta de gasto",
      });
    }
    for (const p of b.priceChanges.slice(0, 2)) items.push({ key: `price:${p.key}`, kind: "price", nature: "saving", title: `${p.label} ficou ${fmt(p.deltaAbs)} mais cara`, body: `De ${fmt(p.from)} para ${fmt(p.to)} por mês. Vale conferir se mudou de plano ou se foi reajuste.`, basis: `Baseline: mediana dos 3 meses anteriores (${fmt(p.from)}).`, monthlyImpact: round2(p.deltaAbs), confidence: 0.8, score: 0, route: "/app/recorrencias", routeLabel: "Revisar assinaturas" });
    if (b.smallSpend && b.smallSpend.total >= 80) {
      const top = b.smallSpend.topMerchants[0];
      items.push({ key: "small_spend", kind: "small_spend", nature: "saving", title: `Pequenos gastos somam ${fmt(b.smallSpend.total)}`, body: `${b.smallSpend.count} compras de até R$ ${b.smallSpend.ceiling}${top ? `, sobretudo em ${top.label}` : ""}.`, basis: `Baseline: ${fmt(b.smallSpend.total)} no período. Premissa: cortar 30% (parte desses gastos não é evitável).`, monthlyImpact: round2(b.smallSpend.total * 0.3), confidence: 0.5, score: 0, route: "/app/lancamentos", routeLabel: "Ver os lançamentos" });
    }
    if (b.weekday?.weekend) {
      const w = b.weekday.weekend;
      const extra = (w.weekendAvg - w.weekdayAvg) * 8;
      if (extra >= 40) items.push({ key: "weekend", kind: "weekend", nature: "saving", title: "Fins de semana pesam mais", body: `${fmt(w.weekendAvg)} por dia contra ${fmt(w.weekdayAvg)} nos dias úteis.`, basis: `Baseline: diferença diária × 8 dias de fim de semana por mês (${fmt(extra)}). Premissa: reduzir metade dessa diferença.`, monthlyImpact: round2(extra * 0.5), confidence: 0.45, score: 0, route: "/app/metas", routeLabel: "Criar meta de gasto" });
    }
  }
  const rec = a.projections.recoverable;
  if (rec && rec.sources[0]) items.push({ key: `recoverable:${rec.sources[0].label}`, kind: "recoverable", nature: "saving", title: `${rec.sources[0].label}: maior potencial de economia`, body: `Seu perfil estima até ${fmt(rec.sources[0].monthly)} por mês recuperáveis aqui, dentro de ${fmt(rec.monthly)} no total.`, basis: "Baseline: o seu padrão mais baixo recorrente nesta categoria (perfil financeiro).", monthlyImpact: rec.sources[0].monthly, confidence: 0.7, score: 0, route: "/app/metas", routeLabel: "Criar meta de gasto" });
  // Organizar o caixa não é economizar: entra como ação de caixa, sem impacto mensal.
  for (const s of a.input.situationActions.slice(0, 3)) {
    const saving = (s.impact ?? 0) > 0;
    items.push({ key: `situation:${s.key}`, kind: "situation", nature: saving ? "saving" : "cash", title: s.title, body: s.explanation ?? "", basis: saving ? "Estimativa da análise de situação do Nino." : "Ação de organização: não gera economia mensurável por si só.", monthlyImpact: saving ? round2(s.impact as number) : 0, confidence: s.confidence ?? 0.6, score: 0, route: s.route, routeLabel: s.route ? "Abrir" : null });
  }
  for (const it of items) it.score = round2(it.monthlyImpact * it.confidence);
  // Ordem: ações de caixa com urgência primeiro (não têm valor), depois economia por impacto × confiança.
  items.sort((x, y) => (x.nature === y.nature ? y.score - x.score : x.nature === "cash" ? -1 : 1));
  const seen = new Set<string>();
  const top = items.filter((it) => !handled.has(it.key)).filter((it) => { const k = it.kind === "merchant" ? it.key : it.kind; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 3);
  return { items: top };
}

/** Frase de diagnóstico: só fatos do próprio relatório, e a ressalva quando a leitura pode ser só calendário. */
function makeHeadline(o: OverviewV2, isCurrent: boolean): string {
  const fmt = (n: number) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
  const parts: string[] = [];
  const h = o.habitual;
  if (h && h.deltaPct != null) {
    const pct = Math.round(Math.abs(h.deltaPct) * 100);
    parts.push(`Você consumiu ${fmt(o.consumption)}${isCurrent ? ` até o dia ${o.windowDays}` : ""}, ${Math.abs(h.deltaPct) < 0.02 ? "no seu habitual" : `${pct}% ${h.deltaPct < 0 ? "abaixo" : "acima"} do habitual`} (${fmt(h.value)}).`);
    if (isCurrent && h.deltaPct < -0.3) parts.push("Parte da diferença pode ser calendário: contas do mês ainda vão vencer.");
  } else parts.push(`Você consumiu ${fmt(o.consumption)}${isCurrent ? ` até o dia ${o.windowDays}` : ""}.`);
  if (o.income.incomplete) parts.push(o.income.expected ? `A renda de ${fmt(o.income.expected.amount)} está prevista para ${o.income.expected.date.slice(8, 10)}/${o.income.expected.date.slice(5, 7)}; o resultado é parcial.` : "A renda do mês ainda não entrou; o resultado é parcial.");
  if (o.balance.available != null) parts.push(`Saldo hoje: ${fmt(o.balance.available)}.`);
  return parts.join(" ");
}
