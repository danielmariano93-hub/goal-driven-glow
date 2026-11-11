// Textos curtos por forma de medir (subtítulo das linhas, resumo do dia). Puro.
import { hhmm, projectStats, recurringStatus } from "@/lib/habits/engine";
import type { HabitView } from "@/lib/habits/api";

const num = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/** Quantidade do dia em texto, com a unidade do hábito. */
export function quantityText(v: HabitView, q: number): string {
  const u = v.habit.quantity_unit ?? "";
  if (v.form === "time") return hhmm(q);
  if (v.form === "duration") return `${num(q)} min`;
  return `${num(q)}${u ? ` ${u}` : ""}`;
}

export function targetText(v: HabitView): string {
  const t = v.habit.quantity_target ?? 0;
  const u = v.habit.quantity_unit ?? "";
  if (v.form === "time") return `até ${hhmm(t)}`;
  if (v.form === "duration") return `${num(t)} min`;
  if (v.form === "ceiling") return `no máximo ${num(t)}${u ? ` ${u}` : ""}`;
  return `${num(t)}${u ? ` ${u}` : ""}`;
}

/** Linha de apoio do hábito na tela Hoje. */
export function formSubtitle(v: HabitView, today: string): string {
  const { habit, summary } = v;
  const q = summary.today.quantity;
  const parts: string[] = [];
  switch (v.form) {
    case "amount": parts.push(`${num(q ?? 0)} de ${targetText(v)}`); break;
    case "duration": parts.push(`${num(q ?? 0)} de ${targetText(v)}`); break;
    case "ceiling": parts.push(q != null ? `${num(q)} de ${targetText(v)}` : `Limite: ${targetText(v)}`); break;
    case "time": parts.push(q != null ? `${hhmm(q)} (${targetText(v)})` : targetText(v)); break;
    case "value": parts.push(q != null ? `Hoje: ${num(q)}${habit.quantity_unit ? ` ${habit.quantity_unit}` : ""}` : "Registre o valor de hoje"); break;
    case "project":
      if (v.project) { const p = projectStats(v.project.total, v.project.current, [], today); parts.push(`${v.project.title}: ${num(v.project.current)} de ${num(v.project.total)} (${p.percent}%)`); }
      else parts.push("Comece um novo projeto");
      break;
    case "steps": parts.push(`${v.steps_today.length} de ${v.steps.length} passos`); break;
    default:
      if (summary.model === "weekly" && summary.week) parts.push(`${Math.min(Math.round(summary.week.count * 10) / 10, 99)} de ${summary.week.target} esta semana`);
      else if (habit.cue_text) parts.push(habit.cue_text);
  }
  if (summary.streak >= 2 && v.form !== "ceiling") parts.push(summary.model === "weekly" ? `${summary.streak} sem. seguidas` : `${summary.streak} seguidos`);
  return parts.join(" · ");
}

export function recurringLine(v: HabitView, lastDone: string | null, today: string): { text: string; tone: "ok" | "soon" | "overdue" } {
  const st = recurringStatus(lastDone, v.habit.started_on, v.habit.interval_days ?? 30, today);
  const d = st.days_to ?? 0;
  if (st.state === "overdue") return { text: `Atrasado há ${Math.abs(d)} ${Math.abs(d) === 1 ? "dia" : "dias"}`, tone: "overdue" };
  if (d === 0) return { text: "É hoje", tone: "soon" };
  return { text: `Próximo em ${d} ${d === 1 ? "dia" : "dias"}`, tone: st.state === "soon" ? "soon" : "ok" };
}

/** O dia de hoje conta como concluído? Parcial de quantidade, horário ou passos ainda não conta. */
export function countsDone(v: HabitView): boolean {
  const o = v.summary.today.outcome;
  if (o === "done") return true;
  return o === "minimum" && (v.form === "check" || v.form === "weekly");
}

/** Quanto do dia já foi feito (0 a 1), para as formas que têm um total diário. Nulo nas demais. */
export function dayFraction(v: HabitView): number | null {
  const q = v.summary.today.quantity ?? 0;
  const target = v.habit.quantity_target ?? 0;
  if ((v.form === "amount" || v.form === "duration" || v.form === "project") && target > 0) return Math.max(0, Math.min(1, q / target));
  if (v.form === "steps" && v.steps.length > 0) return v.steps_today.length / v.steps.length;
  return null;
}

/** Texto do botão de registrar de cada forma. */
export function logLabel(form: HabitView["form"]): string {
  switch (form) {
    case "amount": return "Registrar o que consumi";
    case "duration": return "Registrar minutos";
    case "time": return "Registrar o horário";
    case "ceiling": return "Registrar o consumo";
    case "value": return "Registrar o valor de hoje";
    case "project": return "Registrar o avanço";
    case "steps": return "Marcar os passos";
    case "recurring": return "Fiz hoje";
    case "weekly": return "Marcar hoje";
    default: return "Marcar como feito";
  }
}
