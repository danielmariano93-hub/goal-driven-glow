import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { WeekSummary } from "@/components/hb/WeekSummary";
import { weeklyReview, type HabitDef, type LogRow } from "@/lib/habits/engine";
import type { HabitView } from "@/lib/habits/api";

const today = "2026-11-11"; // quarta; a semana vai de 09/11 a 15/11
const med: HabitDef = { id: "m", kind: "do_daily", started_on: "2026-11-01", days_of_week: null, weekly_target: null, quantity_target: null, quantity_period: null, rest_per_week: 1, form: "check" };
const tre: HabitDef = { id: "t", kind: "do_weekly_count", started_on: "2026-11-01", days_of_week: null, weekly_target: 3, quantity_target: null, quantity_period: null, rest_per_week: 1, form: "weekly" };
const logs: LogRow[] = [
  { habit_id: "m", local_date: "2026-11-09", status: "done", quantity: null },
  { habit_id: "m", local_date: "2026-11-10", status: "done", quantity: null },
  { habit_id: "t", local_date: "2026-11-10", status: "done", quantity: null },
];
const view = (def: HabitDef, title: string, form: string) => ({ def, pauses: [], form, habit: { id: def.id, title, area: "body" } }) as unknown as HabitView;

describe("resumo da semana (visual)", () => {
  it("mostra período, dia da semana, contagem por hábito e a semana passada como fato", () => {
    const rows = weeklyReview([{ def: med }, { def: tre }], logs, today);
    render(<WeekSummary rows={rows} views={[view(med, "Meditar", "check"), view(tre, "Treinar", "weekly")]} logs={logs} today={today} />);
    expect(screen.getByText("9 nov a 15 nov")).toBeTruthy();
    expect(screen.getByText("dia 3 de 7")).toBeTruthy();
    expect(screen.getByText("Meditar")).toBeTruthy();
    expect(screen.getByText(/de 3 dias/)).toBeTruthy();
    expect(screen.getByText(/de 3 vezes/)).toBeTruthy();
    expect(screen.getByRole("img", { name: /Meditar: S Feito, T Feito, Q (Em aberto|Sem registro), D? ?/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: "1 de 3 vezes nesta semana" })).toBeTruthy();
  });
  it("texto da IA aparece junto, sem substituir os números", () => {
    const rows = weeklyReview([{ def: med }], logs, today);
    render(<WeekSummary rows={rows} views={[view(med, "Meditar", "check")]} logs={logs} today={today} aiText="Boa semana até aqui." />);
    expect(screen.getByText("Boa semana até aqui.")).toBeTruthy();
    expect(screen.getByText("Meditar")).toBeTruthy();
  });
});
