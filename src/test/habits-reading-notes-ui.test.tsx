import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { HabitView } from "@/lib/habits/api";

const h = vi.hoisted(() => ({ notes: [] as Array<Record<string, unknown>> }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/lib/habits/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/habits/api")>()),
  useProjectNotes: () => ({ data: { notes: h.notes, summaries: [] } }),
  useProjectNoteAdd: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useProjectNoteDelete: () => ({ mutate: vi.fn(), isPending: false }),
  useProjectSummarySet: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSummarizeBook: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { NoteBody, ReadingNotes } from "@/components/hb/ReadingNotes";

const view = { habit: { id: "ler" }, form: "project", project: { id: "p1", habit_id: "ler", title: "Livro", total: 205, current: 20, unit: "páginas", started_on: "2026-11-10", finished_on: null }, projects_done: [] } as unknown as HabitView;
const LONGA = "1. VALORIZE-SE\n→ Reconheça seu valor sem depender da aprovação dos outros.\n\n2. ENFRENTE SEUS MEDOS\n→ Não espere o medo desaparecer para agir.\n\n3. SORRIA PARA A VIDA\n→ Use o sorriso para aliviar tensões.";
const note = (over: Record<string, unknown> = {}) => ({ id: "n1", project_id: "p1", body: "Hábito pequeno vira rotina.", page: 20, noted_on: "2026-11-13", ...over });
const open = () => render(<MemoryRouter><ReadingNotes view={view} today="2026-11-13" /></MemoryRouter>);

describe("anotações do livro (acordeão)", () => {
  it("com anotações, começa recolhido e mostra só a prévia da mais recente", () => {
    h.notes = [note({ body: LONGA })];
    open();
    const header = screen.getByRole("button", { name: /O que você anotou/ });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(within(header).getByText("1. VALORIZE-SE")).toBeTruthy(); // prévia: primeira linha
    expect(within(header).getByText("13 nov · p. 20")).toBeTruthy();
  });
  it("toca no título: abre e fecha", () => {
    h.notes = [note()];
    open();
    const header = screen.getByRole("button", { name: /O que você anotou/ });
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Hábito pequeno vira rotina.")).toBeTruthy();
    fireEvent.click(header);
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });
  it("sem anotações, já vem aberto com o convite", () => {
    h.notes = [];
    open();
    expect(screen.getByRole("button", { name: /O que você anotou/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/Ainda sem anotações/)).toBeTruthy();
    expect(screen.getByText("+ Anotar agora")).toBeTruthy();
  });
  it("anotação longa vem resumida com 'Ler mais' e 'Mostrar menos'", () => {
    h.notes = [note({ body: LONGA })];
    open();
    fireEvent.click(screen.getByRole("button", { name: /O que você anotou/ }));
    const more = screen.getByRole("button", { name: "Ler mais" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(screen.getByRole("button", { name: "Mostrar menos" }).getAttribute("aria-expanded")).toBe("true");
  });
  it("anotação curta não tem 'Ler mais'", () => {
    h.notes = [note()];
    open();
    fireEvent.click(screen.getByRole("button", { name: /O que você anotou/ }));
    expect(screen.queryByRole("button", { name: "Ler mais" })).toBeNull();
  });
});

describe("texto da anotação (leitura)", () => {
  it("separa título e explicação em cada bloco e mantém parágrafo simples", () => {
    render(<NoteBody text={"1. VALORIZE-SE\n→ Reconheça seu valor.\n\nUma frase solta."} />);
    expect(screen.getByText("1. VALORIZE-SE").className).toMatch(/font-medium/);
    expect(screen.getByText("→ Reconheça seu valor.").className).toMatch(/text-muted-foreground/);
    expect(screen.getByText("Uma frase solta.").className).not.toMatch(/font-medium/);
  });
});
