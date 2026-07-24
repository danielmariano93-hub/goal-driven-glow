/**
 * Testes do timeout de sessão por inatividade.
 * Cobre atividade, aviso, logout, retorno após stale, sincronização, cleanup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useSessionInactivity,
  LAST_ACTIVITY_KEY,
  LOGOUT_REASON_KEY,
} from "@/hooks/useSessionInactivity";

const IDLE = 30_000; // 30s
const WARN = 5_000;  // aviso 5s antes → aparece aos 25s

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setup(signOut = vi.fn().mockResolvedValue(undefined), enabled = true) {
  const { result, rerender, unmount } = renderHook(
    (props: { enabled: boolean }) =>
      useSessionInactivity({
        idleMs: IDLE,
        warnMs: WARN,
        onSignOut: signOut,
        enabled: props.enabled,
      }),
    { initialProps: { enabled } },
  );
  return { result, rerender, unmount, signOut };
}

describe("useSessionInactivity", () => {
  it("aviso aparece na janela de aviso e logout ocorre no timeout total", async () => {
    const { result, signOut } = setup();
    expect(result.current.warning).toBe(false);
    // avança até imediatamente antes do aviso (IDLE - WARN = 25s)
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE - WARN - 100); });
    expect(result.current.warning).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(result.current.warning).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(WARN + 100); });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("keepAlive cancela o logout e zera a contagem", async () => {
    const { result, signOut } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE - WARN + 100); });
    expect(result.current.warning).toBe(true);
    act(() => result.current.keepAlive());
    expect(result.current.warning).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(WARN + 100); });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("signOutNow encerra imediatamente", async () => {
    const { result, signOut } = setup();
    await act(async () => { result.current.signOutNow(); await vi.runOnlyPendingTimersAsync(); });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(LOGOUT_REASON_KEY)).toBe("inactivity");
  });

  it("clique reinicia o contador antes do aviso", async () => {
    const { result, signOut } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE - WARN - 1_000); });
    act(() => { window.dispatchEvent(new MouseEvent("click")); });
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE - WARN - 1_000); });
    expect(result.current.warning).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(WARN + 500); });
    expect(result.current.warning).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("retorno após >= idleMs encerra a sessão antes de renderizar", async () => {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now() - IDLE - 5_000));
    const signOut = vi.fn().mockResolvedValue(undefined);
    setup(signOut, true);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("retorno antes de idleMs mantém a sessão", async () => {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now() - 1_000));
    const signOut = vi.fn().mockResolvedValue(undefined);
    const { result } = setup(signOut, true);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(signOut).not.toHaveBeenCalled();
    expect(result.current.warning).toBe(false);
  });

  it("guard desabilitado (não autenticado) não agenda logout", async () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    setup(signOut, false);
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE + 5_000); });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("evento storage de logout sincroniza saída entre abas", async () => {
    const { signOut } = setup();
    // Simula outra aba encerrando: remove a chave e depois um logout via canal
    // Como BroadcastChannel pode não existir no jsdom, forçamos via storage.
    act(() => {
      const ev = new StorageEvent("storage", {
        key: LAST_ACTIVITY_KEY,
        newValue: String(Date.now() - IDLE - 1_000),
      });
      window.dispatchEvent(ev);
    });
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(signOut).toHaveBeenCalled();
  });

  it("cleanup remove timers ao desmontar", async () => {
    const { unmount, signOut } = setup();
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(IDLE + 5_000); });
    expect(signOut).not.toHaveBeenCalled();
  });
});
