// MerchantScope — resolução determinística do ESCOPO de uma pergunta de
// distribuição por estabelecimento ("onde eu mais gastei?").
//
// Regra dura: nunca responder um total de categoria sem saber qual categoria é.
// Quando a pergunta é anafórica ("naquela categoria") ou cita uma meta, o
// escopo vem da fonte oficial — o snapshot canônico de metas por categoria
// (mesmo motor consumido pela Home e pela tela de Metas) — e não de heurística.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { computeAgentSnapshot } from "../../engine/metrics.ts";

/** A mensagem se refere a UMA categoria sem nomeá-la ("naquela categoria"). */
export function mentionsAnaphoricCategory(text: string): boolean {
  return /\b(nessa|naquela|dessa|daquela|nesta|desta|na mesma|mesma)\s+categoria\b/i.test(String(text ?? ""))
    || /\bcategoria\s+(?:da|do)\s+meta\b/i.test(String(text ?? ""));
}

/** A mensagem ancora o escopo numa meta ("uma das minhas metas foi ultrapassada"). */
export function mentionsGoalAnchor(text: string): boolean {
  return /\bmetas?\b/i.test(String(text ?? ""));
}

export type GoalScope = {
  category_name: string;
  category_id: string | null;
  period: { from: string; to: string } | null;
  status: string | null;
  source: "goal_exceeded" | "goal_closest_to_cap";
};

const OVER_STATUS = new Set(["estourou", "exceeded", "over", "ultrapassou"]);

/**
 * Categoria da meta com teto ultrapassado (ou a mais próxima do teto) no ciclo
 * ativo. Fonte única: `computeAgentSnapshot` — nunca query paralela em
 * `transactions`.
 */
export async function resolveGoalCategoryScope(
  sb: SupabaseClient,
  user_id: string,
): Promise<GoalScope | null> {
  const snap = await computeAgentSnapshot(sb, user_id);
  const goals: any[] = Array.isArray((snap as any)?.active_category_goals)
    ? (snap as any).active_category_goals
    : [];
  if (!goals.length) return null;

  const withName = goals.filter((goal) => goal?.category_name);
  if (!withName.length) return null;

  const exceeded = withName
    .filter((goal) => OVER_STATUS.has(String(goal.status ?? "").toLowerCase())
      || Number(goal.actual_spend ?? 0) > Number(goal.target_amount ?? 0))
    .sort((a, b) =>
      (Number(b.actual_spend ?? 0) - Number(b.target_amount ?? 0))
      - (Number(a.actual_spend ?? 0) - Number(a.target_amount ?? 0)));

  const pick = exceeded[0]
    ?? withName
      .slice()
      .sort((a, b) =>
        Number(b.actual_spend ?? 0) / Math.max(1, Number(b.target_amount ?? 0))
        - Number(a.actual_spend ?? 0) / Math.max(1, Number(a.target_amount ?? 0)))[0];
  if (!pick) return null;

  const from = typeof pick.period_start === "string" ? pick.period_start : null;
  const to = typeof pick.period_end === "string" ? pick.period_end : null;
  return {
    category_name: String(pick.category_name),
    category_id: pick.category_id ? String(pick.category_id) : null,
    period: from && to ? { from, to } : null,
    status: pick.status ? String(pick.status) : null,
    source: exceeded[0] ? "goal_exceeded" : "goal_closest_to_cap",
  };
}

/** Pedido de esclarecimento honesto — usado quando o escopo não pode ser resolvido. */
export function askForCategory(): string {
  return "Antes de te dar número, preciso saber o recorte certo: de qual categoria você quer "
    + "a lista de estabelecimentos? Se preferir, eu abro o total do período considerando todas as categorias.";
}
