// Rascunho do "Novo hábito" e sua conversão para a RPC `hb_create_habit` (puro, testável). Cada forma de medir vira o conjunto certo de campos.
import type { CreateHabitInput, HbArea } from "@/lib/habits/api";
import type { HabitForm } from "@/lib/habits/engine";
import { hhmm, minutesOf } from "@/lib/habits/engine";
import type { CatalogItem, IconKey, QuitItem } from "@/lib/habits/catalog";

export interface Draft {
  catalog_id: string | null;
  title: string;
  area: HbArea;
  icon: IconKey;
  cue_text: string;
  minimum_text: string;
  form: HabitForm;
  /** Meta da forma escolhida (minutos, litros, vezes por semana, horário em horas, dias de intervalo…). */
  target: number;
  unit: string;
  days: number[]; // vazio = todos os dias
  rest_per_week: number;
  start_today: boolean;
  steps: string[];
  project_title: string;
  project_total: string;
  project_current: string;
  sensitive: boolean;
  /** Opções de medida do item escolhido (para o passo "Como acompanhar"). */
  option_index: number;
}

export const EMPTY: Draft = {
  catalog_id: null, title: "", area: "other", icon: "sun", cue_text: "", minimum_text: "", form: "check", target: 0, unit: "", days: [], rest_per_week: 1,
  start_today: false, steps: [], project_title: "", project_total: "", project_current: "", sensitive: false, option_index: 0,
};

/** Aplica a opção de medida `index` do item do catálogo. */
export function withOption(d: Draft, item: CatalogItem | null, index: number): Draft {
  const o = item?.options[index];
  if (!o) return { ...d, form: "check", target: 0, unit: "", option_index: 0 };
  return { ...d, form: o.form, target: o.target, unit: o.unit, option_index: index };
}

export const fromCatalog = (item: CatalogItem): Draft =>
  withOption({
    ...EMPTY, catalog_id: item.id, title: item.label, area: item.area, icon: item.icon, cue_text: item.cue ?? "", minimum_text: item.minimum ?? "",
    steps: item.steps ?? [], sensitive: item.sensitive === true,
  }, item, 0);

const dailyDays = (d: Draft) => (d.days.length > 0 && d.days.length < 7 ? d.days : null);

export function draftToInput(d: Draft): CreateHabitInput {
  const base = {
    title: d.title.trim(), area: d.area, template_id: null,
    cue_kind: d.cue_text.trim() ? ("after_event" as const) : null, cue_text: d.cue_text.trim() || null,
    minimum_text: d.minimum_text.trim() || null, rest_per_week: d.rest_per_week, start_today: d.start_today,
    sensitivity: d.sensitive ? ("health" as const) : ("normal" as const),
  };
  const qty = (extra: Partial<CreateHabitInput>): CreateHabitInput => ({ ...base, kind: "do_quantity", quantity_period: "day", days_of_week: dailyDays(d), ...extra });
  switch (d.form) {
    case "weekly": return { ...base, kind: "do_weekly_count", form: "weekly", weekly_target: d.target };
    case "amount": return qty({ form: "amount", quantity_target: d.target, quantity_unit: d.unit.replace(/ por dia$/, "") || null });
    case "duration": return qty({ form: "duration", quantity_target: d.target, quantity_unit: "min" });
    case "time": return qty({ form: "time", direction: "at_most", quantity_target: d.target * 60, quantity_unit: "min" });
    case "ceiling": return qty({ form: "ceiling", direction: "at_most", implicit_ok: true, quantity_target: d.target, quantity_unit: d.unit.replace(/ por dia, no máximo$/, "") || null });
    case "value": return qty({ form: "value", direction: "track", quantity_target: d.target, quantity_unit: d.unit || null });
    case "project": return qty({
      form: "project", quantity_target: Math.max(1, d.target), quantity_unit: d.unit.includes("R$") ? "R$" : d.unit.includes("aula") ? "aulas" : "páginas",
      project: { title: d.project_title.trim(), total: Number(d.project_total.replace(",", ".")), current: Number(d.project_current.replace(",", ".")) || 0, unit: d.unit.includes("R$") ? "R$" : d.unit.includes("aula") ? "aulas" : "páginas" },
    });
    case "steps": return { ...base, kind: "do_daily", form: "steps", days_of_week: dailyDays(d), steps: d.steps.map((x) => x.trim()).filter(Boolean) };
    case "recurring": return { ...base, kind: "do_daily", form: "recurring", interval_days: d.target, days_of_week: null, rest_per_week: 0 };
    default: return { ...base, kind: "do_daily", form: "check", days_of_week: dailyDays(d) };
  }
}

export function draftError(d: Draft): string | null {
  if (d.title.trim().length < 2) return "Dê um nome ao hábito.";
  if (d.form === "steps" && d.steps.map((x) => x.trim()).filter(Boolean).length < 1) return "Adicione pelo menos um passo.";
  if (d.form === "project") {
    if (d.project_title.trim().length < 1) return "Diga qual é o projeto.";
    if (!(Number(d.project_total.replace(",", ".")) > 0)) return "Informe o total.";
  }
  if (d.form === "recurring" && !(d.target >= 1)) return "Informe de quantos em quantos dias.";
  return null;
}

/** Texto curto da medida, para o cartão e o resumo. */
export function measureText(d: Draft): string {
  const days = d.days.length > 0 && d.days.length < 7;
  switch (d.form) {
    case "weekly": return `${d.target}x por semana`;
    case "amount": return `${String(d.target).replace(".", ",")} ${d.unit}`;
    case "duration": return `${d.target} ${d.unit}`;
    case "time": return d.unit.replace("__", String(d.target));
    case "ceiling": return `até ${String(d.target).replace(".", ",")} ${d.unit.replace(", no máximo", "")}`;
    case "value": return `registrar ${d.unit}`;
    case "project": return d.project_title.trim() ? `${d.project_title.trim()}${d.project_total ? ` · ${d.project_total} ${d.unit.includes("R$") ? "R$" : d.unit.includes("aula") ? "aulas" : "páginas"}` : ""}` : "um projeto";
    case "steps": return `${d.steps.filter((x) => x.trim()).length} passos`;
    case "recurring": return `a cada ${d.target} dias`;
    default: return days ? `${d.days.length} dias por semana` : "Todo dia";
  }
}

export { hhmm, minutesOf };

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

export const quitFromItem = (t: QuitItem): QuitDraft => ({
  ...EMPTY_QUIT, template_id: null, title: t.label, area: t.area, sensitivity: t.sensitivity, craving_plan: t.plan,
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
