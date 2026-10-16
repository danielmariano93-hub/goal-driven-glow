// E11 — Prioridade e recomendação. Gate ESTRUTURAL primeiro: se a dificuldade é de renda/obrigações, a recomendação é estrutural
// e não vira dica de comportamento (capacidade e oportunidade antes de motivação). Senão: uma ação, a de maior
// severidade × reversibilidade × confiança. Respeita o que a pessoa já recusou e entrega no máximo UMA recomendação.
import type {
  DataQuality, MapaActionType, MapaIndicator, MapaRecommendation, MapaRecommendationFeedback, StructuralFlags,
} from "./mapaContracts";
import {
  DEBT_SERVICE_CRITICAL, ESSENTIAL_STRUCTURAL_SHARE, NEGATIVE_STREAK_STRUCTURAL, RECOMMENDATION_ACCEPTED_COOLDOWN_DAYS,
  RECOMMENDATION_DISMISS_COOLDOWN_DAYS, RECOMMENDATION_NOT_USEFUL_COOLDOWN_DAYS,
} from "./mapaThresholds";

export const RECOMMENDATION_FORMULA = "mapa_recommendation.v1";

export interface RecommendationInput {
  asOf: string;
  indicators: MapaIndicator[];
  structural: StructuralFlags;
  dq: DataQuality;
  feedback: MapaRecommendationFeedback[];
}

/** Para onde cada ação leva. Só recursos que já existem no app. */
export const ACTION_DEEPLINK: Record<MapaActionType, string> = {
  renegociar_dividas: "/app/dividas",
  regularizar_atrasos: "/app/dividas",
  plano_de_pagamento: "/app/dividas",
  revisar_essenciais: "/app/recorrencias",
  fechar_a_conta: "/app/relatorios",
  criar_reserva: "/app/metas",
  ajustar_meta: "/app/metas",
  cadastrar_contas_fixas: "/app/recorrencias",
};

const CONF: Record<string, number> = { alta: 1, moderada: 0.7, insuficiente: 0 };
const SEVERITY: Record<string, number> = { critico: 3, atencao: 1.5 };
const daysSince = (iso: string, asOf: string) => (Date.parse(`${asOf}T12:00:00Z`) - Date.parse(iso)) / 86_400_000;

/** A recomendação foi recusada/avaliada/aceita há pouco? Então fica de fora. */
export function isSuppressed(id: string, feedback: MapaRecommendationFeedback[], asOf: string): boolean {
  return feedback.some((f) => {
    if (f.rec_id !== id) return false;
    const age = daysSince(f.at, asOf);
    if (f.event === "dismissed") return age < RECOMMENDATION_DISMISS_COOLDOWN_DAYS;
    if (f.event === "not_useful") return age < RECOMMENDATION_NOT_USEFUL_COOLDOWN_DAYS;
    if (f.event === "accepted") return age < RECOMMENDATION_ACCEPTED_COOLDOWN_DAYS;
    return false;
  });
}

interface Candidate { rec: MapaRecommendation }

const make = (kind: MapaRecommendation["kind"], type: MapaActionType, indicator_ids: string[], rationale_keys: string[], score: number, guardrails: string[]): Candidate => ({
  rec: { id: `${kind}:${type}`, kind, indicator_ids, rationale_keys, action: { type, deeplink: ACTION_DEEPLINK[type] }, priority_score: Math.round(score * 100) / 100, guardrails },
});

const by = (inds: MapaIndicator[], id: string) => inds.find((i) => i.id === id);
const severe = (i?: MapaIndicator) => (i && i.value !== null && i.status in SEVERITY ? SEVERITY[i.status] * CONF[i.confidence] : 0);

export function computeRecommendation(i: RecommendationInput): MapaRecommendation | null {
  const s = i.structural;

  // 1) Gate estrutural: se for estrutural, só recomendações estruturais entram.
  if (s.structural === true) {
    const out: Candidate[] = [];
    if (s.debt_service_ratio !== null && s.debt_service_ratio > DEBT_SERVICE_CRITICAL) {
      out.push(make("estrutural", "renegociar_dividas", ["dividas.comprometimento_renda"], ["debt_service_above_half"], 5, ["nao_sugerir_corte_de_pequenos_gastos"]));
    }
    if (s.essential_share_of_income !== null && s.essential_share_of_income > ESSENTIAL_STRUCTURAL_SHARE) {
      out.push(make("estrutural", "revisar_essenciais", ["seguranca.meses_cobertos"], ["essential_share_above_80"], 4, ["nao_sugerir_corte_de_pequenos_gastos"]));
    }
    if (s.negative_result_streak !== null && s.negative_result_streak >= NEGATIVE_STREAK_STRUCTURAL) {
      out.push(make("estrutural", "fechar_a_conta", ["equilibrio.resultado_3m"], ["negative_result_streak_3"], 4, ["nao_sugerir_corte_de_pequenos_gastos"]));
    }
    const pick = out.filter((c) => !isSuppressed(c.rec.id, i.feedback, i.asOf)).sort((a, b) => b.rec.priority_score - a.rec.priority_score)[0];
    return pick ? withAllRationales(pick.rec, out) : null;
  }

  // 2) Comportamento e ação: um candidato por situação, o de maior prioridade vence.
  const ind = i.indicators;
  const out: Candidate[] = [];
  const overdue = by(ind, "dividas.atrasos");
  if (overdue && overdue.value !== null && overdue.value > 0) {
    out.push(make("comportamento", "regularizar_atrasos", [overdue.id], ["debt_overdue"], 5 * 0.8 * (CONF[overdue.confidence] || 1), ["tom_sem_cobranca"]));
  }
  const cost = by(ind, "dividas.custo_medio"), profile = by(ind, "dividas.perfil_custo_alto");
  const debtSeverity = Math.max(severe(cost), severe(profile));
  if (debtSeverity > 0) out.push(make("comportamento", "plano_de_pagamento", [cost, profile].filter((x): x is MapaIndicator => !!x && severe(x) > 0).map((x) => x.id), ["debt_cost_high"], debtSeverity * 0.7, []));
  const reserve = by(ind, "seguranca.meses_cobertos");
  if (severe(reserve) > 0) {
    out.push(make("comportamento", "criar_reserva", [reserve!.id], ["reserve_low"], severe(reserve) * 0.9, reserve!.inputs.base === "gastos_totais" ? ["base_gastos_totais"] : []));
  }
  const rate = by(ind, "equilibrio.taxa_poupanca_3m"), result = by(ind, "equilibrio.resultado_3m");
  const flow = Math.max(severe(rate), severe(result));
  if (flow > 0) out.push(make("comportamento", "ajustar_meta", [rate, result].filter((x): x is MapaIndicator => !!x && severe(x) > 0).map((x) => x.id), ["savings_low"], flow * 0.9, []));
  const fit = by(ind, "planejamento.viabilidade");
  if (severe(fit) > 0) out.push(make("comportamento", "ajustar_meta", [fit!.id], ["plan_does_not_fit"], severe(fit) * 0.9, []));
  const adherence = by(ind, "execucao.aderencia");
  if (severe(adherence) > 0) out.push(make("comportamento", "ajustar_meta", [adherence!.id], ["goal_adherence_low"], severe(adherence) * 1.0, ["meta_pode_estar_apertada"]));
  const fixed = by(ind, "planejamento.recorrentes_registrados");
  if (severe(fixed) > 0) out.push(make("comportamento", "cadastrar_contas_fixas", [fixed!.id], ["fixed_bills_unregistered"], severe(fixed) * 1.0, []));

  // mesma ação por vários motivos: junta as evidências e fica com o maior score
  const byId = new Map<string, MapaRecommendation>();
  for (const c of out) {
    const prev = byId.get(c.rec.id);
    byId.set(c.rec.id, prev ? {
      ...(c.rec.priority_score > prev.priority_score ? c.rec : prev),
      indicator_ids: [...new Set([...prev.indicator_ids, ...c.rec.indicator_ids])],
      rationale_keys: [...new Set([...prev.rationale_keys, ...c.rec.rationale_keys])],
      guardrails: [...new Set([...prev.guardrails, ...c.rec.guardrails])],
    } : c.rec);
  }
  return [...byId.values()].filter((r) => !isSuppressed(r.id, i.feedback, i.asOf)).sort((a, b) => b.priority_score - a.priority_score)[0] ?? null;
}

function withAllRationales(rec: MapaRecommendation, all: Candidate[]): MapaRecommendation {
  return { ...rec, rationale_keys: [...new Set([rec.rationale_keys, ...all.map((c) => c.rec.rationale_keys)].flat())] };
}
