import { describe, it, expect, vi } from "vitest";
import {
  list_shared_goals,
  get_shared_goal_progress,
  simulate_shared_goal_pace,
  create_shared_goal_draft,
  add_shared_goal_contribution_draft,
  explain_shared_goal_ranking,
} from "../../supabase/functions/_shared/agent/tools";

// Minimal supabase mock builder
function makeSb(handlers: Record<string, any>) {
  const from = (table: string) => {
    const h = handlers[table] ?? {};
    const chain: any = {
      _data: h.data ?? [],
      _single: h.single ?? null,
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: h.single ?? null, error: null }),
      insert: async (row: any) => ({ data: h.insert?.(row) ?? { id: "draft-1" }, error: null }),
      upsert: async (row: any) => ({ data: h.upsert?.(row) ?? { id: "draft-1" }, error: null }),
      then: undefined,
    };
    // when awaited without maybeSingle: return {data,error}
    Object.defineProperty(chain, "then", {
      value: (cb: any) => Promise.resolve({ data: h.data ?? [], error: null }).then(cb),
    });
    return chain;
  };
  return { from, rpc: async () => ({ data: null, error: null }) };
}

const CTX_BASE = { user_id: "u1", conversation_id: "c1", user_text: "" };

describe("list_shared_goals", () => {
  it("retorna lista", async () => {
    const sb = makeSb({ shared_goals: { data: [{ id: "g1", title: "Viagem" }] } });
    const r = await list_shared_goals({ ...CTX_BASE, sb } as any);
    expect(r.ok).toBe(true);
    expect((r as any).result.goals).toHaveLength(1);
  });
});

describe("get_shared_goal_progress", () => {
  it("agrega total, restante e ranking", async () => {
    const sb = makeSb({
      shared_goals: { data: [{ id: "g1", title: "Viagem", target_amount: 1000, deadline: null }] },
      shared_goal_contributions: {
        data: [
          { user_id: "u1", amount: 300, occurred_at: "2026-01-01" },
          { user_id: "u2", amount: 200, occurred_at: "2026-01-02" },
          { user_id: "u1", amount: 100, occurred_at: "2026-01-03" },
        ],
      },
    });
    const r = await get_shared_goal_progress({ ...CTX_BASE, sb } as any, { goal: "Viagem" });
    expect(r.ok).toBe(true);
    const res = (r as any).result;
    expect(res.total_contributed).toBe(600);
    expect(res.remaining).toBe(400);
    expect(res.ranking[0]).toEqual({ user_id: "u1", amount: 400 });
    expect(res.ranking[1]).toEqual({ user_id: "u2", amount: 200 });
  });
});

describe("simulate_shared_goal_pace", () => {
  it("calcula meses restantes e recusa valores inválidos", async () => {
    const sb = makeSb({
      shared_goals: { data: [{ id: "g1", title: "Viagem", target_amount: 1200, deadline: null }] },
      shared_goal_contributions: { data: [{ amount: 400 }] },
    });
    const r = await simulate_shared_goal_pace({ ...CTX_BASE, sb } as any, { goal: "Viagem", monthly_contribution: 200 });
    expect(r.ok).toBe(true);
    expect((r as any).result.months_to_complete).toBe(4);

    const bad = await simulate_shared_goal_pace({ ...CTX_BASE, sb } as any, { goal: "Viagem", monthly_contribution: 0 });
    expect(bad.ok).toBe(false);
  });
});

describe("create_shared_goal_draft", () => {
  it("valida título e valor; devolve draft_id em caso feliz", async () => {
    const sb = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
        insert: () => ({ select: () => ({ single: async () => ({ data: { id: "d1" }, error: null }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
      rpc: async () => ({ data: "d1", error: null }),
    };

    const bad1 = await create_shared_goal_draft({ ...CTX_BASE, sb } as any, { title: "", target_amount: 100 });
    expect(bad1.ok).toBe(false);
    const bad2 = await create_shared_goal_draft({ ...CTX_BASE, sb } as any, { title: "x", target_amount: 0 });
    expect(bad2.ok).toBe(false);
    const ok = await create_shared_goal_draft({ ...CTX_BASE, sb } as any, { title: "Viagem", target_amount: 1000 });
    expect(ok.ok).toBe(true);
    expect((ok as any).result.summary).toContain("Viagem");
  });
});

describe("add_shared_goal_contribution_draft", () => {
  it("recusa quando meta não encontrada", async () => {
    const sb = makeSb({ shared_goals: { data: [] } });
    const r = await add_shared_goal_contribution_draft({ ...CTX_BASE, sb } as any, { goal: "inexistente", amount: 100 });
    expect(r.ok).toBe(false);
    expect((r as any).error).toBe("goal_not_found");
  });
});

describe("explain_shared_goal_ranking", () => {
  it("devolve top 3 quando meta existe", async () => {
    const sb = makeSb({
      shared_goals: { data: [{ id: "g1", title: "Viagem", target_amount: 1000, deadline: null }] },
      shared_goal_contributions: {
        data: [
          { user_id: "a", amount: 300 },
          { user_id: "b", amount: 200 },
          { user_id: "c", amount: 100 },
          { user_id: "d", amount: 50 },
        ],
      },
    });
    const r = await explain_shared_goal_ranking({ ...CTX_BASE, sb } as any, { goal: "Viagem" });
    expect(r.ok).toBe(true);
    expect((r as any).result.top_contributors).toHaveLength(3);
    expect((r as any).result.top_contributors[0].user_id).toBe("a");
  });
});
