import { describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// "Ver detalhes" do insight de meta de categoria abria uma tela de erro: três hooks vinham depois de um
// `return` de carregamento, o que derruba o componente quando os dados terminam de carregar.

const state = vi.hoisted(() => ({
  loading: true,
  empty: { data: undefined, isLoading: false, isError: false },
  mutation: () => ({ mutate: () => undefined, mutateAsync: async () => undefined, isPending: false }),
}));

vi.mock("@/lib/db/finance", () => { const { empty, mutation } = state; return {
  useCategories: () => empty,
  useLedgerWindow: () => empty,
  useGoals: () => empty,
  useCategorySpendingGoals: () => ({ data: [], isLoading: state.loading }),
  useSaveCategorySpendingGoal: mutation,
  useDeleteCategorySpendingGoal: mutation,
  useUpdateCategorySpendingGoalStatus: mutation,
}; });
vi.mock("@/lib/hooks/useFinancialSnapshot", () => ({ useFinancialSnapshot: () => state.empty }));
vi.mock("@/lib/nino/spendingGoals", () => { const { empty, mutation } = state; return {
  useAdjustCategoryGoal: mutation,
  useGoalAdjustments: () => empty,
  useSaveMerchantTarget: mutation,
  useSetSavingsDestination: mutation,
  useGoalHistory: () => empty,
  useSpendingGoalAdvice: () => empty,
  useSpendingGoalReadings: () => empty,
  useUpdateMerchantTargetStatus: mutation,
}; });
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import MetaCategoriaDetalhe from "@/pages/MetaCategoriaDetalhe";

const tree = () => (
  <MemoryRouter initialEntries={["/app/metas/categoria/abc"]}>
    <Routes><Route path="/app/metas/categoria/:id" element={<MetaCategoriaDetalhe />} /></Routes>
  </MemoryRouter>
);

describe("detalhe da meta de categoria", () => {
  it("não quebra quando termina de carregar (mesma ordem de hooks nos dois estados)", () => {
    state.loading = true;
    const view = render(tree());
    state.loading = false;
    expect(() => view.rerender(tree())).not.toThrow();
    expect(screen.getByText(/Esta meta não está mais disponível/i)).toBeTruthy();
    cleanup();
  });
});
