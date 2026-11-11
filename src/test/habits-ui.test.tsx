import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { HbHabitRow } from "@/lib/habits/api";
import { draftError, draftToInput, EMPTY, EMPTY_QUIT, fromCatalog, measureText, needsConsent, quitDraftError, quitDraftToInput, withOption } from "@/lib/habits/draft";
import { CATALOG, findCatalog } from "@/lib/habits/catalog";
import { isMoneyTabRoot } from "@/lib/habits/modeRoutes";
import { summarizeHabit, type LogRow } from "@/lib/habits/engine";

const h = vi.hoisted(() => ({
  enabled: { data: true as boolean | undefined, isLoading: false },
  views: { views: [] as unknown[], paused: [] as unknown[], rules: [] as unknown[], quitViews: [] as unknown[], activeCount: 0, consent: false, today: "2026-11-10" as string | null, logs: [] as unknown[], isLoading: false, isError: false, refetch: vi.fn() },
  setMode: vi.fn(),
  logAsync: vi.fn(),
  unlogAsync: vi.fn(),
  createAsync: vi.fn(),
  templates: { data: [] as unknown[], isLoading: false },
  grantAsync: vi.fn(),
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
    useExpenseCategories: () => ({ data: [{ id: "c1", name: "Delivery" }] }),
    useQuitMoney: () => ({ data: { q1: { estimate: 240, days: 12 } } }),
    useWeeklyCategorySpend: () => ({ data: [{ week_start: "2026-11-02", spent: 80 }] }),
    useSuggestPlan: () => ({ mutateAsync: vi.fn().mockResolvedValue({ ok: true, source: "ai", plan: { cue_text: "Depois de tomar café", minimum_text: "3 respirações" } }), isPending: false }),
    useAnswerAutomaticity: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useGrantConsent: () => ({ mutateAsync: h.grantAsync, mutate: vi.fn(), isPending: false }),
    useRevokeConsent: () => ({ mutate: vi.fn(), isPending: false }),
  };
});
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));

import { ModeSwitch } from "@/components/hb/ModeSwitch";
import HabitsApp from "@/pages/habits/HabitsApp";
import Hoje from "@/pages/habits/Hoje";
import Novo from "@/pages/habits/Novo";
import Dinheiro from "@/pages/habits/Dinheiro";

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
  return { habit, def, pauses: [], form: "check", project: null, projects_done: [], steps: [], steps_today: [], auto: { latest: null, first: null, delta: null, answers: 0, consecutive_high: 0, series: [] }, auto_due: false, summary: summarizeHabit(def, logs, today, []) };
};
const L = (habit_id: string, local_date: string, status: LogRow["status"] = "done"): LogRow => ({ habit_id, local_date, status, quantity: null });

beforeEach(() => {
  h.enabled = { data: true, isLoading: false };
  h.views = { views: [], paused: [], rules: [], quitViews: [], activeCount: 0, consent: false, today: "2026-11-10", logs: [], isLoading: false, isError: false, refetch: vi.fn() };
  h.setMode.mockReset(); h.logAsync.mockReset().mockResolvedValue("id"); h.unlogAsync.mockReset().mockResolvedValue(null); h.createAsync.mockReset().mockResolvedValue("new");
  h.templates = { data: [], isLoading: false };
  h.grantAsync.mockReset().mockResolvedValue(null);
});

describe("rascunho do novo hábito", () => {
  const cat = (id: string) => findCatalog(id)!;
  it("feito ou não, com gatilho e versão mínima", () => {
    const input = draftToInput({ ...EMPTY, title: " Meditar ", cue_text: "Depois de tomar café", minimum_text: "3 respirações" });
    expect(input).toMatchObject({ kind: "do_daily", form: "check", title: "Meditar", cue_kind: "after_event", cue_text: "Depois de tomar café", minimum_text: "3 respirações", days_of_week: null, start_today: false });
  });
  it("dias escolhidos viram lista; os 7 dias viram 'todos' (nulo)", () => {
    expect(draftToInput({ ...EMPTY, title: "Ler", days: [1, 3, 5] }).days_of_week).toEqual([1, 3, 5]);
    expect(draftToInput({ ...EMPTY, title: "Ler", days: [0, 1, 2, 3, 4, 5, 6] }).days_of_week).toBeNull();
  });
  it("cada forma usa os campos certos", () => {
    expect(draftToInput(fromCatalog(cat("treinar")))).toMatchObject({ kind: "do_weekly_count", form: "weekly", weekly_target: 3 });
    expect(draftToInput(fromCatalog(cat("agua")))).toMatchObject({ kind: "do_quantity", form: "amount", quantity_target: 2, quantity_unit: "litros", quantity_period: "day" });
    expect(draftToInput(fromCatalog(cat("caminhar")))).toMatchObject({ form: "duration", quantity_target: 20, quantity_unit: "min" });
    expect(draftToInput(fromCatalog(cat("dormir")))).toMatchObject({ form: "time", direction: "at_most", quantity_target: 23 * 60 });
    expect(draftToInput(fromCatalog(cat("tela")))).toMatchObject({ form: "ceiling", direction: "at_most", implicit_ok: true, quantity_target: 3 });
    expect(draftToInput(fromCatalog(cat("humor")))).toMatchObject({ form: "value", direction: "track" });
    expect(draftToInput(withOption(fromCatalog(cat("consulta")), cat("consulta"), 0))).toMatchObject({ form: "recurring", interval_days: 365, days_of_week: null });
  });
  it("o nome nunca carrega a meta: mudar a quantidade não mexe no nome", () => {
    const d = fromCatalog(cat("agua"));
    expect(d.title).toBe("Beber água");
    expect(draftToInput({ ...d, target: 3 })).toMatchObject({ title: "Beber água", quantity_target: 3 });
  });
  it("projeto e rotina em passos exigem o que precisam", () => {
    const ler = withOption(fromCatalog(cat("ler")), cat("ler"), 0);
    expect(draftError(ler)).toMatch(/projeto/i);
    expect(draftError({ ...ler, project_title: "Meu livro", project_total: "224" })).toBeNull();
    expect(draftToInput({ ...ler, project_title: "Meu livro", project_total: "224", project_current: "30" })).toMatchObject({ form: "project", project: { title: "Meu livro", total: 224, current: 30, unit: "páginas" } });
    const manha = fromCatalog(cat("manha"));
    expect(draftToInput(manha)).toMatchObject({ form: "steps", steps: ["Beber água", "Arrumar a cama", "Alongar", "Tomar café sem celular"] });
    expect(draftError({ ...manha, steps: [" ", ""] })).toMatch(/passo/i);
  });
  it("valida nome; sem gatilho não grava cue_kind", () => {
    expect(draftError({ ...EMPTY, title: "" })).toMatch(/nome/i);
    expect(draftError({ ...EMPTY, title: "Ler" })).toBeNull();
    expect(draftToInput({ ...EMPTY, title: "Ler" }).cue_kind).toBeNull();
  });
  it("catálogo: nenhum nome carrega número de meta", () => {
    for (const it of CATALOG) expect(it.label).not.toMatch(/\d/);
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
  it("escolhe uma sugestão, percorre o fluxo e cria com o payload esperado", async () => {
    render(<MemoryRouter initialEntries={["/h/novo"]}><Routes><Route path="/h/novo" element={<Novo />} /><Route path="/h/hoje" element={<p>hoje</p>} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Meditar" }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" })); // quando
    fireEvent.click(screen.getByRole("button", { name: "Continuar" })); // dia ruim
    fireEvent.click(screen.getByRole("button", { name: "Continuar" })); // como acompanhar
    fireEvent.click(screen.getByRole("button", { name: "Começar hoje" }));
    fireEvent.click(screen.getByRole("button", { name: "Criar hábito" }));
    await waitFor(() => expect(h.createAsync).toHaveBeenCalled());
    expect(h.createAsync.mock.calls[0][0]).toMatchObject({ kind: "do_quantity", form: "duration", title: "Meditar", cue_text: "Manhã · depois do café", minimum_text: "3 respirações", quantity_target: 5, start_today: true });
    await waitFor(() => expect(screen.getByText("hoje")).toBeTruthy());
  });
  it("o nome continua editável em qualquer passo", () => {
    render(<MemoryRouter initialEntries={["/h/novo"]}><Routes><Route path="/h/novo" element={<Novo />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Beber água" }));
    fireEvent.change(screen.getByLabelText(/Nome do hábito/), { target: { value: "Beber 3 L de água" } });
    expect((screen.getByLabelText(/Nome do hábito/) as HTMLInputElement).value).toBe("Beber 3 L de água");
  });
  it("Largar tem fluxo próprio", () => {
    render(<MemoryRouter initialEntries={["/h/novo"]}><Routes><Route path="/h/novo" element={<Novo />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Largar algo" }));
    fireEvent.click(screen.getByRole("button", { name: "Delivery por impulso" }));
    expect(screen.getByText("Quando bater a vontade?")).toBeTruthy();
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


describe("largar (F3)", () => {
  it("rascunho de largar vira kind quit com plano e valor informado", () => {
    expect(quitDraftToInput({ ...EMPTY_QUIT, title: " Delivery ", craving_plan: "esperar 10 min", daily_cost: "25,5" }))
      .toMatchObject({ kind: "quit", title: "Delivery", craving_plan: "esperar 10 min", daily_cost: 25.5, sensitivity: "normal", money_category_id: null });
    expect(quitDraftError({ ...EMPTY_QUIT, title: "" })).toBeTruthy();
    expect(quitDraftError({ ...EMPTY_QUIT, title: "Cigarro", daily_cost: "abc" })).toBeTruthy();
  });
  it("só substância e saúde pedem autorização", () => {
    expect(needsConsent({ ...EMPTY_QUIT, sensitivity: "normal" })).toBe(false);
    expect(needsConsent({ ...EMPTY_QUIT, sensitivity: "substance" })).toBe(true);
  });
  it("Hoje mostra a seção Largando com os dias sem", () => {
    h.views = { ...h.views, quitViews: [{ habit: row({ id: "q1", kind: "quit", title: "Delivery por impulso" }), cycle: null, stats: { days_clean: 12, best: 20, total_days_clean: 32, relapses: 1, noted_slips: 0, cravings_30: 0, craving_handled_rate: null, last_milestone: 7, next_milestone: 14, started_on: "2026-10-29" } }], activeCount: 1 };
    render(<MemoryRouter initialEntries={["/h/hoje"]}><Routes><Route path="*" element={<Hoje />} /></Routes></MemoryRouter>);
    expect(screen.getByText("Largando")).toBeTruthy();
    expect(screen.getByText("Delivery por impulso")).toBeTruthy();
    expect(screen.getByText(/recorde 20 dias/)).toBeTruthy();
  });
});

describe("hábitos e dinheiro (F5)", () => {
  const go = () => render(<MemoryRouter initialEntries={["/h/dinheiro"]}><Routes><Route path="*" element={<Dinheiro />} /></Routes></MemoryRouter>);
  it("sem nada ligado ao dinheiro explica como começar", () => {
    go();
    expect(screen.getByText("Nada ligado ao dinheiro ainda")).toBeTruthy();
  });
  it("estimativa de dinheiro aparece rotulada e com a ressalva", () => {
    h.views = { ...h.views, quitViews: [{ habit: row({ id: "q1", kind: "quit", title: "Delivery por impulso" }), cycle: null, stats: { days_clean: 12, best: 12, total_days_clean: 12, relapses: 0, noted_slips: 0, cravings_30: 0, craving_handled_rate: null, last_milestone: 7, next_milestone: 14, started_on: "2026-10-29" } }] };
    go();
    expect(screen.getByText("estimativa")).toBeTruthy();
    expect(screen.getByText(/não é um extrato|não um extrato/)).toBeTruthy();
  });
  it("com poucas semanas de dados o Nino recusa tirar conclusão", () => {
    h.views = { ...h.views, views: [view(row(), [])], rules: [{ habit_id: "h1", rule_type: "no_spend_category", category_id: "c1", limit_amount: null }] };
    go();
    expect(screen.getByText(/Ainda é cedo/)).toBeTruthy();
    expect(screen.getByText(/Não vou tirar conclusão/)).toBeTruthy();
  });
});

describe("valores livres na criação", () => {
  it("horário aceita minutos (22:30) e vira minutos desde a meia-noite", () => {
    const cat = findCatalog("dormir")!;
    const d = { ...fromCatalog(cat), target: 22.5 };
    expect(draftToInput(d)).toMatchObject({ form: "time", quantity_target: 1350 });
    expect(measureText(d)).toContain("22:30");
  });
  it("páginas por dia aceita qualquer valor, não só os degraus", () => {
    const cat = findCatalog("ler")!;
    expect(draftToInput({ ...fromCatalog(cat), target: 17 })).toMatchObject({ form: "project", quantity_target: 17 });
  });
});
