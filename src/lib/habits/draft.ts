// Rascunho do formulário "Novo hábito" e sua conversão para a RPC `hb_create_habit` (puro, testável).
import type { CreateHabitInput, HbArea, HbTemplate } from "@/lib/habits/api";

export type Cadence = "daily" | "weekly" | "quantity";

export interface Draft {
  template_id: string | null;
  title: string;
  area: HbArea;
  cadence: Cadence;
  weekly_target: number;
  quantity_target: string;
  quantity_unit: string;
  quantity_period: "day" | "week";
  days: number[]; // vazio = todos os dias
  cue_text: string;
  minimum_text: string;
  rest_per_week: number;
  start_today: boolean;
}

export const EMPTY: Draft = {
  template_id: null, title: "", area: "other", cadence: "daily", weekly_target: 3, quantity_target: "", quantity_unit: "", quantity_period: "day",
  days: [], cue_text: "", minimum_text: "", rest_per_week: 1, start_today: false,
};


export const fromTemplate = (t: HbTemplate): Draft => ({
  ...EMPTY,
  template_id: t.id, title: t.title, area: t.area,
  cadence: t.kind === "do_weekly_count" ? "weekly" : t.kind === "do_quantity" ? "quantity" : "daily",
  weekly_target: t.weekly_target ?? 3, quantity_target: t.quantity_target != null ? String(t.quantity_target) : "", quantity_unit: t.quantity_unit ?? "",
  quantity_period: t.quantity_period ?? "day", cue_text: t.cue_suggestion ?? "", minimum_text: t.minimum_suggestion ?? "",
});

export function draftToInput(d: Draft): CreateHabitInput {
  const base = {
    title: d.title.trim(), area: d.area, template_id: d.template_id,
    cue_kind: d.cue_text.trim() ? ("after_event" as const) : null, cue_text: d.cue_text.trim() || null,
    minimum_text: d.minimum_text.trim() || null, rest_per_week: d.rest_per_week, start_today: d.start_today,
  };
  if (d.cadence === "weekly") return { ...base, kind: "do_weekly_count", weekly_target: d.weekly_target };
  if (d.cadence === "quantity") return { ...base, kind: "do_quantity", quantity_target: Number(d.quantity_target), quantity_unit: d.quantity_unit.trim() || null, quantity_period: d.quantity_period };
  return { ...base, kind: "do_daily", days_of_week: d.days.length > 0 && d.days.length < 7 ? d.days : null };
}

export function draftError(d: Draft): string | null {
  if (d.title.trim().length < 2) return "Dê um nome ao hábito.";
  if (d.cadence === "quantity" && !(Number(d.quantity_target) > 0)) return "Informe a quantidade da meta.";
  return null;
}


// ---------------------------------------------------------------- largar (F3)

export interface QuitDraft {
  template_id: string | null;
  title: string;
  area: HbArea;
  sensitivity: "normal" | "health" | "substance";
  craving_plan: string;
  /** Categoria de despesa ligada ao hábito (opcional). */
  category_id: string;
  category_label: string;
  /** Gasto diário informado (texto, para o campo). */
  daily_cost: string;
}

export const EMPTY_QUIT: QuitDraft = { template_id: null, title: "", area: "other", sensitivity: "normal", craving_plan: "", category_id: "", category_label: "", daily_cost: "" };

export const quitFromTemplate = (t: HbTemplate): QuitDraft => ({
  ...EMPTY_QUIT, template_id: t.id, title: t.title, area: t.area, sensitivity: t.sensitivity ?? "normal", craving_plan: t.craving_suggestion ?? "",
});

export const needsConsent = (d: QuitDraft): boolean => d.sensitivity !== "normal";

export function quitDraftToInput(d: QuitDraft): CreateHabitInput {
  const cost = Number(d.daily_cost.replace(",", "."));
  return {
    kind: "quit", title: d.title.trim(), area: d.area, template_id: d.template_id, sensitivity: d.sensitivity,
    craving_plan: d.craving_plan.trim() || null,
    money_category_id: d.category_id || null, money_label: d.category_label || null,
    daily_cost: d.daily_cost.trim() && Number.isFinite(cost) && cost >= 0 ? cost : null,
  };
}

export function quitDraftError(d: QuitDraft): string | null {
  if (d.title.trim().length < 2) return "Diga o que você quer largar.";
  if (d.daily_cost.trim() && !(Number(d.daily_cost.replace(",", ".")) >= 0)) return "Informe um valor válido para o gasto por dia.";
  return null;
}
