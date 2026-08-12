// Motor de Custo de Vida — fixo x variável (`cost_structure.v1`).
// Responde "quanto sua vida custa antes de você decidir gastar qualquer coisa".
// Puro e determinístico: só consome fatos já registrados.
import {
  isRealMonthlyMovement,
  round2,
  buildRefundAttribution,
  effectiveCategoryId,
  behavioralMetricAmount,
  type DebtRow,
  type RecurringRow,
  type TransactionRow,
} from "./facts";
import {
  confidenceFromSample,
  makeEnvelope,
  makeEvidence,
  type EngineEnvelope,
  type EnginePeriod,
} from "./engineEnvelope";
import type { DetectedSubscription } from "./recurringDiscovery";

export const COST_STRUCTURE_VERSION = "cost_structure.v1";

export type SpendFlexibility = "estrutural" | "flexivel" | "indefinido";

/** Categorias que representam estrutura de vida — nunca sugeridas para corte. */
const STRUCTURAL_RX = /moradia|aluguel|condom[ií]nio|financiamento|presta[çc][aã]o|d[ií]vida|empr[eé]stimo|sa[uú]de|plano de sa[uú]de|seguro|medicamento|educa[çc][aã]o|escola|faculdade|creche|imposto|tributo|energia|luz|[aá]gua|g[aá]s|internet|telefone|celular|academia|pens[aã]o|transporte p[uú]blico|combust[ií]vel/i;

/** Categorias discricionárias — onde existe economia realista. */
const FLEXIBLE_RX = /lazer|restaurante|delivery|bar|ifood|comida fora|assinatura|streaming|vestu[aá]rio|roupa|beleza|presente|viagem|jogo|festa|bebida|caf[eé]|doce|hobby|app|tecnologia/i;

export function classifyFlexibility(categoryName: string | null | undefined): SpendFlexibility {
  const name = String(categoryName ?? "");
  if (!name) return "indefinido";
  if (STRUCTURAL_RX.test(name)) return "estrutural";
  if (FLEXIBLE_RX.test(name)) return "flexivel";
  return "indefinido";
}

export interface CostBucket {
  key: string;
  label: string;
  monthly_amount: number;
  source: "categoria" | "recorrencia" | "assinatura" | "divida";
  detail: string;
}

export interface CostStructureFacts {
  /** Custo estrutural mensal (o que sai antes de qualquer decisão). */
  structural_monthly: number;
  /** Consumo flexível médio por mês nos meses analisados. */
  flexible_monthly: number;
  /** Gasto médio total por mês. */
  total_monthly: number;
  /** Custo mínimo mensal = estrutural (sem consumo flexível). */
  minimum_monthly: number;
  /** Renda média mensal observada. */
  income_monthly: number;
  /** Sobra média antes de decisões de consumo flexível. */
  headroom_monthly: number;
  /** Fatia da renda comprometida com estrutura. */
  structural_share_of_income: number | null;
  months_analyzed: number;
}

export interface CostStructureInput {
  txs: TransactionRow[];
  /** Janela de análise: recomendado 3 meses completos. */
  period: EnginePeriod;
  categoryNames?: Record<string, string>;
  recurring?: RecurringRow[];
  debts?: DebtRow[];
  subscriptions?: DetectedSubscription[];
  monthsAnalyzed?: number;
}

function inRange(date: string, period: EnginePeriod): boolean {
  const d = date.slice(0, 10);
  return d >= period.from && d <= period.to;
}

function monthsInPeriod(period: EnginePeriod): number {
  const start = new Date(`${period.from}T12:00:00Z`);
  const end = new Date(`${period.to}T12:00:00Z`);
  const months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth()) + 1;
  return Math.max(1, months);
}

export function computeCostStructure(
  input: CostStructureInput,
): EngineEnvelope<CostStructureFacts, CostBucket, CostBucket> {
  const names = input.categoryNames ?? {};
  const months = input.monthsAnalyzed ?? monthsInPeriod(input.period);
  const attribution = buildRefundAttribution(input.txs);

  const structuralByCategory = new Map<string, number>();
  const flexibleByCategory = new Map<string, number>();
  const undefinedByCategory = new Map<string, number>();
  let income = 0;
  let sampleSize = 0;

  for (const t of input.txs) {
    if (!inRange(t.occurred_at, input.period)) continue;
    const inc = behavioralMetricAmount(t, "income");
    if (inc !== 0) income = round2(income + inc);
    const exp = behavioralMetricAmount(t, "expense");
    if (exp === 0) continue;
    sampleSize += 1;
    const categoryId = effectiveCategoryId(t, attribution);
    const name = categoryId ? (names[categoryId] ?? "Categoria removida") : "Sem categoria";
    const flex = classifyFlexibility(name);
    const bucket = flex === "estrutural" ? structuralByCategory : flex === "flexivel" ? flexibleByCategory : undefinedByCategory;
    bucket.set(name, round2((bucket.get(name) ?? 0) + exp));
  }

  const buckets: CostBucket[] = [];
  for (const [name, total] of structuralByCategory) {
    buckets.push({
      key: `categoria:${name}`,
      label: name,
      monthly_amount: round2(total / months),
      source: "categoria",
      detail: `Média mensal observada em ${months} mês(es).`,
    });
  }

  // Recorrências cadastradas entram como compromisso mensal equivalente.
  const PER_MONTH: Record<RecurringRow["frequency"], number> = {
    daily: 30,
    weekly: 4.345,
    monthly: 1,
    yearly: 1 / 12,
  };
  for (const r of input.recurring ?? []) {
    if (r.active === false) continue;
    if (r.type !== "expense") continue;
    const amount = Number(r.amount ?? 0);
    if (amount <= 0) continue;
    buckets.push({
      key: `recorrencia:${r.id}`,
      label: r.name || "Recorrência",
      monthly_amount: round2(amount * (PER_MONTH[r.frequency] ?? 1)),
      source: "recorrencia",
      detail: "Recorrência cadastrada pelo usuário.",
    });
  }

  for (const s of input.subscriptions ?? []) {
    if (s.already_registered) continue;
    buckets.push({
      key: `assinatura:${s.merchant_key}`,
      label: s.label,
      monthly_amount: s.monthly_equivalent,
      source: "assinatura",
      detail: `Assinatura detectada (${s.occurrences} cobranças, cadência ${s.cadence}).`,
    });
  }

  for (const d of input.debts ?? []) {
    if ((d.status ?? "active") !== "active") continue;
    const installment = Number(d.installment_amount ?? 0);
    if (installment <= 0) continue;
    buckets.push({
      key: `divida:${d.id}`,
      label: d.name || "Dívida",
      monthly_amount: round2(installment),
      source: "divida",
      detail: "Parcela mensal de dívida ativa.",
    });
  }


  // Estrutural = apenas o gasto observado em categorias estruturais. Assinaturas,
  // recorrências e dívidas já geraram lançamentos no período, então entram na lista
  // como composição do custo — nunca somadas de novo (evita dupla contagem).
  const structuralFromCategories = round2([...structuralByCategory.values()].reduce((s, v) => s + v, 0) / months);
  const structuralMonthly = structuralFromCategories;


  const flexibleMonthly = round2([...flexibleByCategory.values()].reduce((s, v) => s + v, 0) / months);
  const undefinedMonthly = round2([...undefinedByCategory.values()].reduce((s, v) => s + v, 0) / months);
  const totalMonthly = round2(structuralFromCategories + flexibleMonthly + undefinedMonthly);
  const incomeMonthly = round2(income / months);

  buckets.sort((a, b) => b.monthly_amount - a.monthly_amount);

  return makeEnvelope({
    engine: "cost_structure",
    facts: {
      structural_monthly: structuralMonthly,
      flexible_monthly: flexibleMonthly,
      total_monthly: totalMonthly,
      minimum_monthly: structuralMonthly,
      income_monthly: incomeMonthly,
      headroom_monthly: round2(incomeMonthly - structuralMonthly),
      structural_share_of_income: incomeMonthly > 0 ? round2(structuralMonthly / incomeMonthly) : null,
      months_analyzed: months,
    },
    breakdown: buckets.slice(0, 12),
    drivers: buckets.slice(0, 4),
    evidence: makeEvidence({
      period: input.period,
      sampleSize,
      formulaVersion: COST_STRUCTURE_VERSION,
      notes: [
        `Médias calculadas sobre ${months} mês(es) de histórico.`,
        undefinedMonthly > 0
          ? "Parte do gasto está em categorias sem classificação fixo/variável — classificar melhora a leitura."
          : "Todas as categorias do período têm classificação fixo/variável.",
      ],
    }),
    confidence: confidenceFromSample(sampleSize, { minSample: 10, goodSample: 45 }),
  });
}
