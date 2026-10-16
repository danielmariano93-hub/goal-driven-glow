// E7 — Planejamento (hábitos). O plano da pessoa cabe na renda? Os gastos fixos estão cadastrados? Ela decide ou age no improviso?
// Não premia quantidade de metas: mede viabilidade e cobertura, não volume.
import type { DataQuality, IncomeBaseline, MapaIndicator } from "./mapaContracts";
import { noData, pointWindow, reading, round, ledgerConfidence, percent, type IndicatorSpec } from "./mapaIndicator";
import type { MapaHabitInputs, MapaSavingsGoalIn } from "./mapaInputs";
import type { EssentialMonthly } from "./mapaSeguranca";
import { INTENT_MIN_ANSWERS, RECURRING_MIN_DETECTED, RECURRING_REGISTERED_OK_PCT, VIABILITY_LIMIT, VIABILITY_OK } from "./mapaThresholds";

export const PLANEJAMENTO_FORMULA = "mapa_planejamento.v1";

export interface PlanejamentoInput {
  asOf: string;
  dq: DataQuality;
  income: IncomeBaseline;
  essential: EssentialMonthly | null;
  savingsGoals: MapaSavingsGoalIn[];
  habits: Pick<MapaHabitInputs, "recurringDetected" | "recurringRegistered" | "recurringNonEssentialMonthly" | "plannedAnswers" | "totalAnswers">;
}

const spec = (id: string, unit: IndicatorSpec["unit"], direction: IndicatorSpec["direction"], asOf: string, evidence: IndicatorSpec["evidence"]): IndicatorSpec =>
  ({ id, pillar: "planejamento", layer: "habitos", unit, direction, window: pointWindow(asOf), evidence, formula: PLANEJAMENTO_FORMULA });

const monthsBetween = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));

/** Aporte mensal necessário por meta com prazo; metas sem prazo ficam de fora (e contadas à parte). */
export function monthlyGoalContributions(goals: MapaSavingsGoalIn[], asOf: string): { total: number; withDeadline: number; withoutDeadline: number } {
  let total = 0, withDeadline = 0, withoutDeadline = 0;
  for (const g of goals) {
    const missing = Math.max(0, g.target_amount - g.saved_amount);
    if (missing <= 0) continue;
    if (!g.target_date) { withoutDeadline += 1; continue; }
    withDeadline += 1;
    total += missing / Math.max(1, monthsBetween(asOf, g.target_date));
  }
  return { total: round(total), withDeadline, withoutDeadline };
}

export function computePlanejamento(i: PlanejamentoInput): MapaIndicator[] {
  const out: MapaIndicator[] = [];

  // Viabilidade: (essenciais + aportes das metas + recorrências não essenciais) ÷ renda típica.
  const vSpec = spec("planejamento.viabilidade", "razao", "lower_better", i.asOf, ["ledger", "goal", "estimate"]);
  if (i.income.typical === null || i.dq.eligibility.razoes_de_renda === "bloqueado") {
    out.push(noData(vSpec, { reasons: ["poucos_meses_fechados"], needs: { kind: "history", code: "meses_fechados" } }));
  } else if (i.income.typical <= 0) {
    out.push(noData(vSpec, { reasons: ["sem_renda_registrada"], needs: { kind: "capture", code: "renda" } }));
  } else if (!i.essential || i.essential.basis !== "essenciais") {
    out.push(noData(vSpec, { reasons: ["essential_flag_missing"], needs: { kind: "capture", code: "essencial_categoria" } }));
  } else {
    const goals = monthlyGoalContributions(i.savingsGoals, i.asOf);
    const recurring = i.habits.recurringNonEssentialMonthly ?? 0;
    const commitments = i.essential.value + goals.total + recurring;
    const ratio = commitments / i.income.typical;
    out.push(reading(vSpec, {
      value: ratio, status: ratio <= VIABILITY_OK ? "ok" : ratio <= VIABILITY_LIMIT ? "atencao" : "critico",
      confidence: ledgerConfidence(i.dq, i.income),
      inputs: {
        essenciais_mensal: i.essential.value, aportes_metas_mensal: goals.total, recorrentes_nao_essenciais_mensal: round(recurring),
        renda_tipica: round(i.income.typical), metas_sem_prazo: goals.withoutDeadline,
      },
      reasons: [...(i.income.regularity === "irregular" ? ["renda_irregular"] : []), ...(goals.withoutDeadline ? ["metas_sem_prazo"] : [])],
    }));
  }

  // Recorrências registradas: detectadas no histórico que já estão cadastradas.
  const rSpec = spec("planejamento.recorrentes_registrados", "pct", "higher_better", i.asOf, ["ledger", "declared"]);
  if (i.habits.recurringDetected < RECURRING_MIN_DETECTED) {
    out.push(noData(rSpec, { reasons: ["poucas_recorrencias_detectadas"], inputs: { detectadas: i.habits.recurringDetected } }));
  } else {
    const pct = percent(i.habits.recurringRegistered / i.habits.recurringDetected);
    out.push(reading(rSpec, {
      value: pct, status: pct >= RECURRING_REGISTERED_OK_PCT ? "ok" : "atencao", confidence: i.habits.recurringDetected >= 5 ? "alta" : "moderada",
      inputs: { detectadas: i.habits.recurringDetected, cadastradas: i.habits.recurringRegistered },
    }));
  }

  // Intencionalidade: respostas voluntárias "já planejo" ÷ respondidas. Descritivo (neutro): decidir na hora não é errado.
  const nSpec = spec("planejamento.intencionalidade", "pct", "neutral", i.asOf, ["declared"]);
  if (i.habits.totalAnswers < INTENT_MIN_ANSWERS) {
    out.push(noData(nSpec, { reasons: ["poucas_respostas"], needs: { kind: "capture", code: "planejado_vs_hora" }, inputs: { respostas: i.habits.totalAnswers, minimo: INTENT_MIN_ANSWERS } }));
  } else {
    out.push(reading(nSpec, {
      value: percent(i.habits.plannedAnswers / i.habits.totalAnswers), status: "ok", confidence: i.habits.totalAnswers >= 10 ? "alta" : "moderada",
      inputs: { planejados: i.habits.plannedAnswers, respondidas: i.habits.totalAnswers },
    }));
  }
  return out;
}
