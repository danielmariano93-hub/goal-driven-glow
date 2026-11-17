import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import type { GoalMeasure } from "@/lib/habits/api";
import { guideKind, MEASURE_GUIDES, MeasureGuide } from "@/components/hb/MeasureGuide";

const h = vi.hoisted(() => ({ set: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastSuccess, message: vi.fn() } }));
vi.mock("@/lib/habits/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/habits/api")>()),
  useSetMeasurement: () => ({ mutateAsync: h.set, isPending: false }),
}));

import { MeasureSheet } from "@/components/hb/GoalCards";

const measure = (kind: string, label: string, unit: string): GoalMeasure => ({ id: "m1", kind, label, unit, cadence: "monthly", points: [] }) as unknown as GoalMeasure;

describe("como medir (desenho animado)", () => {
  it("cada tipo de medida tem o seu desenho, a frase-chave e o passo a passo", () => {
    for (const kind of ["weight", "waist", "arm", "thigh", "custom"] as const) {
      const { unmount } = render(<MeasureGuide kind={kind} />);
      const g = MEASURE_GUIDES[kind];
      expect(screen.getByRole("img", { name: new RegExp(g.key.slice(0, 20)) })).toBeTruthy();
      expect(screen.getByText(g.key)).toBeTruthy();
      expect(g.steps.length).toBeGreaterThanOrEqual(2);
      unmount();
    }
  });
  it("marca os pontos de referência de cada região", () => {
    const labels = (kind: string) => { const { container, unmount } = render(<MeasureGuide kind={kind} />); const t = Array.from(container.querySelectorAll("svg text")).map((n) => n.textContent); unmount(); return t; };
    expect(labels("waist")).toEqual(["costela", "quadril"]);
    expect(labels("arm")).toEqual(["ombro", "cotovelo"]);
    expect(labels("thigh")).toEqual(["virilha", "joelho"]);
  });
  it("tipo desconhecido cai no desenho genérico", () => {
    expect(guideKind("outro")).toBe("custom");
    expect(guideKind(null)).toBe("custom");
    expect(guideKind("waist")).toBe("waist");
  });
  it("passo a passo abre e fecha", () => {
    render(<MeasureGuide kind="waist" />);
    const btn = screen.getByRole("button", { name: /Passo a passo/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    for (const s of MEASURE_GUIDES.waist.steps) expect(screen.getByText(s)).toBeTruthy();
    expect(screen.getByText(/erra cerca de 1 cm/)).toBeTruthy();
    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });
  it("respeita 'reduzir movimento': a animação tem versão parada", () => {
    const { container } = render(<MeasureGuide kind="waist" />);
    expect(container.querySelector("svg style")?.textContent).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
  it("as instruções seguem o padrão das medidas (cintura: costela e quadril; coxa: virilha e joelho)", () => {
    expect(MEASURE_GUIDES.waist.key).toMatch(/costela/);
    expect(MEASURE_GUIDES.waist.key).toMatch(/quadril/);
    expect(MEASURE_GUIDES.arm.key).toMatch(/ombro/);
    expect(MEASURE_GUIDES.arm.key).toMatch(/cotovelo/);
    expect(MEASURE_GUIDES.thigh.key).toMatch(/virilha/);
    expect(MEASURE_GUIDES.thigh.key).toMatch(/joelho/);
  });
});

describe("folha de registrar medida", () => {
  beforeEach(() => { vi.clearAllMocks(); h.set.mockResolvedValue(undefined); });
  const open = (m = measure("waist", "Cintura", "cm")) => render(<MeasureSheet measure={m} today="2026-11-17" open onOpenChange={vi.fn()} />);

  it("mostra o desenho de como medir e não abre o teclado sozinha", () => {
    open();
    expect(screen.getByText("Registrar cintura")).toBeTruthy();
    expect(screen.getByRole("img", { name: /Animação: como medir a cintura/ })).toBeTruthy();
    const input = screen.getByLabelText("Valor em cm");
    expect(document.activeElement).not.toBe(input);
  });
  it("salva só com valor válido, no dia escolhido", async () => {
    open();
    const save = screen.getByRole("button", { name: "Salvar" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Valor em cm"), { target: { value: "82,5" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(h.set).toHaveBeenCalledWith({ measure: "m1", date: "2026-11-17", value: 82.5 }));
  });
  it("peso: usa o desenho da balança", () => {
    open(measure("weight", "Peso", "kg"));
    expect(screen.getByRole("img", { name: /Animação: como medir o peso/ })).toBeTruthy();
    // visível no cartão e, também, como descrição para leitor de tela
    expect(screen.getAllByText(MEASURE_GUIDES.weight.key).length).toBeGreaterThanOrEqual(1);
  });
  it("a folha rola dentro do limite da tela (não passa da altura com o teclado)", () => {
    open();
    const scroller = document.querySelector('[class*="max-h-[88dvh]"]');
    expect(scroller?.className).toMatch(/overflow-y-auto/);
  });
});

describe("folhas de Hábitos com campo de texto não deixam o teclado desmontar a tela", () => {
  const files = [
    "src/components/hb/QuickLogSheet.tsx", "src/components/hb/GoalCards.tsx", "src/components/hb/MeasureCard.tsx", "src/components/hb/BackfillSheet.tsx",
    "src/components/hb/EditPlanSheet.tsx", "src/components/hb/DayActionsSheet.tsx", "src/pages/habits/Objetivo.tsx",
  ];
  it.each(files)("%s usa repositionInputs={false}", (f) => {
    expect(readFileSync(f, "utf8")).toMatch(/repositionInputs=\{false\}/);
  });
});
