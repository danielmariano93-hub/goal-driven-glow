import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn().mockResolvedValue({ error: null });
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CreateDayPlanSheet, suggestionText } from "@/components/metas/CreateDayPlanSheet";

const tx = (day: string, amount: number) => ({ id: day, occurred_at: `${day}T15:00:00Z`, category_id: "lazer", type: "expense", status: "confirmed", amount, movement_kind: "transaction" });
const FRIDAYS = ["2026-10-30", "2026-10-23", "2026-10-16", "2026-10-09", "2026-10-02", "2026-09-25", "2026-09-18", "2026-09-11"];
const txs = FRIDAYS.map((d) => tx(d, 272));
const options = [{ categoryId: "lazer", name: "Lazer", goal: { remainingAmount: 640, periodEnd: "2026-11-30", targetAmount: 1500 } }];

const renderSheet = (activePlan: never = null as never) => {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <CreateDayPlanSheet open onOpenChange={() => {}} today="2026-11-05" txs={txs} options={options} activePlan={activePlan} />
    </QueryClientProvider>,
  );
};

describe("folha 'Criar um plano'", () => {
  beforeEach(() => rpc.mockClear());

  it("abre no dia mais forte (sexta), sugere o degrau e descreve o fim de semana", () => {
    renderSheet();
    expect((screen.getByLabelText("Quanto cabe") as HTMLInputElement).value).toBe("216");
    expect(screen.getByTestId("plan-when").textContent).toMatch(/sexta a domingo \(06\/11 a 08\/11\)/);
    expect(screen.getByTestId("plan-suggestion").textContent).toMatch(/passo no meio do caminho/);
  });

  it("envia o plano pela função habit_limit_accept com a data da próxima sexta", async () => {
    renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Começar o plano" }));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(rpc.mock.calls[0][0]).toBe("habit_limit_accept");
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_category: "Lazer", p_friday: "2026-11-06", p_target: 216, p_anchor_kind: "goal", p_anchor_amount: 1500 });
  });

  it("com plano ativo não mostra o formulário e oferece cancelar", () => {
    renderSheet({ friday: "2026-11-06", category: "Lazer", status: "accepted", target_amount: 216, expected_amount: 272, realized_amount: null, accepted_at: "x" } as never);
    expect(screen.getByTestId("plan-active-notice").textContent).toMatch(/Só um plano ativo por vez/);
    expect(screen.queryByRole("button", { name: "Começar o plano" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancelar esse plano" })).toBeTruthy();
  });

  it("texto sem histórico não inventa número", () => {
    expect(suggestionText({ typical: 0, goalRoom: null, target: 0, cutPct: 0, kind: "no_history" }, "Lazer", 5)).toMatch(/Ainda não há histórico/);
  });
});
