// Worker da rodada sintética: processa uma fatia da fila (`synthetic_jobs`) por chamada. Uma rodada completa dura
// vários minutos, mais do que uma Edge Function aguenta; então cada chamada (a cada minuto, pelo pg_cron) toca algumas
// conversas, grava o resultado e devolve a vez. Duas travas: orçamento de tokens/min e concorrência adaptativa.
// deno-lint-ignore-file no-explicit-any
import { buildPlan, executeConversation, interleave, refDate } from "./plan.mjs";
import { consistency, summarizeRun } from "./score.mjs";
import { createGovernor } from "./governor.mjs";
import { contextFor } from "./plan.mjs";

export type WorkerDeps = {
  newConversation: (sb: any, userId: string) => Promise<any>;
  runTurn: (sb: any, userId: string, conversationId: string, phone: string, text: string) => Promise<any>;
  listTxs: (sb: any, userId: string, since: string) => Promise<any[]>;
  cleanupTxs: (sb: any, userId: string, since: string) => Promise<number>;
  personaUser: (sb: any, persona: string) => Promise<string | null>;
  paraphrase: (body: any) => Promise<{ variants?: string[] }>;
};

const LEASE_MS = 150_000;
const MIN_REMAINING_MS = 45_000; // não começa uma conversa nova com menos tempo que isso

export async function runJobTick(sb: any, deps: WorkerDeps, opts: { budgetMs?: number } = {}) {
  const started = Date.now();
  const budgetMs = opts.budgetMs ?? 100_000;
  const { data: jobs } = await sb.from("synthetic_jobs").select("*").in("status", ["queued", "running"]).order("created_at", { ascending: true }).limit(1);
  const head = jobs?.[0];
  if (!head) return { idle: true };

  const nowIso = new Date().toISOString();
  const { data: job } = await sb.from("synthetic_jobs")
    .update({ lease_until: new Date(Date.now() + LEASE_MS).toISOString(), status: "running", started_at: head.started_at ?? nowIso })
    .eq("id", head.id).or(`lease_until.is.null,lease_until.lt.${nowIso}`).select("*").maybeSingle();
  if (!job) return { busy: true, job_id: head.id };

  const { data: settings } = await sb.from("synthetic_settings").select("tpm,lanes").eq("id", 1).maybeSingle();
  const cfg = job.config ?? {};
  const ref = refDate(cfg.ref);
  const plan = interleave(buildPlan({ personas: cfg.personas ?? [], only: cfg.only ?? [], styles: cfg.styles ?? "rotate", reps: cfg.reps ?? 1 }, ref));
  let cursor = { ...(job.cursor ?? {}) } as any;
  const fail = async (why: string) => {
    await sb.from("synthetic_jobs").update({ status: "failed", error: why.slice(0, 300), lease_until: null, finished_at: new Date().toISOString() }).eq("id", job.id);
    return { failed: why };
  };

  try {
    if (!plan.length) return await fail("nenhuma conversa para rodar com essa configuração");

    // 1) Semeia as contas (uma vez por rodada) e abre o registro da rodada.
    if (!cursor.seeded) {
      for (const id of [...new Set(plan.map((d: any) => d.persona_id))] as string[]) {
        const { error } = await sb.rpc("synthetic_seed", { p_persona: id, p_spec: (contextFor(id, ref) as any).spec });
        if (error) return await fail(`semeadura de ${id}: ${error.message}`);
      }
      const { data: run, error } = await sb.from("synthetic_runs").insert({
        label: job.label ?? "rodada do painel", suite: "synthetic",
        config: { source: job.source, total: plan.length, styles: cfg.styles ?? "rotate", reps: cfg.reps ?? 1, llm: !!cfg.llm },
      }).select("id").single();
      if (error) return await fail(`registro da rodada: ${error.message}`);
      cursor = { seeded: true, index: 0, errors: 0 };
      await sb.from("synthetic_jobs").update({ run_id: run.id, total: plan.length, cursor }).eq("id", job.id);
      job.run_id = run.id;
    }

    // 2) Roda conversas até acabar o orçamento da fatia.
    const users = new Map<string, string>();
    const userOf = async (persona: string) => {
      if (!users.has(persona)) { const u = await deps.personaUser(sb, persona); if (!u) throw new Error(`persona ${persona} não é conta de teste`); users.set(persona, u); }
      return users.get(persona)!;
    };
    const io = {
      newConversation: async (persona: string) => deps.newConversation(sb, await userOf(persona)),
      turn: async (persona: string, conv: any, text: string) => deps.runTurn(sb, await userOf(persona), conv.conversation_id, conv.phone, text),
      txs: async (persona: string, since: string) => deps.listTxs(sb, await userOf(persona), since),
      cleanup: async (persona: string, since: string) => deps.cleanupTxs(sb, await userOf(persona), since),
      paraphrase: cfg.llm ? async (text: string, c: any) => ((await deps.paraphrase({ text, style: String(c.style), count: 1 })).variants ?? [])[0] ?? null : undefined,
    };
    const lanes = Math.max(1, Math.min(4, Number(settings?.lanes ?? 2)));
    const gov = createGovernor({ tokensPerMin: Number(settings?.tpm ?? 120_000), startLimit: lanes, maxLimit: lanes });
    let index = Number(cursor.index ?? 0);
    let cancelled = false;

    while (index < plan.length && Date.now() - started < budgetMs - MIN_REMAINING_MS) {
      const { data: cur } = await sb.from("synthetic_jobs").select("status").eq("id", job.id).maybeSingle();
      if (cur?.status === "cancelled") { cancelled = true; break; }
      const batch = plan.slice(index, index + lanes);
      const results = await Promise.all(batch.map((desc: any) =>
        executeConversation({ desc, ref, io, gov }).catch((e: unknown) => ({ ...desc, verdict: "INFRA", why: String((e as Error)?.message ?? e).slice(0, 100), layers: {}, turns: [], replies: [] }))));
      const rows = results.map((r: any) => ({
        run_id: job.run_id, scenario_id: r.scenario_id, persona_id: r.persona_id, style: r.style, rep: r.rep ?? 1, area: r.area ?? null,
        verdict: r.verdict, layers: r.layers ?? {}, why: r.why ?? null, turns: r.turns ?? [], replies: r.replies ?? [], latency_ms: r.latency_ms ?? null,
      }));
      const { error } = await sb.from("synthetic_results").insert(rows);
      if (error) throw new Error(`gravar resultados: ${error.message}`);
      index += batch.length;
      cursor = { ...cursor, index, errors: 0 };
      await sb.from("synthetic_jobs").update({ done: index, cursor, lease_until: new Date(Date.now() + LEASE_MS).toISOString() }).eq("id", job.id);
      if (results.some((r: any) => r.degraded)) await new Promise((r) => setTimeout(r, 15_000)); // provedor degradado: respira
    }

    // 3) Fecha a rodada.
    if (index >= plan.length) {
      const all: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await sb.from("synthetic_results").select("scenario_id,persona_id,style,rep,area,verdict,layers").eq("run_id", job.run_id).range(from, from + 999);
        all.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      const summary: any = summarizeRun(all);
      summary.consistency = consistency(all);
      await sb.from("synthetic_runs").update({ summary, finished_at: new Date().toISOString() }).eq("id", job.run_id);
      await sb.from("synthetic_jobs").update({ status: "done", done: plan.length, lease_until: null, finished_at: new Date().toISOString() }).eq("id", job.id);
      return { finished: true, run_id: job.run_id, ok_rate: summary.ok_rate, wrong: summary.wrong };
    }
    await sb.from("synthetic_jobs").update({ lease_until: null }).eq("id", job.id);
    return { progressed: true, done: index, total: plan.length, cancelled };
  } catch (e) {
    const errors = Number(cursor.errors ?? 0) + 1;
    const msg = String((e as Error)?.message ?? e).slice(0, 300);
    if (errors >= 3) return await fail(msg);
    await sb.from("synthetic_jobs").update({ cursor: { ...cursor, errors }, error: msg, lease_until: null }).eq("id", job.id);
    return { error: msg, errors };
  }
}
