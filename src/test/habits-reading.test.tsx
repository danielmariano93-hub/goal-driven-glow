import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { HabitView } from "@/lib/habits/api";
import { bulletsToText, checkStop, notesOf, parseStop, textToBullets } from "@/lib/habits/engine/reading";
import { fallbackBook, guardBook } from "../../supabase/functions/_shared/habits/ai";

const h = vi.hoisted(() => ({ add: vi.fn(), noteAdd: vi.fn(), toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: h.toastError, success: h.toastSuccess, message: vi.fn() } }));
vi.mock("@/lib/habits/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/habits/api")>()),
  useProjectAdd: () => ({ mutateAsync: h.add, isPending: false }),
  useProjectNoteAdd: () => ({ mutateAsync: h.noteAdd, isPending: false }),
  useProjectStart: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLogHabit: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useStepToggle: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { QuickLogSheet } from "@/components/hb/QuickLogSheet";

const book = (over: Record<string, unknown> = {}) => ({
  habit: { id: "ler", title: "Ler", quantity_unit: "páginas", quantity_target: 5 },
  form: "project",
  summary: { today: { quantity: 0 } },
  project: { id: "p1", habit_id: "ler", title: "365 Hábitos Poderosos", total: 205, current: 13, unit: "páginas", started_on: "2026-11-10", finished_on: null, ...over },
  projects_done: [], steps: [], steps_today: [],
}) as unknown as HabitView;

describe("parei na página (cálculo)", () => {
  it("calcula as páginas lidas desde a última marcação", () => {
    expect(checkStop(13, 205, "20")).toEqual({ kind: "added", stop: 20, added: 7, finishes: false });
    expect(checkStop(13, 205, "205")).toEqual({ kind: "added", stop: 205, added: 192, finishes: true });
  });
  it("recusa o que não faz sentido, sem mexer no progresso", () => {
    expect(checkStop(13, 205, "")).toEqual({ kind: "empty" });
    expect(checkStop(13, 205, "abc")).toEqual({ kind: "empty" });
    expect(checkStop(13, 205, "13")).toEqual({ kind: "same" });
    expect(checkStop(13, 205, "8")).toEqual({ kind: "back", current: 13 });
    expect(checkStop(13, 205, "300")).toEqual({ kind: "over", total: 205 });
  });
  it("aceita vírgula e ponto", () => {
    expect(parseStop("20,5")).toBe(20.5);
    expect(parseStop("0")).toBeNull();
  });
  it("tópicos de ida e volta", () => {
    expect(textToBullets(bulletsToText(["a ideia", "outra"]))).toEqual(["a ideia", "outra"]);
    expect(textToBullets("• um\n\n- dois\n  três ")).toEqual(["um", "dois", "três"]);
  });
  it("anotações do livro, da mais recente para a mais antiga", () => {
    const all = [
      { id: "1", project_id: "a", body: "x", page: 10, noted_on: "2026-11-10" },
      { id: "2", project_id: "b", body: "y", page: 1, noted_on: "2026-11-11" },
      { id: "3", project_id: "a", body: "z", page: 30, noted_on: "2026-11-12" },
    ];
    expect(notesOf(all, "a").map((n) => n.id)).toEqual(["3", "1"]);
  });
});

describe("folha de leitura", () => {
  beforeEach(() => { vi.clearAllMocks(); h.add.mockResolvedValue({ added: 7, current: 20, total: 205, finished: false }); h.noteAdd.mockResolvedValue("n1"); });
  const open = (v = book()) => render(<MemoryRouter><QuickLogSheet view={v} date="2026-11-11" open onOpenChange={vi.fn()} /></MemoryRouter>);

  it("mostra onde parou e calcula as páginas ao digitar a página", () => {
    open();
    expect(screen.getByText("365 Hábitos Poderosos")).toBeTruthy();
    expect(screen.getByText(/Você parou na página/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Parei na página"), { target: { value: "20" } });
    expect(screen.getByText("+7 páginas desde a última marcação")).toBeTruthy();
    expect(screen.queryByText("+30")).toBeNull();
  });
  it("registra só a diferença e guarda a anotação com a página", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Parei na página"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("O que ficou desta leitura"), { target: { value: "  Hábito pequeno vira rotina.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(h.add).toHaveBeenCalledWith({ habit_id: "ler", amount: 7, date: "2026-11-11" }));
    await waitFor(() => expect(h.noteAdd).toHaveBeenCalledWith({ project_id: "p1", body: "Hábito pequeno vira rotina.", page: 20, date: "2026-11-11" }));
  });
  it("sem anotação, não chama o salvar de anotação", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Parei na página"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(h.add).toHaveBeenCalled());
    expect(h.noteAdd).not.toHaveBeenCalled();
  });
  it("página menor ou igual à atual não registra nada e explica", () => {
    open();
    fireEvent.change(screen.getByLabelText("Parei na página"), { target: { value: "8" } });
    expect(screen.getByText("Você já tinha chegado em 13.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Registrar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(h.add).not.toHaveBeenCalled();
  });
  it("se a anotação falha, o avanço fica salvo e a pessoa é avisada", async () => {
    h.noteAdd.mockRejectedValue(new Error("x"));
    open();
    fireEvent.change(screen.getByLabelText("Parei na página"), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("O que ficou desta leitura"), { target: { value: "Algo" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    await waitFor(() => expect(h.toastError).toHaveBeenCalledWith(expect.stringMatching(/avanço foi registrado, mas a anotação não foi salva/)));
  });
  it("reserva em dinheiro continua com os botões de valor, sem anotação", () => {
    open(book({ unit: "R$", total: 1000, current: 100 }));
    expect(screen.getByText("+100")).toBeTruthy();
    expect(screen.queryByLabelText("O que ficou desta leitura")).toBeNull();
  });
});

describe("resumo do livro (guarda)", () => {
  const notes = [{ body: "Hábito pequeno vira rotina com repetição diária." }, { body: "O autor cita 3 passos para começar." }];
  it("aprova tópicos que vêm das anotações", () => {
    expect(guardBook(["Hábitos pequenos viram rotina pela repetição", "Três passos para começar"], notes).ok).toBe(true);
    expect(guardBook(["Rotina nasce da repetição diária", "São 3 passos para começar"], notes).ok).toBe(true);
  });
  it("reprova número novo, link, tópico sem relação e lista vazia", () => {
    expect(guardBook(["O autor cita 5 passos para começar"], notes).reason).toBe("number_not_in_notes");
    expect(guardBook(["Veja https://x.com sobre rotina"], notes).reason).toBe("link");
    expect(guardBook(["Capitalismo moderno e mercado financeiro"], notes).reason).toBe("not_from_notes");
    expect(guardBook([], notes).ok).toBe(false);
    expect(guardBook("texto", notes).reason).toBe("not_a_list");
  });
  it("texto de reserva usa a primeira frase de cada anotação, no máximo 8", () => {
    expect(fallbackBook(notes)).toEqual(["Hábito pequeno vira rotina com repetição diária.", "O autor cita 3 passos para começar."]);
    const many = Array.from({ length: 20 }, (_, i) => ({ body: `Anotação ${i}. Resto.` }));
    expect(fallbackBook(many)).toHaveLength(8);
  });
});
