// proactive_repetition.v1 — o mesmo assunto não volta sem fato novo (função pura).
// O fingerprint de uma situação muda com a data ("ritmo de 26/09", "de 27/09"),
// então o filtro por fingerprint deixava o mesmo assunto voltar todo dia. Aqui o
// assunto é o TIPO de comunicação por canal: só volta depois da janela, ou antes
// dela se o impacto cresceu de forma material. Risco crítico nunca espera.
import type { FinancialSituation } from "./contracts.ts";

export const PROACTIVE_REPETITION_VERSION = "proactive_repetition.v1";

export type RecentDelivery = {
  kind: string;
  channel: "app" | "whatsapp" | string;
  delivered_at: string;
  impact_amount: number | null;
};

/** Dias mínimos entre dois avisos do mesmo tipo no mesmo canal. */
export const REPEAT_WINDOW_DAYS: Record<"app" | "whatsapp", { attention: number; info: number }> = {
  whatsapp: { attention: 3, info: 7 },
  app: { attention: 2, info: 5 },
};

/** Crescimento de impacto que conta como fato novo. */
export const MATERIAL_GROWTH = 1.5;

/**
 * Obrigações com data (parcela, fatura, conta esquecida) têm identidade própria
 * por ciclo e momento: o lembrete da parcela do Banco Pan não pode esperar a
 * janela por causa do lembrete da parcela do Atacadão.
 */
export const TIME_BOUND_KINDS = new Set([
  "debt_due_soon", "debt_overdue", "debt_installment_due", "forgotten_bill", "card_bill_pressure",
  "bill_due_reminder", "card_closing_soon",
  // Metas de gasto: cada semana, fim de semana e fechamento tem identidade própria.
  "spending_goal_weekend", "spending_goal_weekly", "spending_goal_monthly", "spending_goal_zero_charge",
  // Previsão (sexta) e fechamento (segunda) do fim de semana: cada um tem identidade própria por fim de semana.
  "weekend_spending_risk",
]);

export function repeatedKind(
  situation: FinancialSituation,
  channel: "app" | "whatsapp",
  recent: RecentDelivery[],
  now: Date,
): string | null {
  if (situation.severity === "critical") return null;
  if (TIME_BOUND_KINDS.has(situation.communication_kind)) return null;
  const windowDays = REPEAT_WINDOW_DAYS[channel][situation.severity === "info" ? "info" : "attention"];
  const since = now.getTime() - windowDays * 86_400_000;
  const last = recent
    .filter((row) => row.kind === situation.communication_kind && row.channel === channel)
    .filter((row) => Date.parse(row.delivered_at) >= since)
    .sort((a, b) => Date.parse(b.delivered_at) - Date.parse(a.delivered_at))[0];
  if (!last) return null;
  const previous = Math.abs(Number(last.impact_amount ?? 0));
  if (previous > 0 && situation.impact_amount >= previous * MATERIAL_GROWTH) return null;
  return `kind_repeat_window_${windowDays}d`;
}
