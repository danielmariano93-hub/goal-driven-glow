import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const inserts: unknown[] = [];
let existing: Array<{ answered_at: string; score: number; total: number }> = [];

vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/lib/ui/feedback", () => ({ notifySuccess: () => undefined, notifyError: () => undefined }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => ({ limit: async () => ({ data: existing, error: null }) }) }),
      insert: async (row: unknown) => { inserts.push(row); return { error: null }; },
    }),
  },
}));

async function mount() {
  const { FinancialWellBeingCard } = await import("@/components/habits/FinancialWellBeingCard");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><FinancialWellBeingCard /></QueryClientProvider>);
}

describe("questionário de bem-estar financeiro", () => {
  it("primeira vez: responde as 10 perguntas e grava soma e nota oficiais", async () => {
    existing = [];
    await mount();
    fireEvent.click(await screen.findByText("Responder agora"));
    const save = screen.getByText("Salvar respostas") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // 1ª opção de cada item: itens normais valem 4 (6 itens... 1,2,4,8) e invertidos valem 0 → soma 16
    for (let id = 1; id <= 10; id++) fireEvent.click(document.querySelector(`input[name="fwb-${id}"]`)!);
    expect((screen.getByText("Salvar respostas") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByText("Salvar respostas"));
    await waitFor(() => expect(inserts).toHaveLength(1));
    expect(inserts[0]).toMatchObject({ user_id: "u1", total: 16, score: 45, age_band: "18-61", scale_version: "cfpb_fwb10.v1" });
  });

  it("respondeu há 6 dias: mostra a nota e a próxima medição em 9 dias, sem botão", async () => {
    existing = [{ answered_at: new Date(Date.now() - 6 * 86_400_000).toISOString(), score: 52, total: 20 }];
    await mount();
    expect(await screen.findByText(/Próxima medição em 9 dias/)).toBeInTheDocument();
    expect(screen.queryByText("Responder de novo")).toBeNull();
  });
});
