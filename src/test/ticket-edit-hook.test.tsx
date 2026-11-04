import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const calls: string[] = [];
let insertError: unknown = null;
let deleteError: unknown = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: (row: Record<string, unknown>) => { calls.push(`insert:${row.amount}:${row.note ?? ""}:${row.source}`); return Promise.resolve({ data: null, error: insertError }); },
      delete: () => ({ eq: (_c: string, id: string) => { calls.push(`delete:${id}`); return Promise.resolve({ data: null, error: deleteError }); } }),
    }),
  },
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));

import { useEditBenefitEntry } from "@/lib/db/benefitWallet";

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const original = { id: "old", kind: "spend", amount: 10, occurred_on: "2026-11-04", merchant: "A", note: "12:30", created_at: "x", source: "document" } as never;

describe("corrigir lançamento: grava a nova linha antes de remover a antiga", () => {
  beforeEach(() => { calls.length = 0; insertError = null; deleteError = null; });

  it("insere (mantendo origem e nota) e depois exclui a antiga", async () => {
    const { result } = renderHook(() => useEditBenefitEntry("w1"), { wrapper });
    await act(async () => { await result.current.mutateAsync({ original, amount: 12.5, occurred_on: "2026-11-04", merchant: "B" }); });
    expect(calls).toEqual(["insert:12.5:12:30:document", "delete:old"]);
  });
  it("se a gravação falha, a antiga não é tocada", async () => {
    insertError = { message: "x" };
    const { result } = renderHook(() => useEditBenefitEntry("w1"), { wrapper });
    await act(async () => { await result.current.mutateAsync({ original, amount: 12.5, occurred_on: "2026-11-04", merchant: null }).catch(() => {}); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(calls).toEqual(["insert:12.5:12:30:document"]);
  });
  it("se a remoção falha, avisa com um erro reconhecível (nada se perde)", async () => {
    deleteError = { message: "x" };
    const { result } = renderHook(() => useEditBenefitEntry("w1"), { wrapper });
    await act(async () => { await result.current.mutateAsync({ original, amount: 12.5, occurred_on: "2026-11-04", merchant: null }).catch(() => {}); });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect((result.current.error as Error).message).toBe("edit_old_not_removed");
  });
});
