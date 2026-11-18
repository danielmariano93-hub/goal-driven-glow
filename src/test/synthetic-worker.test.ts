import { describe, expect, it } from "vitest";
import { runJobTick } from "../../supabase/functions/_shared/synthetic/worker";
import { buildPlan, interleave, preservesFacts, refDate, samplePlan, seededRandom } from "../../supabase/functions/_shared/synthetic/plan.mjs";
import { buildFailureReport, buildWeeklyReport, groupFailures } from "../../supabase/functions/_shared/synthetic/report.mjs";
import { scheduleSentence } from "@/lib/admin/qualidade";

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

describe("rodada semanal sorteada", () => {
  const full = () => buildPlan({ styles: "all" }, refDate("2026-11-22"));
  it("o sorteio é determinístico pela semente e muda quando a semente muda", () => {
    expect(seededRandom(7)()).toBe(seededRandom(7)());
    const a = samplePlan(full(), { sample: 50, seed: 11 });
    const b = samplePlan(full(), { sample: 50, seed: 11 });
    const c = samplePlan(full(), { sample: 50, seed: 12 });
    expect(a).toHaveLength(50);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
  it("só sorteia conversas que existem no plano completo, sem repetir", () => {
    const all = full();
    const key = (d: any) => `${d.persona_id}|${d.scenario_id}|${d.style}|${d.rep}`;
    const keys = new Set(all.map(key));
    const picked = samplePlan(all, { sample: 120, seed: 3 });
    expect(picked.every((d: any) => keys.has(key(d)))).toBe(true);
    expect(new Set(picked.map(key)).size).toBe(120);
    expect(all.length).toBeGreaterThan(500);
  });
  it("sorteio maior que o plano devolve o plano inteiro", () => {
    expect(samplePlan([{ a: 1 }, { a: 2 }], { sample: 50, seed: 1 })).toHaveLength(2);
  });

  const cfg = (over: any = {}) => ({ personas: ["conta_vazia"], only: [], styles: "all", reps: 1, ref: "2026-11-22", random: true, sample: 4, seed: 99, report: true, ...over });
  const owner = () => ({ ops_alert_settings: [{ id: 1, whatsapp_to: "+5511999990000" }], outbound_messages: [] as any[] });

  it("roda só a quantidade sorteada e manda o relatório ao WhatsApp do dono", async () => {
    const db = fakeDb({ synthetic_jobs: [job({ source: "schedule", label: "Rodada semanal", config: cfg() })], ...owner() });
    const out: any = await runJobTick(db as any, deps() as any, { budgetMs: 100_000 });
    expect(out.finished).toBe(true);
    expect(db.t.synthetic_results).toHaveLength(4);
    expect(db.t.outbound_messages).toHaveLength(1);
    expect(db.t.outbound_messages[0]).toMatchObject({ to_phone: "+5511999990000", kind: "system" });
    expect(db.t.outbound_messages[0].body).toContain("Relatório dos testes do Nino");
    expect(db.t.synthetic_runs[0].summary.report_sent).toBe(true);
  });
  it("sem o pedido de relatório não manda nada", async () => {
    const db = fakeDb({ synthetic_jobs: [job({ config: cfg({ report: false }) })], ...owner() });
    await runJobTick(db as any, deps() as any, { budgetMs: 100_000 });
    expect(db.t.outbound_messages).toHaveLength(0);
  });
  it("sem telefone do dono configurado a rodada fecha normalmente, só não envia", async () => {
    const db = fakeDb({ synthetic_jobs: [job({ config: cfg() })], ops_alert_settings: [{ id: 1, whatsapp_to: null }], outbound_messages: [] });
    const out: any = await runJobTick(db as any, deps() as any, { budgetMs: 100_000 });
    expect(out.finished).toBe(true);
    expect(db.t.outbound_messages).toHaveLength(0);
    expect(db.t.synthetic_runs[0].summary.report_sent).toBe(false);
  });
  it("o limite de custo para a rodada cedo e o relatório avisa", async () => {
    const db = fakeDb({ synthetic_jobs: [job({ config: cfg({ sample: 10, token_cap: 100 }) })], ...owner() });
    const out: any = await runJobTick(db as any, deps() as any, { budgetMs: 100_000 });
    expect(out).toMatchObject({ finished: true, capped: true });
    expect(db.t.synthetic_results.length).toBeLessThan(10);
    expect(db.t.synthetic_runs[0].summary).toMatchObject({ capped: true, planned: 10 });
    expect(db.t.outbound_messages[0].body).toContain("limite de custo");
  });
  it("rodada que falha também avisa o dono", async () => {
    const db = fakeDb({ synthetic_jobs: [job({ config: cfg({ personas: ["inexistente"] }) })], ...owner() });
    await runJobTick(db as any, deps() as any);
    expect(db.t.outbound_messages[0].body).toContain("não terminou");
  });
});

describe("relatório da rodada", () => {
  const ok = { total: 120, ok: 120, ok_rate: 1, wrong: 0, infra: 0, by: { CORRECT: 120 } };
  const wrongRow = (id: string, why: string, q: string, style = "informal") => ({ scenario_id: id, area: "incidental", verdict: "WRONG", why, turns: [q], style });
  it("sem erros diz que não houve e que não há o que corrigir", () => {
    const t = buildWeeklyReport({ summary: ok, results: [], dateLabel: "22/11", runId: "abcdef12-0000" });
    expect(t).toContain("Nenhuma resposta errada");
    expect(t).toContain("100% das conversas");
    expect(t).toContain("Nada para corrigir");
  });
  it("com erros agrupa por cenário, cita exemplo e diz o que pedir", () => {
    const results = [
      wrongRow("Q17", "valor diferente do gabarito", "quanto gastei com mercado em outubro? tô gastando mais que ganho todo mês"),
      wrongRow("Q17", "valor diferente do gabarito", "quanto gastei com mercado em outubro? tô gastando mais que ganho todo mês", "telegrafico"),
      wrongRow("H03", "mês errado", "e no mês seguinte?"),
    ];
    const summary = { total: 120, ok: 117, ok_rate: 0.975, wrong: 3, infra: 0, by: { CORRECT: 117, WRONG: 3 } };
    expect(groupFailures(results).map((g: any) => [g.id, g.n])).toEqual([["Q17", 2], ["H03", 1]]);
    const t = buildWeeklyReport({ summary, results, previous: { ok_rate: 0.92, wrong: 7 }, dateLabel: "22/11", runId: "abcdef12-0000" });
    expect(t).toContain("3 respostas erradas de 120");
    expect(t).toContain("• Q17 (incidental), 2x: valor diferente do gabarito");
    expect(t).toContain("ex.: “quanto gastei com mercado em outubro?");
    expect(t).toContain("Rodada anterior: 92% certas, 7 erradas. Agora melhorou 5,5 ponto(s).");
    expect(t).toContain('me peça: "corrigir Q17, H03"');
    expect(t).toContain("rodada abcdef12");
  });
  it("não passa do tamanho de uma mensagem de WhatsApp mesmo com muitos erros", () => {
    const results = Array.from({ length: 40 }, (_, i) => wrongRow(`X${String(i).padStart(2, "0")}`, "motivo bem comprido ".repeat(10), "pergunta de exemplo ".repeat(10)));
    const t = buildWeeklyReport({ summary: { total: 120, ok: 80, ok_rate: 0.66, wrong: 40, infra: 0, by: {} }, results });
    expect(t.length).toBeLessThanOrEqual(1500);
    expect(t).toContain("e mais 35 cenários");
  });
  it("conta o que não é erro grave e falha interna à parte", () => {
    const t = buildWeeklyReport({ summary: { total: 50, ok: 44, ok_rate: 0.88, wrong: 0, infra: 2, by: { MISS: 4 } }, results: [] });
    expect(t).toContain("4 conversas sem registrar o lançamento ou com categoria diferente");
    expect(t).toContain("2 falhas internas");
  });
  it("mensagem de rodada que falhou", () => {
    expect(buildFailureReport({ dateLabel: "22/11", why: "semeadura de poupador: timeout" })).toContain("A rodada semanal não terminou.");
  });
});

describe("agenda semanal no painel e no banco", () => {
  it("a frase diz dia, hora e quantas conversas", () => {
    const base = { enabled: true, every_hours: 24, last_enqueued_at: null, schedule_kind: "weekly" as const, schedule_dow: 0, schedule_hour: 3, sample_size: 120 };
    expect(scheduleSentence(base)).toBe("Toda domingo às 3h (horário de Brasília), sorteando 120 conversas. Ainda não rodou.");
    expect(scheduleSentence({ ...base, enabled: false })).toBe("Rodada automática desligada.");
    expect(scheduleSentence({ ...base, schedule_kind: "interval", every_hours: 168 })).toContain("A cada 7 dias");
  });
  it("a migração semanal: padrão domingo 3h, só admin salva, ligar adia para a próxima janela", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261124100000_sinteticos_semanal_relatorio.sql", "utf8");
    expect(sql).toMatch(/schedule_dow int not null default 0/);
    expect(sql).toMatch(/schedule_hour int not null default 3/);
    expect(sql).toMatch(/function public\.admin_synthetic_settings_save[\s\S]*?is_current_user_admin\(\)/);
    expect(sql).toContain("drop function if exists public.admin_synthetic_settings_save(boolean, integer, integer, integer)");
    expect(sql).toMatch(/last_enqueued_at = case when coalesce\(_enabled, enabled\) and not enabled then now\(\)/);
    expect(sql).toMatch(/revoke all on function public\.synthetic_tick\(\)/);
    expect(sql).toContain("'random', true");
  });
});
