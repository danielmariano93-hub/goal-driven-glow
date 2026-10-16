import type { GoalHistory } from "@/lib/engine/goalHistory";
import type { BehavioralGoalCycle } from "@/lib/engine/behaviorObserved";

/**
 * Períodos de meta já terminados, na mesma fonte da tela de Metas (histórico por categoria e mês).
 * Hábitos e Metas precisam contar igual: o histórico junta os meses guardados com as metas vivas
 * (ex.: "este mês" que já passou), calculados pelo livro oficial (competência do cartão, estornos).
 */
export function goalCyclesFromHistory(history: GoalHistory | null | undefined): BehavioralGoalCycle[] {
  if (!history) return [];
  const out: BehavioralGoalCycle[] = [];
  for (const series of history.series) {
    for (const m of series.months) {
      if ((m.status !== "met" && m.status !== "missed") || m.limit == null || m.limit <= 0) continue;
      const [y, mo] = m.month.split("-").map(Number);
      const end = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
      out.push({
        start_date: `${m.month}-01`,
        end_date: end,
        target_snapshot: m.limit,
        actual_spend: m.actual,
        projected_spend: null,
        final_status: m.status,
        closed_at: `${end}T23:59:59Z`,
      });
    }
  }
  return out.sort((a, b) => String(b.end_date).localeCompare(String(a.end_date)));
}
