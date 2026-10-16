// Montagem da leitura do Mapa Financeiro (`mapa_financeiro.v1`): E0, E1 e os motores de saúde financeira (E2 a E5).
import { MAPA_CONTRACT, type MapaIndicator, type MapaReading } from "./mapaContracts";
import { computeDataQuality, type DataQualityInput } from "./mapaDataQuality";
import { computeDividas } from "./mapaDividas";
import { computeEquilibrio } from "./mapaEquilibrio";
import { computeFuturo } from "./mapaFuturo";
import { computeIncomeBaseline } from "./mapaIncomeBaseline";
import { EMPTY_HABIT_INPUTS, EMPTY_HEALTH_INPUTS, type MapaHabitInputs, type MapaHealthInputs } from "./mapaInputs";
import { computeAcompanhamento } from "./mapaAcompanhamento";
import { computeExecucao } from "./mapaExecucao";
import { computePlanejamento } from "./mapaPlanejamento";
import { scheduleQuestions } from "./mapaQuestions";
import { applyEvolution, dqSignature } from "./mapaEvolution";
import { computeRecommendation } from "./mapaRecommendation";
import type { MapaRecommendationFeedback, MapaStoredReading } from "./mapaContracts";
import { aggregateMonths, type MapaMonthlyEntry } from "./mapaMonthly";
import { computeSeguranca } from "./mapaSeguranca";
import { computeStructural } from "./mapaStructural";

export interface BuildMapaInput {
  asOf: string;
  entries: MapaMonthlyEntry[];
  lastSyncAgeDays?: DataQualityInput["lastSyncAgeDays"];
  reconciliationDifference?: DataQualityInput["reconciliationDifference"];
  health?: Partial<MapaHealthInputs>;
  habits?: Partial<MapaHabitInputs>;
  /** Leituras anteriores guardadas (E10). */
  history?: MapaStoredReading[];
  /** Respostas da pessoa a recomendações anteriores (E11). */
  feedback?: MapaRecommendationFeedback[];
  /** Instante de referência para o agendador de perguntas (ISO). Padrão: meio-dia de `asOf`. */
  nowIso?: string;
}

export function buildMapaReading(input: BuildMapaInput): MapaReading {
  const months = aggregateMonths(input.entries, input.asOf);
  const dq = computeDataQuality({ asOf: input.asOf, entries: input.entries, months, lastSyncAgeDays: input.lastSyncAgeDays, reconciliationDifference: input.reconciliationDifference });
  const income = computeIncomeBaseline(months);
  const h: MapaHealthInputs = { ...EMPTY_HEALTH_INPUTS, ...(input.health ?? {}) };
  const hb: MapaHabitInputs = { ...EMPTY_HABIT_INPUTS, ...(input.habits ?? {}) };

  const equilibrio = computeEquilibrio({ asOf: input.asOf, months, dq, income, snapshot: h.snapshot });
  const { indicators: seguranca, essential } = computeSeguranca({ asOf: input.asOf, months, entries: input.entries, dq, income, snapshot: h.snapshot, categoryEssential: h.categoryEssential, debts: h.debts, investments: h.investments });
  const dividas = computeDividas({ asOf: input.asOf, dq, income, debts: h.debts, overdue: h.debtOverdue, snapshot: h.snapshot });
  const futuro = computeFuturo({ asOf: input.asOf, dq, income, snapshot: h.snapshot, savingsGoals: h.savingsGoals, redemptions90: h.redemptions90, debtPayments90: h.debtPayments90 });
  const execucao = computeExecucao({ asOf: input.asOf, goalPeriods: hb.goalPeriods, weekendPeriods: hb.weekendPeriods });
  const planejamento = computePlanejamento({ asOf: input.asOf, dq, income, essential, savingsGoals: h.savingsGoals, habits: hb });
  const acompanhamento = computeAcompanhamento({ asOf: input.asOf, entries: input.entries, estimates: hb.estimates, usefulEvents: hb.usefulEvents, notUsefulEvents: hb.notUsefulEvents });
  const raw: MapaIndicator[] = [...equilibrio, ...seguranca, ...dividas, ...futuro, ...execucao, ...planejamento, ...acompanhamento];
  const partial = { data_quality: dq };
  const indicators = applyEvolution(raw, input.history ?? [], input.asOf, dqSignature(partial));
  const structural = computeStructural({ months, income, essential, indicators });

  return {
    contract: MAPA_CONTRACT,
    as_of: input.asOf,
    data_quality: dq,
    income,
    indicators,
    structural,
    recommendation: computeRecommendation({ asOf: input.asOf, indicators, structural, dq, feedback: input.feedback ?? [] }),
    questions_due: scheduleQuestions({ nowIso: input.nowIso ?? `${input.asOf}T12:00:00Z`, asOf: input.asOf, indicators, entries: input.entries, estimates: hb.estimates, questions: hb.questions, lastCfpbAt: hb.lastCfpbAt }),
  };
}
