import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Dial } from "@/components/hb/ui";
import type { DayAggregate } from "@/lib/habits/aggregate";

const days: DayAggregate[] = [
  { date: "2026-11-09", state: "full", is_today: false },
  { date: "2026-11-10", state: "partial", is_today: false },
  { date: "2026-11-11", state: "none", is_today: true },
];

describe("mostrador do Hoje", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("o resumo continua acessível e o centro mostra o progresso de hoje", () => {
    render(<Dial days={days} done={1} total={2} />);
    expect(screen.getByRole("img", { name: /1 de 2 hábitos de hoje feitos/ })).toBeTruthy();
    expect(screen.getByText("feitos hoje")).toBeTruthy();
  });

  it("tocar num traço mostra aquele dia; tocar de novo volta; sozinho volta em 4 s", () => {
    render(<Dial days={days} done={1} total={2} />);
    fireEvent.click(screen.getByRole("button", { name: "Seg, 9 nov: dia completo" }));
    expect(screen.getByText("Seg, 9 nov")).toBeTruthy();
    expect(screen.getByText("dia completo")).toBeTruthy();
    expect(screen.queryByText("feitos hoje")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Seg, 9 nov: dia completo" }));
    expect(screen.getByText("feitos hoje")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ter, 10 nov: dia parcial" }));
    expect(screen.getByText("dia parcial")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.getByText("feitos hoje")).toBeTruthy();
  });

  it("funciona pelo teclado e hoje se chama 'Hoje'", () => {
    render(<Dial days={days} done={1} total={2} />);
    const today = screen.getByRole("button", { name: "Hoje: sem registro" });
    fireEvent.keyDown(today, { key: "Enter" });
    expect(screen.getByText("sem registro")).toBeTruthy();
    expect(today.getAttribute("aria-pressed")).toBe("true");
  });

  it("o anel parte de zero e chega ao valor (a animação roda por CSS)", () => {
    const { container } = render(<Dial days={days} done={1} total={2} />);
    const ring = () => container.querySelectorAll("circle")[1];
    expect(Number(ring().getAttribute("stroke-dashoffset"))).toBeCloseTo(578.05, 1);
    act(() => { vi.advanceTimersByTime(50); });
    expect(Number(ring().getAttribute("stroke-dashoffset"))).toBeCloseTo(289.025, 1);
  });
});
