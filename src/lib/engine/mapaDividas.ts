// E4 — Dívidas (saúde). Nunca avalia pelo saldo bruto: comprometimento da renda, atraso, custo, trajetória e perfil.
import type { DataQuality, IncomeBaseline, MapaConfidence, MapaIndicator, MapaStatus } from "./mapaContracts";
import { ledgerConfidence, noData, percent, pointWindow, reading, round, type IndicatorSpec } from "./mapaIndicator";
import type { MapaDebtIn, MapaDebtOverdueIn, MapaSnapshotInput } from "./mapaInputs";
import {
  DEBT_COST_CRITICAL_PM, DEBT_COST_OK_PM, DEBT_DATA_COVERAGE_MIN, DEBT_GROWTH_CRITICAL, DEBT_HIGH_COST_ATTENTION, DEBT_HIGH_COST_CRITICAL,
  DEBT_SERVICE_ATTENTION, DEBT_SERVICE_CRITICAL, HIGH_COST_DEBT_KINDS,
} from "./mapaThresholds";

export const DIVIDAS_FORMULA = "mapa_dividas.v1";

export interface DividasInput {
  asOf: string;
  dq: DataQuality;
  income: IncomeBaseline;
  debts: MapaDebtIn[];
  overdue: MapaDebtOverdueIn | null;
  snapshot: MapaSnapshotInput | null;
}

const spec = (id: string, unit: IndicatorSpec["unit"], asOf: string, evidence: IndicatorSpec["evidence"]): IndicatorSpec =>
  ({ id, pillar: "dividas", layer: "saude", unit, direction: "lower_better", window: pointWindow(asOf), evidence, formula: DIVIDAS_FORMULA });

/** Taxa anual efetiva → mensal equivalente. */
export const annualToMonthlyPct = (annualPct: number) => ((1 + annualPct / 100) ** (1 / 12) - 1) * 100;

const bridgeConfidence = (c: "high" | "medium" | "low" | null): Exclude<MapaConfidence, "insuficiente"> => (c === "high" ? "alta" : "moderada");

export function computeDividas(i: DividasInput): MapaIndicator[] {
  const out: MapaIndicator[] = [];
  const active = i.debts.filter((d) => d.status === "active" && d.outstanding_balance > 0);
  const balance = active.reduce((a, d) => a + d.outstanding_balance, 0);
  const conf = ledgerConfidence(i.dq, i.income);
  const none = { reasons: ["sem_dividas_ativas"] };

  // comprometimento da renda típica com parcelas
  const cSpec = spec("dividas.comprometimento_renda", "pct", i.asOf, ["balance", "derived"]);
  if (i.income.typical === null || i.dq.eligibility.razoes_de_renda === "bloqueado") out.push(noData(cSpec, { reasons: ["poucos_meses_fechados"], needs: { kind: "history", code: "meses_fechados" } }));
  else if (!active.length) out.push(reading(cSpec, { value: 0, status: "ok", confidence: conf, reasons: none.reasons, inputs: { parcelas_mensais: 0, renda_tipica: i.income.typical } }));
  else if (i.income.typical <= 0) out.push(noData(cSpec, { reasons: ["sem_renda_registrada"], needs: { kind: "capture", code: "renda" } }));
  else {
    const installments = active.reduce((a, d) => a + (d.installment_amount ?? 0), 0);
    const missing = active.filter((d) => d.installment_amount === null || d.installment_amount <= 0).length;
    const ratio = installments / i.income.typical;
    const status: Exclude<MapaStatus, "sem_dados"> = ratio > DEBT_SERVICE_CRITICAL ? "critico" : ratio > DEBT_SERVICE_ATTENTION ? "atencao" : "ok";
    const reasons = [...(missing ? ["parcela_ausente"] : []), ...(i.income.regularity === "irregular" ? ["renda_irregular"] : [])];
    out.push(reading(cSpec, { value: percent(ratio), status, confidence: conf, reasons, inputs: { parcelas_mensais: round(installments), renda_tipica: i.income.typical, dividas_sem_parcela: missing } }));
  }

  // atrasos (motor debt_status.v4 já decide o que está em atraso)
  const aSpec = spec("dividas.atrasos", "contagem", i.asOf, ["balance"]);
  if (!i.overdue) out.push(noData(aSpec, { reasons: ["sem_leitura_de_atraso"] }));
  else {
    const count = i.overdue.count;
    out.push(reading(aSpec, { value: count, status: count === 0 ? "ok" : count === 1 ? "atencao" : "critico", confidence: "alta", reasons: active.length ? [] : none.reasons, inputs: { valor_em_atraso: round(i.overdue.amount), maior_atraso_dias: i.overdue.max_days } }));
  }

  // custo médio mensal ponderado pelo saldo (exige taxa E período informados em ≥ 70% do saldo)
  const kSpec = spec("dividas.custo_medio", "pct", i.asOf, ["declared", "balance"]);
  if (!active.length) out.push(noData(kSpec, none));
  else {
    const withRate = active.filter((d) => d.interest_rate_pct !== null && d.interest_rate_period !== null);
    const covered = withRate.reduce((a, d) => a + d.outstanding_balance, 0);
    if (covered / balance < DEBT_DATA_COVERAGE_MIN) {
      out.push(noData(kSpec, { reasons: ["taxa_ou_periodo_ausente"], needs: { kind: "capture", code: "debt_rate" }, inputs: { dividas: active.length, com_taxa_e_periodo: withRate.length, cobertura_do_saldo: round(covered / balance) } }));
    } else {
      const weighted = withRate.reduce((a, d) => a + d.outstanding_balance * (d.interest_rate_period === "ano" ? annualToMonthlyPct(d.interest_rate_pct as number) : (d.interest_rate_pct as number)), 0) / covered;
      out.push(reading(kSpec, { value: weighted, status: weighted > DEBT_COST_CRITICAL_PM ? "critico" : weighted > DEBT_COST_OK_PM ? "atencao" : "ok", confidence: "moderada", inputs: { cobertura_do_saldo: round(covered / balance), dividas_consideradas: withRate.length } }));
    }
  }

  // trajetória do saldo devedor no mês (ponte patrimonial; mês parcial, em R$ e %, nunca razão sobre renda)
  const tSpec = spec("dividas.trajetoria", "pct", i.asOf, ["derived"]);
  const b = i.snapshot?.bridge;
  if (!b || b.openingDebts === null || b.closingDebts === null) out.push(noData(tSpec, { reasons: ["sem_ponte_patrimonial"], needs: { kind: "connect", code: "snapshot" } }));
  else if (b.openingDebts <= 0) out.push(reading(tSpec, { value: 0, status: "ok", confidence: bridgeConfidence(b.confidence), reasons: ["mes_parcial", "sem_saldo_inicial"], inputs: { saldo_inicial: b.openingDebts, saldo_atual: b.closingDebts } }));
  else {
    const change = (b.closingDebts - b.openingDebts) / b.openingDebts;
    out.push(reading(tSpec, {
      value: percent(change), status: change > DEBT_GROWTH_CRITICAL ? "critico" : change > 0 ? "atencao" : "ok", confidence: bridgeConfidence(b.confidence), reasons: ["mes_parcial"],
      inputs: { saldo_inicial: round(b.openingDebts), saldo_atual: round(b.closingDebts), amortizacao_principal: b.debtPrincipalChange },
    }));
  }

  // perfil: parte do saldo em modalidades de custo alto (exige tipo informado em ≥ 70% do saldo)
  const pSpec = spec("dividas.perfil_custo_alto", "pct", i.asOf, ["declared", "balance"]);
  if (!active.length) out.push(noData(pSpec, none));
  else {
    const typed = active.filter((d) => d.kind !== null);
    const typedBalance = typed.reduce((a, d) => a + d.outstanding_balance, 0);
    if (typedBalance / balance < DEBT_DATA_COVERAGE_MIN) {
      out.push(noData(pSpec, { reasons: ["tipo_de_divida_ausente"], needs: { kind: "capture", code: "debt_kind" }, inputs: { dividas: active.length, com_tipo: typed.length, cobertura_do_saldo: round(typedBalance / balance) } }));
    } else {
      const high = typed.filter((d) => (HIGH_COST_DEBT_KINDS as readonly string[]).includes(d.kind as string)).reduce((a, d) => a + d.outstanding_balance, 0);
      const share = high / typedBalance;
      out.push(reading(pSpec, { value: percent(share), status: share >= DEBT_HIGH_COST_CRITICAL ? "critico" : share >= DEBT_HIGH_COST_ATTENTION ? "atencao" : "ok", confidence: "moderada", inputs: { saldo_custo_alto: round(high), saldo_classificado: round(typedBalance) } }));
    }
  }
  return out;
}
