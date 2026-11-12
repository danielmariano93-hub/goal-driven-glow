import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { GoalsPayload } from "@/lib/habits/api";

const h = vi.hoisted(() => ({
  goals: null as unknown,
  createGoal: vi.fn(async () => "g-novo"),
  setMeasurement: vi.fn(async () => "p1"),
  views: [] as unknown[],
  noop: () => ({ mutateAsync: async () => null, isPending: false }),
}));
vi.mock("@/lib/habits/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/habits/api")>()),
  useGoals: () => ({ data: h.goals, isLoading: false, isError: false, refetch: vi.fn() }),
  useHabitViews: () => ({ views: h.views, logs: [], today: "2026-11-11", isLoading: false }),
  useCreateGoal: () => ({ mutateAsync: h.createGoal, isPending: false }),
  useSetMeasurement: () => ({ mutateAsync: h.setMeasurement, isPending: false }),
  useUpdateGoal: h.noop, useArchiveGoal: h.noop, useAddMeasure: h.noop, useArchiveMeasure: h.noop,
}));

import Objetivo from "@/pages/habits/Objetivo";
import NovoObjetivo from "@/pages/habits/NovoObjetivo";

const payload: GoalsPayload = {
  today: "2026-11-11",
  goals: [{
    id: "g1", title: "Hipertrofia e menos gordura abdominal", started_on: "2026-10-12", habit_ids: [],
    measures: [
      { id: "m2", kind: "waist", label: "Cintura", unit: "cm", cadence: "monthly", points: [{ id: "a", date: "2026-10-12", value: 89.5 }, { id: "b", date: "2026-11-11", value: 88 }] },
      { id: "m1", kind: "weight", label: "Peso", unit: "kg", cadence: "weekly", points: [{ id: "c", date: "2026-11-02", value: 82 }] },
    ],
  }],
};

describe("tela do objetivo", () => {
  beforeEach(() => { h.goals = payload; h.createGoal.mockClear(); h.setMeasurement.mockClear(); h.views = []; });

  it("mostra o objetivo, a cintura (primeira → última, diferença, aviso de erro) e o peso sem inventar variação", () => {
    render(<MemoryRouter initialEntries={["/h/objetivo/g1"]}><Routes><Route path="/h/objetivo/:id" element={<Objetivo />} /></Routes></MemoryRouter>);
    expect(screen.getByText("Hipertrofia e menos gordura abdominal")).toBeTruthy();
    expect(screen.getByText(/Acompanhando: cintura \(mensal\) e peso \(semanal\)/)).toBeTruthy();
    expect(screen.getByText("89,5 → 88 cm")).toBeTruthy();
    expect(screen.getByText("−1,5 cm")).toBeTruthy();
    expect(screen.getByText(/erra cerca de 1 cm/)).toBeTruthy();
    expect(screen.getByText(/ainda é cedo para falar em tendência/)).toBeTruthy();
    // peso: uma pesagem só, então só a média e a explicação, sem "variação"
    expect(screen.getByText("82 kg de média")).toBeTruthy();
    expect(screen.getByText(/A variação aparece com 4 pesagens e 2 semanas de histórico/)).toBeTruthy();
  });

  it("a próxima medida da cintura é um mês depois da última e pede registro quando chega o dia", () => {
    render(<MemoryRouter initialEntries={["/h/objetivo/g1"]}><Routes><Route path="/h/objetivo/:id" element={<Objetivo />} /></Routes></MemoryRouter>);
    expect(screen.getByText(/Próxima medida: 11 dez · registrar/)).toBeTruthy(); // cintura
    expect(screen.getByText(/Próxima medida: 9 nov|Hora de medir/)).toBeTruthy(); // peso: 02/11 + 7 dias já passou
  });

  it("objetivo inexistente ou arquivado", () => {
    render(<MemoryRouter initialEntries={["/h/objetivo/zzz"]}><Routes><Route path="/h/objetivo/:id" element={<Objetivo />} /></Routes></MemoryRouter>);
    expect(screen.getByText("Objetivo não encontrado")).toBeTruthy();
  });
});

describe("novo objetivo", () => {
  it("cria com as medidas escolhidas (peso e cintura vêm marcados) e vai para a tela do objetivo", async () => {
    h.createGoal.mockClear();
    h.views = [{ habit: { id: "tre", title: "Treinar" } }];
    render(<MemoryRouter initialEntries={["/h/objetivo/novo"]}><Routes><Route path="/h/objetivo/novo" element={<NovoObjetivo />} /><Route path="/h/objetivo/:id" element={<p>tela do objetivo</p>} /></Routes></MemoryRouter>);
    expect((screen.getByRole("button", { name: "Criar objetivo" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Hipertrofia e menos gordura abdominal" }));
    fireEvent.click(screen.getByRole("button", { name: /Treinar/ }));
    fireEvent.click(screen.getByRole("button", { name: /Braço/ }));
    fireEvent.click(screen.getByRole("button", { name: "Criar objetivo" }));
    await waitFor(() => expect(h.createGoal).toHaveBeenCalled());
    expect(h.createGoal).toHaveBeenCalledWith({
      title: "Hipertrofia e menos gordura abdominal", habits: ["tre"],
      measures: [
        { kind: "weight", label: "Peso", unit: "kg", cadence: "weekly" },
        { kind: "waist", label: "Cintura", unit: "cm", cadence: "monthly" },
        { kind: "arm", label: "Braço", unit: "cm", cadence: "monthly" },
      ],
    });
    await screen.findByText("tela do objetivo");
  });
});
