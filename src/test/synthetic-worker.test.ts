import { describe, expect, it } from "vitest";
import { runJobTick } from "../../supabase/functions/_shared/synthetic/worker";
import { buildPlan, interleave, preservesFacts, refDate } from "../../supabase/functions/_shared/synthetic/plan.mjs";

// Banco em memória, só com o que o worker usa.
function fakeDb(seed: Record<string, any[]>) {
  const t: Record<string, any[]> = { synthetic_jobs: [], synthetic_runs: [], synthetic_results: [], synthetic_settings: [{ id: 1, tpm: 120000, lanes: 2 }], ...seed };
  let n = 0;
  const builder = (table: string) => {
    const q: any = { filters: [] as Array<(r: any) => boolean>, patch: null, rows: null, single: false, maybe: false, sel: false, lim: null, rng: null };
    const run = () => {
      let rows = t[table] ?? (t[table] = []);
      if (q.rows) { const added = q.rows.map((r: any) => ({ id: `id${++n}`, ...r })); rows.push(...added); return q.sel ? added : added; }
      let hit = rows.filter((r) => q.filters.every((f: any) => f(r)));
      if (q.patch) { hit.forEach((r) => Object.assign(r, q.patch)); return q.sel ? hit : hit; }
      if (q.lim != null) hit = hit.slice(0, q.lim);
      if (q.rng) hit = hit.slice(q.rng[0], q.rng[1] + 1);
      return hit;
    };
    const api: any = {
      select: () => { q.sel = true; return api; },
      update: (p: any) => { q.patch = p; return api; },
      insert: (r: any) => { q.rows = Array.isArray(r) ? r : [r]; return api; },
      eq: (c: string, v: any) => { q.filters.push((r: any) => r[c] === v); return api; },
      in: (c: string, vs: any[]) => { q.filters.push((r: any) => vs.includes(r[c])); return api; },
      or: (s: string) => { const now = s.split("lease_until.lt.")[1]; q.filters.push((r: any) => r.lease_until == null || r.lease_until < now); return api; },
      order: () => api, limit: (k: number) => { q.lim = k; return api; }, range: (a: number, b: number) => { q.rng = [a, b]; return api; },
      maybeSingle: () => { q.maybe = true; return api; }, single: () => { q.single = true; return api; },
      then: (res: any, rej: any) => Promise.resolve().then(() => {
        const out = run();
        const data = q.single || q.maybe ? (out[0] ?? null) : out;
        return { data, error: null };
      }).then(res, rej),
    };
    return api;
  };
  const rpcCalls: any[] = [];
  return { t, rpcCalls, from: builder, rpc: async (name: string, args: any) => { rpcCalls.push({ name, args }); return { data: { ok: true }, error: null }; } };
}

const deps = (replyFor = (text: string) => "Oi! Posso ajudar com suas finanças.") => ({
  newConversation: async () => ({ conversation_id: "c1", phone: "+551199990000", since: new Date().toISOString() }),
  runTurn: async (_sb: any, _u: string, _c: string, _p: string, text: string) => ({ reply: replyFor(text), run: { tokens_in: 100, tokens_out: 20, model: "v3-primary" } }),
  listTxs: async () => [],
  cleanupTxs: async () => 0,
  personaUser: async () => "user-1",
  paraphrase: async () => ({ variants: [] }),
});
const job = (over: any = {}) => ({ id: "j1", status: "queued", source: "manual", label: "teste", config: { personas: ["conta_vazia"], only: ["C01"], styles: "neutro", reps: 1, ref: "2026-11-06" }, cursor: {}, lease_until: null, started_at: null, ...over });

describe("worker da fila de rodadas sintéticas", () => {
  it("sem rodada ativa não faz nada", async () => {
    expect(await runJobTick(fakeDb({}) as any, deps() as any)).toEqual({ idle: true });
  });
  it("semeia, conversa, grava o resultado e fecha a rodada com resumo", async () => {
    const db = fakeDb({ synthetic_jobs: [job()] });
    const out: any = await runJobTick(db as any, deps() as any, { budgetMs: 100_000 });
    expect(out.finished).toBe(true);
    expect(db.rpcCalls.map((c) => c.name)).toEqual(["synthetic_seed"]);
    expect(db.t.synthetic_results).toHaveLength(1);
    expect(db.t.synthetic_results[0].verdict).toBe("CORRECT");
    expect(db.t.synthetic_jobs[0]).toMatchObject({ status: "done", done: 1, lease_until: null });
    expect(db.t.synthetic_runs[0].summary.total).toBe(1);
  });
  it("não pega uma rodada que outra chamada já está tocando", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const db = fakeDb({ synthetic_jobs: [job({ status: "running", lease_until: future })] });
    expect(await runJobTick(db as any, deps() as any)).toMatchObject({ busy: true });
    expect(db.t.synthetic_results).toHaveLength(0);
  });
  it("rodada cancelada para antes de tocar a próxima conversa", async () => {
    const db = fakeDb({ synthetic_jobs: [job({ status: "queued", config: { personas: ["conta_vazia"], only: ["C01", "C02", "C03"], styles: "neutro", reps: 1, ref: "2026-11-06" } })] });
    const d: any = deps();
    const orig = d.runTurn;
    d.runTurn = async (...a: any[]) => { db.t.synthetic_jobs[0].status = "cancelled"; return orig(...a); };
    const out: any = await runJobTick(db as any, d, { budgetMs: 100_000 });
    expect(out.finished).toBeUndefined();
    expect(db.t.synthetic_jobs[0].status).toBe("cancelled");
  });
  it("plano vazio falha com mensagem clara", async () => {
    const db = fakeDb({ synthetic_jobs: [job({ config: { personas: ["inexistente"], only: [], styles: "rotate", reps: 1, ref: "2026-11-06" } })] });
    expect(await runJobTick(db as any, deps() as any)).toMatchObject({ failed: expect.stringContaining("nenhuma conversa") });
    expect(db.t.synthetic_jobs[0].status).toBe("failed");
  });
});

describe("plano da rodada", () => {
  it("intercala personas: conversas vizinhas são de contas diferentes", () => {
    const plan = interleave(buildPlan({}, refDate("2026-11-06")));
    for (let i = 1; i < 12; i++) expect(plan[i].persona_id).not.toBe(plan[i - 1].persona_id);
  });
  it("variação por IA só vale se preservar números e meses", () => {
    expect(preservesFacts("quanto gastei em setembro?", "me diz o gasto de setembro")).toBe(true);
    expect(preservesFacts("quanto gastei em setembro?", "me diz o gasto de outubro")).toBe(false);
    expect(preservesFacts("gastei 35 no mercado", "gastei 53 no mercado")).toBe(false);
  });
});

describe("migração da fila", () => {
  it("só admin enfileira e a rotina fica a cada minuto", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261106210000_synthetic_fila.sql", "utf8");
    for (const fn of ["admin_synthetic_state", "admin_synthetic_enqueue", "admin_synthetic_cancel", "admin_synthetic_settings_save"]) expect(sql).toMatch(new RegExp(`function public\\.${fn}[\\s\\S]*?is_current_user_admin\\(\\)`));
    expect(sql).toContain("'* * * * *'");
    expect(sql).toMatch(/revoke all on function public\.synthetic_tick\(\)/);
    expect(readFileSync("supabase/config.toml", "utf8")).toMatch(/\[functions\.nino-synthetic\]\s+verify_jwt = false/);
  });
});
