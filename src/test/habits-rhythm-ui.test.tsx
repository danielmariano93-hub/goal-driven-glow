import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { HabitView, RhythmData } from "@/lib/habits/api";

const h = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/lib/habits/api", async (orig) => ({ ...(await orig<typeof import("@/lib/habits/api")>()), useRhythmData: () => ({ data: h.data }) }));

import { CravingHoursCard, DayRhythmCard } from "@/components/hb/Rhythm";

const view = { habit: { id: "agua", quantity_target: 1500, quantity_unit: "ml" } } as unknown as HabitView;
const at = (day: string, hour: number, min = 0) => `${day}T${String(hour + 3).padStart(2, "0")}:${String(min).padStart(2, "0")}:00Z`;

describe("ritmo do dia (tela)", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-11T23:00:00Z")); }); // 20h em São Paulo
  afterEach(() => vi.useRealTimers());

  it("20h, 1.000 de 1.500 ml: abaixo do ritmo, faltam 500 ml em 2 horas", () => {
    h.data = { timezone: "America/Sao_Paulo", cravings: [], entries: [[8, 12], [12, 40], [15, 30], [17, 10]].map(([hr, m]) => ({ local_date: "2026-11-11", amount: 250, at: at("2026-11-11", hr, m) })) } satisfies RhythmData;
    render(<MemoryRouter><DayRhythmCard view={view} today="2026-11-11" logs={[{ habit_id: "agua", local_date: "2026-11-11", status: "quantity", quantity: 1000 }]} /></MemoryRouter>);
    expect(screen.getByText("313 ml abaixo do ritmo")).toBeTruthy();
    expect(screen.getByText(/Faltam 500 ml em 2 horas \(cerca de 250 ml por hora\)/)).toBeTruthy();
    expect(screen.getByText("1000 de 1500 ml")).toBeTruthy();
    expect(screen.getByText(/Os seus horários aparecem depois de 7 dias/)).toBeTruthy();
  });
  it("sem hora nos registros de hoje: avisa e não inventa gráfico por hora", () => {
    h.data = { timezone: "America/Sao_Paulo", cravings: [], entries: [] } satisfies RhythmData;
    render(<MemoryRouter><DayRhythmCard view={view} today="2026-11-11" logs={[{ habit_id: "agua", local_date: "2026-11-11", status: "quantity", quantity: 500 }]} /></MemoryRouter>);
    expect(screen.getByText(/Os registros de hoje ainda não têm horário/)).toBeTruthy();
  });
  it("meta batida", () => {
    h.data = { timezone: "America/Sao_Paulo", cravings: [], entries: [] } satisfies RhythmData;
    render(<MemoryRouter><DayRhythmCard view={view} today="2026-11-11" logs={[{ habit_id: "agua", local_date: "2026-11-11", status: "quantity", quantity: 1500 }]} /></MemoryRouter>);
    expect(screen.getByText("Meta do dia batida")).toBeTruthy();
  });
  it("sem dados carregados, não mostra nada", () => {
    h.data = undefined;
    const { container } = render(<MemoryRouter><DayRhythmCard view={view} today="2026-11-11" logs={[]} /></MemoryRouter>);
    expect(container.textContent).toBe("");
  });
});

describe("vontades por hora (tela)", () => {
  const at15 = (hr: number) => ({ occurred_at: at("2026-11-10", hr, 5), handled: true });
  it("menos de 10 vontades: explica quando aparece", () => {
    h.data = { timezone: "America/Sao_Paulo", entries: [], cravings: [at15(15), at15(16)] } satisfies RhythmData;
    render(<CravingHoursCard habitId="x" />);
    expect(screen.getByText(/depois de 10 vontades registradas \(você tem 2\)/)).toBeTruthy();
  });
  it("12 vontades concentradas à tarde: aponta o horário mais difícil", () => {
    h.data = { timezone: "America/Sao_Paulo", entries: [], cravings: [15, 15, 16, 16, 17, 17, 16, 15, 9, 20, 10, 19].map(at15) } satisfies RhythmData;
    render(<CravingHoursCard habitId="x" />);
    expect(screen.getByText("Horário mais difícil: 15h às 18h")).toBeTruthy();
    expect(screen.getByText("12 de 12 resistidas")).toBeTruthy();
  });
});
