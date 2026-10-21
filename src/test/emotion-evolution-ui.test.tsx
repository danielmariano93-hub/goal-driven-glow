import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let rows: Array<Record<string, unknown>> = [];
vi.mock("@/lib/emotions/useEmotionHistory", () => ({ useEmotionHistory: () => ({ data: rows }) }));
vi.mock("@/lib/db/finance", () => ({ useLedgerWindow: () => ({ data: [] }) }));

import { EmotionWeekStrip } from "@/components/emotions/EmotionWeekStrip";
import { EmotionEvolution } from "@/components/emotions/EmotionEvolution";
import { saoPauloDay, shiftDay } from "@/lib/emotions/history";

const today = saoPauloDay(new Date());
const mk = (offset: number, emotion: string) => ({ occurred_at: `${shiftDay(today, offset)}T15:00:00-03:00`, emotion_key: emotion });
const wrap = (ui: React.ReactElement) => <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>;

describe("calendário da semana no cartão", () => {
  it("sem nenhum registro não ocupa espaço", () => {
    rows = [];
    const { container } = render(wrap(<EmotionWeekStrip />));
    expect(container.querySelector('[data-testid="emotion-week"]')).toBeNull();
  });
  it("mostra emoji com nome acessível, dia vazio sem cobrança e a frase do Nino", () => {
    rows = [mk(0, "tranquilo"), mk(-1, "preocupado"), mk(-2, "preocupado")];
    render(wrap(<EmotionWeekStrip />));
    expect(screen.getAllByRole("img").filter((e) => /Tranquilo|Preocupado/.test(e.getAttribute("aria-label") ?? "")).length).toBe(3);
    expect(screen.getAllByRole("img").some((e) => /sem registro/.test(e.getAttribute("aria-label") ?? ""))).toBe(true);
    expect(screen.getByText(/dos últimos 7 dias/)).toBeTruthy();
  });
});

describe("evolução do humor", () => {
  it("com poucos registros diz quantos faltam, sem desenhar gráfico", () => {
    rows = [mk(0, "tranquilo"), mk(-1, "atento")];
    const { container } = render(wrap(<EmotionEvolution />));
    expect(screen.getByText(/Com mais 1 registro a linha do tempo aparece/)).toBeTruthy();
    expect(container.querySelector("svg")).toBeNull();
  });
  it("com registros suficientes desenha a linha e deixa trocar 30/90 dias, sem vermelho", () => {
    rows = [0, -1, -2, -3, -4, -5].map((o, i) => mk(o, i % 2 ? "preocupado" : "tranquilo"));
    const { container } = render(wrap(<EmotionEvolution />));
    expect(container.querySelector("svg path")).not.toBeNull();
    // linha suave: curvas (C), nunca segmentos retos (L) entre os pontos
    const d = Array.from(container.querySelectorAll("svg path")).find((n) => n.getAttribute("stroke"))!.getAttribute("d")!;
    expect(d).toMatch(/C/);
    expect(d).not.toMatch(/L/);
    fireEvent.click(screen.getByRole("button", { name: "90 dias" }));
    expect(screen.getByRole("button", { name: "90 dias" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.innerHTML).not.toMatch(/red|destructive|#f00/i);
    expect(screen.getByText(/sua percepção, não uma nota/)).toBeTruthy();
  });
});
