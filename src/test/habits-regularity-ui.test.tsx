import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { HabitView, LogTimesData } from "@/lib/habits/api";

const h = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("@/lib/habits/api", async (orig) => ({ ...(await orig<typeof import("@/lib/habits/api")>()), useLogTimes: () => ({ data: h.data }) }));

import { RegularityCard, RegularityOverview } from "@/components/hb/RegularityCard";

const view = (id: string, title: string, form = "check", kind = "do_daily") => ({ habit: { id, title, kind, area: "mind" }, form }) as unknown as HabitView;
const mk = (id: string, hhmm: string[], extra: Partial<LogTimesData["logs"][number]> = {}): LogTimesData["logs"] =>
  hhmm.map((t, i) => {
    const day = `2026-11-${String(i + 1).padStart(2, "0")}`;
    const [hh, mm] = t.split(":").map(Number);
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCHours(hh + 3, mm);
    return { habit_id: id, local_date: day, status: "done", source: "app", logged_at: d.toISOString(), ...extra };
  });

describe("regularidade do horário (tela)", () => {
  beforeEach(() => { h.data = undefined; });

  it("horário firme: mostra o típico, quantos dias ficaram a até 1 hora e o reforço", () => {
    h.data = { timezone: "America/Sao_Paulo", logs: mk("m", ["07:30", "07:40", "07:35", "07:50", "07:20", "07:45", "07:40", "10:30"]) } satisfies LogTimesData;
    render(<RegularityCard view={view("m", "Meditar")} />);
    expect(screen.getByText("Você costuma fazer por volta de 07:40")).toBeTruthy();
    expect(screen.getByText(/Em 7 de 8 dias foi a até 1 hora desse horário/)).toBeTruthy();
    expect(screen.getByText(/Você já tem um horário firme/)).toBeTruthy();
  });
  it("horário solto: sugere um gatilho fixo", () => {
    h.data = { timezone: "America/Sao_Paulo", logs: mk("m", ["06:00", "09:00", "12:30", "15:00", "18:30", "21:00", "07:00", "13:30"]) } satisfies LogTimesData;
    render(<RegularityCard view={view("m", "Meditar")} />);
    expect(screen.getByText(/gatilho fixo/)).toBeTruthy();
  });
  it("poucos dias, água, largar ou sem dados: não mostra nada", () => {
    h.data = { timezone: "America/Sao_Paulo", logs: mk("m", ["07:30", "07:40", "07:35"]) } satisfies LogTimesData;
    expect(render(<RegularityCard view={view("m", "Meditar")} />).container.textContent).toBe("");
    h.data = { timezone: "America/Sao_Paulo", logs: mk("a", ["07:30", "07:40", "07:35", "07:50", "07:20", "07:45", "07:40"]) } satisfies LogTimesData;
    expect(render(<RegularityCard view={view("a", "Beber água", "amount", "do_quantity")} />).container.textContent).toBe("");
    expect(render(<RegularityCard view={view("a", "Açúcar", "check", "quit")} />).container.textContent).toBe("");
    h.data = undefined;
    expect(render(<RegularityCard view={view("m", "Meditar")} />).container.textContent).toBe("");
  });
  it("visão geral lista só os hábitos com dados suficientes", () => {
    h.data = { timezone: "America/Sao_Paulo", logs: [...mk("m", ["07:30", "07:40", "07:35", "07:50", "07:20", "07:45", "07:40"]), ...mk("l", ["22:00", "22:10"])] } satisfies LogTimesData;
    render(<RegularityOverview views={[view("m", "Meditar"), view("l", "Ler")]} />);
    expect(screen.getByText("Horário dos hábitos")).toBeTruthy();
    expect(screen.getByText("Meditar")).toBeTruthy();
    expect(screen.queryByText("Ler")).toBeNull();
    expect(screen.getByText(/7 de 7 dias/)).toBeTruthy();
  });
});
