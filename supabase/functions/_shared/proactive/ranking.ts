// deno-lint-ignore-file no-explicit-any
// proactive_multifinance.v1 — ranking determinístico e orçamento de atenção.
// A cota de interrupção é escassa: fala quem tem maior impacto material,
// urgência real, confiança suficiente e ação executável.
import { insightValue, isAppTaskKind, materialityFloor } from "../intelligence/insightValue.ts";
import { effectiveScore, shouldDeferByTiming } from "./behavioralTiming.ts";
import { repeatedKind, type RecentDelivery } from "./repetition.ts";

import {
  DEFAULT_ATTENTION_BUDGET,
  type AttentionBudget,
  type FinancialSituation,
  type MultiFinanceProactiveContext,
  type ProactiveDecision,
} from "./contracts.ts";

/** Multiplicador de cruzamento de domínios: situação integrada vale mais. */
function crossDomainBoost(situation: FinancialSituation): number {
  return Math.min(3, Math.max(0, situation.domains.length - 1)) * 6;
}

/** Afinidade do tópico da situação (-1..+1); 0 quando desconhecida. */
function affinityFor(ctx: MultiFinanceProactiveContext, situation: FinancialSituation): number {
  const map = ctx.affinity ?? {};
  const topic = String((situation.evidence as any)?.logical_topic_key ?? situation.fingerprint);
  const raw = map[topic] ?? map[situation.fingerprint] ?? 0;
  return Math.max(-1, Math.min(1, Number(raw) || 0));
}

export function scoreSituations(
  situations: FinancialSituation[],
  ctx: MultiFinanceProactiveContext,
): FinancialSituation[] {
  return situations
    .map((situation) => {
      const learning = ctx.learning[situation.communication_kind] ?? {
        dismissals: 0, actions: 0, false_positives: 0,
      };
      const value = insightValue({
        kind: situation.communication_kind,
        severity: situation.severity,
        confidence: situation.confidence,
        impactAmount: situation.impact_amount,
        monthlyIncome: ctx.monthly_income,
        daysUntilEvent: situation.days_until,
        actionable: situation.actionable,
        dismissals: learning.dismissals,
        actions: learning.actions,
        falsePositives: learning.false_positives,
      });
      const crossBoost = crossDomainBoost(situation);
      // proactive_user_model.v1 — situação que toca meta/plano da pessoa.
      const relevanceBoost = Math.max(0, Number((situation.evidence as any)?.relevance_boost ?? 0));
      const boost = crossBoost + relevanceBoost;
      const reasons = [...situation.score_reasons.filter((r) => r.startsWith("data_quality:")), ...value.reasons];
      if (crossBoost > 0) reasons.push(`cross_domain:${crossBoost}`);
      if (relevanceBoost > 0) reasons.push(`user_relevance:${relevanceBoost}`);
      if (value.muted) reasons.push("muted_by_learning");

      // Preferência aprendida ordena o que é OPCIONAL (± 25%). Situação
      // crítica ou vencendo em até 3 dias ignora gosto: risco não se negocia.
      const optional = situation.severity === "info"
        || (situation.severity === "attention" && (situation.days_until ?? 99) > 3);
      const affinity = optional ? affinityFor(ctx, situation) : 0;
      const scored = (value.score + boost) * (1 + affinity * 0.25);
      if (affinity !== 0) reasons.push(`affinity:${affinity.toFixed(2)}`);

      // nino_behavioral_timing.v1 — o QUE importa (priority) e se é AGORA
      // (timing) são scores separados; a fila usa a combinação determinística.
      const timing = (situation.evidence as any)?.behavioral_timing ?? null;
      const timingScore = Number(
        situation.timing_score ?? timing?.timing_score ?? 50,
      );
      const priority = Math.round(scored * 100) / 100;
      const effective = effectiveScore(priority, timingScore);
      reasons.push(`timing:${Math.round(timingScore)}`);

      return {
        ...situation,
        priority_score: priority,
        timing_score: Math.round(timingScore * 100) / 100,
        timing_trigger: situation.timing_trigger ?? timing?.trigger ?? null,
        timing_window: situation.timing_window ?? timing?.window ?? null,
        effective_score: effective,
        defer_until: situation.defer_until ?? timing?.defer_until ?? null,
        score_reasons: reasons,
      };
    })
    .sort((a, b) => (b.effective_score ?? b.priority_score) - (a.effective_score ?? a.priority_score));
}


/** Piso de materialidade: risco crítico e vencimento sempre passam. */
export function meetsSituationMateriality(
  situation: FinancialSituation,
  ctx: MultiFinanceProactiveContext,
): boolean {
  if (situation.severity === "critical") return true;
  // Pedido de dado não tem valor em R$: vale pelo que destrava nas leituras.
  if (situation.communication_kind === "data_quality") return true;
  // Urgência dispensa o piso apenas quando há risco: contexto informativo de
  // valor pequeno nunca vale uma interrupção, mesmo vencendo amanhã.
  if (situation.severity !== "info" && (situation.days_until ?? 99) <= 3) return true;
  if (situation.impact_amount <= 0) return false;
  return situation.impact_amount >= materialityFloor(ctx.monthly_income);
}

export type BudgetInput = {
  situations: FinancialSituation[];
  ctx: MultiFinanceProactiveContext;
  channels: Array<"app" | "whatsapp">;
  budget?: AttentionBudget;
  /** Fingerprints já comunicados sem mudança material desde então. */
  alreadyDelivered?: Set<string>;
  /** Entregas recentes por tipo/canal (janela anti-repetição por assunto). */
  recentDeliveries?: RecentDelivery[];
  now?: Date;
  minConfidence?: number;
};

/** Decide, por canal, quem fala e por que os demais foram retidos. */
export function allocateAttention(input: BudgetInput): {
  decisions: ProactiveDecision[];
  selected: FinancialSituation[];
  /** Situações já pontuadas (ordem e `priority_score` reais). */
  ranked: FinancialSituation[];
} {
  const budget = input.budget ?? DEFAULT_ATTENTION_BUDGET;
  const minConfidence = input.minConfidence ?? 0.6;
  const decisions: ProactiveDecision[] = [];
  const selected = new Map<string, FinancialSituation>();
  const ranked = scoreSituations(input.situations, input.ctx);

  for (const channel of input.channels) {
    let remaining = channel === "whatsapp" ? budget.whatsapp : budget.app;
    // Diversidade: um assunto (tipo) por canal por rodada.
    const kindsThisRound = new Set<string>();
    for (const situation of ranked) {
      const timing = (situation.evidence as any)?.behavioral_timing ?? null;
      const timingOwned = (situation.evidence as any)?.behavioral_timing_owned === true;
      const base = {
        fingerprint: situation.fingerprint,
        channel,
        priority_score: situation.priority_score,
        timing_score: situation.timing_score ?? null,
        timing_trigger: situation.timing_trigger ?? null,
        timing_window: situation.timing_window ?? null,
        effective_score: situation.effective_score ?? situation.priority_score,
        defer_until: situation.defer_until ?? null,
      } as ProactiveDecision & Record<string, unknown>;
      if (input.alreadyDelivered?.has(situation.fingerprint)) {
        decisions.push({ ...base, decision: "suppress", reason: "already_communicated_no_material_change" });
        continue;
      }
      // Tarefa de revisão (pedido de dado, categorização) é do app: não gasta
      // a única vaga de interrupção do WhatsApp.
      if (channel === "whatsapp" && isAppTaskKind(situation.communication_kind)) {
        decisions.push({ ...base, decision: "suppress", reason: "app_only_kind" });
        continue;
      }
      const repeat = repeatedKind(situation, channel, input.recentDeliveries ?? [], input.now ?? new Date());
      if (repeat) {
        decisions.push({ ...base, decision: "suppress", reason: repeat });
        continue;
      }
      if (situation.score_reasons.includes("muted_by_learning")) {
        decisions.push({ ...base, decision: "suppress", reason: "muted_by_learning" });
        continue;
      }
      if (!meetsSituationMateriality(situation, input.ctx)) {
        decisions.push({ ...base, decision: "suppress", reason: "below_materiality_floor" });
        continue;
      }
      if (situation.confidence < minConfidence) {
        decisions.push({ ...base, decision: "suppress", reason: "confidence_too_low" });
        continue;
      }
      // Momento fraco adia (não descarta) o que nasceu do motor de timing.
      // Detector antigo nunca é bloqueado por timing: ele só é reordenado.
      if (timingOwned && timing && shouldDeferByTiming(timing, situation.severity)) {
        decisions.push({
          ...base,
          decision: "defer",
          reason: `timing_not_now:${timing.reason ?? "low_timing_score"}`,
        });
        continue;
      }

      if (kindsThisRound.has(situation.communication_kind) && situation.severity !== "critical") {
        decisions.push({ ...base, decision: "suppress", reason: "same_kind_in_round" });
        continue;
      }
      if (remaining <= 0) {
        decisions.push({ ...base, decision: "suppress", reason: "attention_budget_exhausted" });
        continue;
      }
      remaining -= 1;
      kindsThisRound.add(situation.communication_kind);
      selected.set(situation.fingerprint, situation);
      decisions.push({ ...base, decision: "deliver", reason: "top_ranked_material_situation" });
    }
  }

  return { decisions, selected: [...selected.values()], ranked };
}
