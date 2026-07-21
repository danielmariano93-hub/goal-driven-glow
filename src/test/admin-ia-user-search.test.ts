import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

import { supabase } from "@/integrations/supabase/client";
import { resolveUserIdByQuery } from "@/pages/admin/IAInteligencia";

const rpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

describe("IA & Inteligência — busca de usuário", () => {
  beforeEach(() => rpc.mockReset());

  it("usa admin_users_list para buscar por e-mail e retorna o usuário encontrado", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ user_id: "u-1", email: "daniel@example.com", display_name: "Daniel" }],
      error: null,
    });
    const found = await resolveUserIdByQuery("daniel@example.com");
    expect(rpc).toHaveBeenCalledWith("admin_users_list", {
      p_search: "daniel@example.com",
      p_limit: 5,
      p_offset: 0,
    });
    expect(found).toEqual({ userId: "u-1", email: "daniel@example.com", displayName: "Daniel" });
  });

  it("prefere match exato de e-mail sobre o primeiro resultado", async () => {
    rpc.mockResolvedValueOnce({
      data: [
        { user_id: "u-fuzzy", email: "daniela@example.com", display_name: "Daniela" },
        { user_id: "u-exact", email: "daniel@example.com", display_name: "Daniel" },
      ],
      error: null,
    });
    const found = await resolveUserIdByQuery("daniel@example.com");
    expect(found?.userId).toBe("u-exact");
  });

  it("retorna null quando não há usuários", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    const found = await resolveUserIdByQuery("naoexiste@example.com");
    expect(found).toBeNull();
  });

  it("aceita UUID direto sem chamar RPC", async () => {
    const uuid = "11111111-2222-3333-4444-555555555555";
    const found = await resolveUserIdByQuery(uuid);
    expect(rpc).not.toHaveBeenCalled();
    expect(found?.userId).toBe(uuid);
  });

  it("propaga o erro do backend", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    await expect(resolveUserIdByQuery("x@y.com")).rejects.toThrow("boom");
  });
});
