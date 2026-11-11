import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { HbHabitRow } from "@/lib/habits/api";
import { draftError, draftToInput, EMPTY, fromTemplate } from "@/lib/habits/draft";
import { isMoneyTabRoot } from "@/lib/habits/modeRoutes";
import { summarizeHabit, type LogRow } from "@/lib/habits/engine";

const h = vi.hoisted(() => ({
  enabled: { data: true as boolean | undefined, isLoading: false },
  views: { views: [] as unknown[], today: "2026-11-10" as string | null, logs: [] as unknown[], isLoading: false, isError: false, refetch: vi.fn() },
  setMode: vi.fn(),
  logAsync: vi.fn(),
  unlogAsync: vi.fn(),
  createAsync: vi.fn(),
  templates: { data: [] as unknown[], isLoading: false },
}));

vi.mock("@/lib/habits/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/habits/api")>("@/lib/habits/api");
  return {
    ...actual,
    useHabitsEnabled: () => h.enabled,
    useSetHbMode: () => ({ mutate: h.setMode }),
    useHabitViews: () => h.views,
    useLogHabit: () => ({ mutateAsync: h.logAsync, isPending: false }),
    useUnlogHabit: () => ({ mutateAsync: h.unlogAsync, isPending: false }),
    useCreateHabit: () => ({ mutateAsync: h.createAsync, isPending: false }),
    useHbTemplates: () => h.templates,
  };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { ModeSwitch } from "@/components/hb/ModeSwitch";
import HabitsApp from "@/pages/habits/HabitsApp";
import Hoje from "@/pages/habits/Hoje";
import Novo from "@/pages/habits/Novo";

const row = (over: Partial<HbHabitRow> = {}): HbHabitRow => ({
  id: "h1", template_id: null, kind: "do_daily", title: "Meditar 5 min", area: "mind", sensitivity: "normal",
  cue_kind: "after_event", cue_text: "Depois do café", cue_time: null, minimum_text: "3 respirações", days_of_week: null,
  weekly_target: null, quantity_target: null, quantity_unit: null, quantity_period: null, rest_per_week: 1, status: "active",
  started_on: "2026-11-01", created_at: "2026-10-31T12:00:00Z", ...over,
});
const view = (habit: HbHabitRow, logs: LogRow[], today = "2026-11-10") => {
  const def = {
    id: habit.id, kind: habit.kind, started_on: habit.started_on, days_of_week: habit.days_of_week, weekly_target: habit.weekly_target,
    quantity_target: habit.quantity_target, quantity_period: habit.quantity_period, rest_per_week: habit.rest_per_week,
  };
  return { habit, def, pauses: [], summary: summarizeHabit(def, logs, today, []) };
};
const L = (habit_id: string, local_date: string, status: LogRow["status"] = "done"): LogRow => ({ habit_id, local_date, status, quantity: null });

beforeEach(() => {
  h.enabled = { data: true, isLoading: false };
  h.views = { views: [], today: "2026-11-10", logs: [], isLoading: false, isError: false, refetch: vi.fn() };
  h.setMode.mockReset(); h.logAsync.mockReset().mockResolvedValue("id"); h.unlogAsync.mockReset().mockResolvedValue(null); h.createAsync.mockReset().mockResolvedValue("new");
  h.templates = { data: [], isLoading: false };
});

describe("rascunho do novo hábito", () => {
  it("todo dia com gatilho e versão mínima vira do_daily com cue_kind after_event", () => {
    const input = draftToInput({ ...EMPTY, title: " Meditar 5 min ", cue_text: "Depois de tomar café", minimum_text: "3 respirações" });
    expect(input).toMatchObject({ kind: "do_daily", title: "Meditar 5 min", cue_kind: "after_event", cue_text: "Depois de tomar café", minimum_text: "3 respirações", days_of_week: null, rest_per_week: 1, start_today: false });
  });
  it("dias escolhidos viram lista; os 7 dias viram 'todos' (nulo)", () => {
    expect(draftToInput({ ...EMPTY, title: "Ler", days: [1, 3, 5] }).days_of_week).toEqual([1, 3, 5]);
    expect(draftToInput({ ...EMPTY, title: "Ler", days: [0, 1, 2, 3, 4, 5, 6] }).days_of_week).toBeNull();
  });
  it("X por semana e quantidade usam os campos certos", () => {
    expect(draftToInput({ ...EMPTY, title: "Treinar", cadence: "weekly", weekly_target: 4 })).toMatchObject({ kind: "do_weekly_count", weekly_target: 4 });
    expect(draftToInput({ ...EMPTY, title: "Ler", cadence: "quantity", quantity_target: "10", quantity_unit: "páginas", quantity_period: "week" }))
      .toMatchObject({ kind: "do_quantity", quantity_target: 10, quantity_unit: "páginas", quantity_period: "week" });
  });
  it("valida nome e meta de quantidade; sem gatilho não grava cue_kind", () => {
    expect(draftError({ ...EMPTY, title: "" })).toMatch(/nome/i);
    expect(draftError({ ...EMPTY, title: "Ler", cadence: "quantity", quantity_target: "" })).toMatch(/quantidade/i);
    expect(draftError({ ...EMPTY, title: "Ler" })).toBeNull();
    expect(draftToInput({ ...EMPTY, title: "Ler" }).cue_kind).toBeNull();
  });
  it("modelo pronto preenche gatilho, versão mínima e tipo", () => {
    const d = fromTemplate({ id: "t1", slug: "ler-10", title: "Ler 10 páginas", area: "mind", kind: "do_quantity", cue_suggestion: "Antes de dormir", minimum_suggestion: "Ler 1 página", why_it_works: null, weekly_target: null, quantity_target: 10, quantity_unit: "páginas", quantity_period: "day", sort_order: 40 });
    expect(d).toMatchObject({ template_id: "t1", cadence: "quantity", quantity_target: "10", cue_text: "Antes de dormir", minimum_text: "Ler 1 página" });
  });
});

describe("seletor Dinheiro | Hábitos nas telas financeiras", () => {
  it("só nas rotas raiz das abas", () => {
    for (const p of ["/app", "/app/", "/app/lancamentos", "/app/metas", "/app/mais"]) expect(isMoneyTabRoot(p), p).toBe(true);
    for (const p of ["/app/metas/123", "/app/lancamentos/9", "/app/contas", "/h/hoje"]) expect(isMoneyTabRoot(p), p).toBe(false);
  });
  it("sem liberação ou carregando não renderiza NADA (DOM idêntico ao de antes)", () => {
    for (const enabled of [{ data: false, isLoading: false }, { data: undefined, isLoading: true }]) {
      h.enabled = enabled as typeof h.enabled;
      const { container, unmount } = render(<MemoryRouter initialEntries={["/app"]}><ModeSwitch /></MemoryRouter>);
      expect(container.innerHTML).toBe("");
      unmount();
    }
  });
  it("liberado, aparece na raiz da aba e não em telas de detalhe", () => {
    const { container, unmount } = render(<MemoryRouter initialEntries={["/app/metas/123"]}><ModeSwitch /></MemoryRouter>);
    expect(container.innerHTML).toBe("");
    unmount();
    render(<MemoryRouter initialEntries={["/app/metas"]}><ModeSwitch /></MemoryRouter>);
    expect(screen.getByTestId("hb-mode-switch")).toBeTruthy();
  });
  it("tocar em Hábitos lembra o modo e leva para /h/hoje", () => {
    render(
      <MemoryRouter initialEntries={["/app"]}>
        <Routes>
          <Route path="/app" element={<ModeSwitch />} />
          <Route path="/h/hoje" element={<p>tela de hábitos</p>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Hábitos" }));
    expect(h.setMode).toHaveBeenCalledWith("habits");
    expect(screen.getByText("tela de hábitos")).toBeTruthy();
  });
  it("/h sem liberação volta para o Nino Dinheiro", () => {
    h.enabled = { data: false, isLoading: false };
    render(
      <MemoryRouter initialEntries={["/h/hoje"]}>
        <Routes>
          <Route path="/h/*" element={<HabitsApp />} />
          <Route path="/app" element={<p>nino dinheiro</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("nino dinheiro")).toBeTruthy();
  });
});

describe("tela Hoje", () => {
  it("sem hábitos convida a criar o primeiro", () => {
    render(<MemoryRouter><Hoje /></MemoryRouter>);
    expect(screen.getByRole("link", { name: /Criar meu primeiro hábito/ })).toBeTruthy();
  });
  it("mostra 1/2 feitos hoje e marca/desmarca pelo círculo", async () => {
    const a = row({ id: "a", title: "Meditar 5 min" });
    const b = row({ id: "b", title: "Caminhar 20 min", cue_text: "Depois do almoço" });
    const logs = [L("a", "2026-11-10")];
    h.views = { ...h.views, views: [view(a, logs), view(b, logs)], logs };
    render(<MemoryRouter><Hoje /></MemoryRouter>);
    expect(screen.getByText("feitos hoje")).toBeTruthy();
    expect(screen.getByRole("img", { name: /1 de 2 hábitos de hoje feitos/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Marcar Caminhar 20 min como feito" }));
    await waitFor(() => expect(h.logAsync).toHaveBeenCalledWith({ habit_id: "b", date: "2026-11-10", status: "done" }));
    fireEvent.click(screen.getByRole("button", { name: "Desmarcar Meditar 5 min" }));
    await waitFor(() => expect(h.unlogAsync).toHaveBeenCalledWith({ habit_id: "a", date: "2026-11-10" }));
  });
  it("hábito que só começa amanhã aparece em 'Não previstos hoje', fora da conta", () => {
    const a = row({ id: "a", title: "Dormir cedo", started_on: "2026-11-11" });
    h.views = { ...h.views, views: [view(a, [])], logs: [] };
    render(<MemoryRouter><Hoje /></MemoryRouter>);
    expect(screen.getByText(/Não previstos hoje: Dormir cedo/)).toBeTruthy();
    expect(screen.getByText("Nada previsto para hoje")).toBeTruthy();
  });
  it("erro de carga mostra tentar de novo", () => {
    h.views = { ...h.views, isError: true };
    render(<MemoryRouter><Hoje /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(h.views.refetch).toHaveBeenCalled();
  });
});

describe("tela Novo hábito", () => {
  it("escolhe um modelo, ajusta e cria com o payload esperado", async () => {
    h.templates = { data: [{ id: "t1", slug: "meditar-5", title: "Meditar 5 min", area: "mind", kind: "do_daily", cue_suggestion: "Depois de tomar café", minimum_suggestion: "3 respirações", why_it_works: null, weekly_target: null, quantity_target: null, quantity_unit: null, quantity_period: null, sort_order: 30 }], isLoading: false };
    render(<MemoryRouter initialEntries={["/h/novo"]}><Routes><Route path="/h/novo" element={<Novo />} /><Route path="/h/hoje" element={<p>hoje</p>} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Meditar 5 min/ }));
    fireEvent.click(screen.getByRole("button", { name: "Hoje" }));
    fireEvent.click(screen.getByRole("button", { name: "Criar hábito" }));
    await waitFor(() => expect(h.createAsync).toHaveBeenCalled());
    expect(h.createAsync.mock.calls[0][0]).toMatchObject({ kind: "do_daily", title: "Meditar 5 min", template_id: "t1", cue_text: "Depois de tomar café", minimum_text: "3 respirações", start_today: true });
    await waitFor(() => expect(screen.getByText("hoje")).toBeTruthy());
  });
});

describe("contrato: as telas financeiras não mudam", () => {
  const SRC = resolve(process.cwd(), "src");
  const ALLOWED = ["pages/habits", "components/hb", "lib/habits", "test", "components/AppLayout.tsx", "App.tsx"];
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  }
  it("só o AppLayout e o App.tsx (rota /h) importam Hábitos fora do próprio módulo", () => {
    const offenders = walk(SRC)
      .map((p) => p.slice(SRC.length + 1))
      .filter((rel) => !ALLOWED.some((a) => rel === a || rel.startsWith(`${a}/`)))
      .filter((rel) => /@\/(components\/hb|lib\/habits|pages\/habits)/.test(readFileSync(join(SRC, rel), "utf8")));
    expect(offenders).toEqual([]);
  });
  it("AppLayout só ganhou o ModeSwitch (um import e um uso, acima do Outlet)", () => {
    const src = readFileSync(join(SRC, "components/AppLayout.tsx"), "utf8");
    expect(src.match(/<ModeSwitch \/>/g)).toHaveLength(1);
    expect(src.indexOf("<ModeSwitch />")).toBeLessThan(src.indexOf("<Outlet />"));
  });
  it("a rota /h fica fora do bloco /app (não toca o registro de navegação financeiro)", () => {
    const app = readFileSync(join(SRC, "App.tsx"), "utf8");
    const hAt = app.indexOf('path="/h/*"');
    expect(hAt).toBeGreaterThan(-1);
    expect(hAt).toBeLessThan(app.indexOf('path="/app"'));
  });
});
