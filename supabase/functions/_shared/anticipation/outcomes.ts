// anticipation_contract.v2 — ciclo de aprendizado (outcome).
//
// Depois que a janela de uma oportunidade fecha, comparamos o que foi
// antecipado com o que realmente aconteceu nos fatos comportamentais já
// consolidados. O resultado ajusta a confiança do padrão — para cima quando
// acerta, para baixo quando erra — e fica registrado como evidência.
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { round2 } from "../finance-core/facts.ts";
import { ANTICIPATION_FORMULA_VERSION, type DetectorKey } from "./contracts.ts";

export type OutcomeVerdict = "unknown" | "confirmed" | "partial" | "not_confirmed" | "insufficient_data";

export type OutcomeEvaluation = {
  outcome: OutcomeVerdict;
  confidence_delta: number;
  reason: string;
};

/**
 * Regra determinística e simétrica:
 * - `actual >= predicted * 0.85` → confirmado (+0.05)
 * - `actual >= baseline + 40% do delta` → parcial (0)
 * - abaixo disso → não confirmado (-0.08)
 * Feedback explícito do usuário sempre pesa mais que o número.
 */
export function evaluateOutcome(input: {
  predicted: number;
  baseline: number;
  actual: number | null;
  feedback?: string | null;
}): OutcomeEvaluation {
  if (input.feedback === "not_useful" || input.feedback === "muted") {
    return { outcome: "not_confirmed", confidence_delta: -0.1, reason: "user_feedback_negative" };
  }
  if (input.actual === null || !Number.isFinite(input.actual)) {
    return { outcome: "insufficient_data", confidence_delta: 0, reason: "no_facts_for_window" };
  }
  const predicted = Number(input.predicted) || 0;
  const baseline = Number(input.baseline) || 0;
  const delta = predicted - baseline;
  const actual = Number(input.actual);

  if (predicted <= 0) {
    return { outcome: "insufficient_data", confidence_delta: 0, reason: "no_prediction_value" };
  }
  if (actual >= predicted * 0.85) {
    const bonus = input.feedback === "useful" ? 0.08 : 0.05;
    return { outcome: "confirmed", confidence_delta: bonus, reason: "actual_reached_prediction" };
  }
  if (delta > 0 && actual >= baseline + delta * 0.4) {
    return { outcome: "partial", confidence_delta: 0, reason: "actual_between_baseline_and_prediction" };
  }
  return { outcome: "not_confirmed", confidence_delta: -0.08, reason: "actual_below_baseline_band" };
}

/** Qual métrica diária representa o assunto antecipado. */
function actualMetricFor(detector: DetectorKey): "total_adjustable" | "total_small_spend" | "total_card" | null {
  switch (detector) {
    case "weekday_spending_risk":
    case "weekend_spending_risk":
    case "month_phase_spending_risk":
      return "total_adjustable";
    case "small_spend_acceleration":
      return "total_small_spend";
    case "card_cycle_acceleration":
      return "total_card";
    // Compromisso recorrente e pressão de caixa não são "gasto do dia":
    // são avaliados por confirmação de compromisso, tratada como
    // insufficient_data até existir liquidação registrada.
    default:
      return null;
  }
}

export type OutcomeRunResult = {
  evaluated: number;
  written: number;
  confirmed: number;
  not_confirmed: number;
  insufficient: number;
  patterns_adjusted: number;
  errors: string[];
};

/**
 * Avalia oportunidades já despachadas cuja janela terminou e que ainda não têm
 * outcome registrado. Idempotente por `opportunity_id` (UNIQUE na tabela).
 */
export async function evaluateAnticipationOutcomes(
  sb: SupabaseClient,
  opts: { userId?: string; now?: Date; limit?: number } = {},
): Promise<OutcomeRunResult> {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const out: OutcomeRunResult = {
    evaluated: 0, written: 0, confirmed: 0, not_confirmed: 0,
    insufficient: 0, patterns_adjusted: 0, errors: [],
  };

  let query = sb.from("anticipation_opportunities")
    .select("id,user_id,pattern_id,detector,opportunity_date,window_end,expected_value,baseline_value,dry_run,dedup_key")
    .eq("status", "dispatched")
    .lt("window_end", nowIso)
    .order("window_end", { ascending: true })
    .limit(opts.limit ?? 100);
  if (opts.userId) query = query.eq("user_id", opts.userId);

  const { data, error } = await query;
  if (error) throw new Error(`anticipation_opportunities:${error.message}`);
  const rows = ((data as any[] | null) ?? []);
  out.evaluated = rows.length;
  if (rows.length === 0) return out;

  // Oportunidades já avaliadas não são reprocessadas.
  const ids = rows.map((r) => String(r.id));
  const { data: existing } = await sb.from("anticipation_outcomes")
    .select("opportunity_id").in("opportunity_id", ids);
  const done = new Set(((existing as any[] | null) ?? []).map((r) => String(r.opportunity_id)));

  for (const row of rows) {
    if (done.has(String(row.id))) continue;
    try {
      const metric = actualMetricFor(row.detector as DetectorKey);
      let actual: number | null = null;
      if (metric) {
        const { data: fact } = await sb.from("behavioral_daily_facts")
          .select(metric)
          .eq("user_id", row.user_id)
          .eq("local_date", row.opportunity_date)
          .eq("formula_version", ANTICIPATION_FORMULA_VERSION)
          .maybeSingle();
        actual = fact ? Number((fact as any)[metric] ?? 0) : null;
      }

      const { data: feedbackRow } = await sb.from("communication_feedback")
        .select("feedback")
        .eq("user_id", row.user_id)
        .eq("dedup_key", row.dedup_key)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const feedback = feedbackRow ? String((feedbackRow as any).feedback) : null;

      const verdict = evaluateOutcome({
        predicted: Number(row.expected_value ?? 0),
        baseline: Number(row.baseline_value ?? 0),
        actual,
        feedback,
      });

      const { error: insertError } = await sb.from("anticipation_outcomes").insert({
        user_id: row.user_id,
        opportunity_id: row.id,
        pattern_id: row.pattern_id,
        detector: row.detector,
        opportunity_date: row.opportunity_date,
        predicted_value: round2(Number(row.expected_value ?? 0)),
        actual_value: round2(actual ?? 0),
        baseline_value: round2(Number(row.baseline_value ?? 0)),
        outcome: verdict.outcome,
        user_feedback: feedback,
        interacted: feedback !== null,
        acted: feedback === "useful",
        confidence_delta: verdict.confidence_delta,
        evidence: {
          reason: verdict.reason,
          metric: metric ?? "not_applicable",
          actual_available: actual !== null,
          dry_run: Boolean(row.dry_run),
        },
        formula_version: ANTICIPATION_FORMULA_VERSION,
      });
      if (insertError) {
        if (!String(insertError.message).toLowerCase().includes("duplicate")) {
          out.errors.push(`outcome_insert:${insertError.message}`.slice(0, 200));
        }
        continue;
      }
      out.written += 1;
      if (verdict.outcome === "confirmed") out.confirmed += 1;
      else if (verdict.outcome === "not_confirmed") out.not_confirmed += 1;
      else if (verdict.outcome === "insufficient_data") out.insufficient += 1;

      // Aprendizado: ajusta a confiança do padrão e enfraquece o que erra muito.
      if (row.pattern_id && verdict.confidence_delta !== 0) {
        const { data: pattern } = await sb.from("behavioral_patterns")
          .select("confidence,status").eq("id", row.pattern_id).maybeSingle();
        if (pattern) {
          const next = Math.max(0, Math.min(0.98, round2(Number((pattern as any).confidence ?? 0) + verdict.confidence_delta)));
          const status = next < 0.4
            ? "weakened"
            : ((pattern as any).status === "weakened" && next >= 0.6 ? "validated" : (pattern as any).status);
          const { error: updateError } = await sb.from("behavioral_patterns")
            .update({ confidence: next, status, updated_at: nowIso }).eq("id", row.pattern_id);
          if (updateError) out.errors.push(`pattern_adjust:${updateError.message}`.slice(0, 200));
          else out.patterns_adjusted += 1;
        }
      }
    } catch (e) {
      out.errors.push(`outcome:${e instanceof Error ? e.message : String(e)}`.slice(0, 200));
    }
  }

  return out;
}
