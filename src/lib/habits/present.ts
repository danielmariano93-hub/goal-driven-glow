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
  if (summary.streak >= 2 && v.form !== "ceiling") parts.push(`${summary.streak} ${summary.model === "weekly" ? "semanas" : "dias"} seguidos`);
  return parts.join(" · ");
}

export function recurringLine(v: HabitView, lastDone: string | null, today: string): { text: string; tone: "ok" | "soon" | "overdue" } {
  const st = recurringStatus(lastDone, v.habit.started_on, v.habit.interval_days ?? 30, today);
  const d = st.days_to ?? 0;
  if (st.state === "overdue") return { text: `Atrasado há ${Math.abs(d)} ${Math.abs(d) === 1 ? "dia" : "dias"}`, tone: "overdue" };
  if (d === 0) return { text: "É hoje", tone: "soon" };
  return { text: `Próximo em ${d} ${d === 1 ? "dia" : "dias"}`, tone: st.state === "soon" ? "soon" : "ok" };
}
