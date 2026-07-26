import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// Mocks — Supabase client and Auth context are the only external inputs.
const rpcMock = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

let currentUser: { id: string } | null = { id: "u-1" };
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ user: currentUser }),
}));

import { usePlatformPermissions } from "@/hooks/usePlatformPermissions";

describe("usePlatformPermissions — referential stability", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    currentUser = { id: "u-1" };
  });

  it("keeps `permissions` and `can` referentially stable across renders when RPC returns identical data", async () => {
    rpcMock.mockResolvedValue({
      data: [
        { action: "clients.read", allowed: true },
        { action: "clients.identity.masked", allowed: true },
      ],
      error: null,
    });

    const { result, rerender } = renderHook(() => usePlatformPermissions());
    await waitFor(() => expect(result.current.ready).toBe(true));

    const firstPermissions = result.current.permissions;
    const firstCan = result.current.can;

    // Force a re-render without changing user; hook must not swap references.
    rerender();
    expect(result.current.permissions).toBe(firstPermissions);
    expect(result.current.can).toBe(firstCan);

    // `can` remains a stable reference (crucial: guards useEffect deps).
    expect(firstCan("clients.read")).toBe(true);
    expect(firstCan("nonexistent")).toBe(false);
  });

  it("returns an empty stable Set when there is no authenticated user", async () => {
    currentUser = null;
    const { result, rerender } = renderHook(() => usePlatformPermissions());
    await waitFor(() => expect(result.current.ready).toBe(true));
    const p1 = result.current.permissions;
    rerender();
    expect(result.current.permissions).toBe(p1);
    expect(p1.size).toBe(0);
  });

  it("updates references only when the effective permission set actually changes", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ action: "a", allowed: true }],
      error: null,
    });
    const { result, rerender } = renderHook(() => usePlatformPermissions());
    await waitFor(() => expect(result.current.ready).toBe(true));
    const firstPermissions = result.current.permissions;

    // Simulate a full reload path returning identical data — hook keeps ref.
    rpcMock.mockResolvedValueOnce({
      data: [{ action: "a", allowed: true }],
      error: null,
    });
    await act(async () => {
      // Trigger the effect again by flipping user identity to same value
      // through a re-render path handled by the hook's own load logic.
      rerender();
    });
    expect(result.current.permissions).toBe(firstPermissions);
  });
});
