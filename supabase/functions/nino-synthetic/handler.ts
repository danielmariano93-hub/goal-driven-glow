// Usuários sintéticos do Nino: ponte entre o runner de testes e o orquestrador REAL, só para contas sandbox.
// Autenticação: JWT de admin da plataforma OU segredo da rodada (`x-synthetic-token`).
// Nada é enviado a ninguém: o canal é `simulator` e todo usuário precisa ser `is_test` + `is_sandbox`.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { runOrchestrator, service } from "../_shared/agent/orchestrator.ts";
import { aiEndpoint, aiJsonHeaders, resolveAiProvider } from "../_shared/ai-runtime.ts";
import { safeEqual } from "../_shared/security/secrets.ts";
import { runJobTick } from "../_shared/synthetic/worker.ts";

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-synthetic-token" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store" } });

export type HandlerOptions = { token?: string };

async function authorized(req: Request, token: string | undefined): Promise<boolean> {
  const header = req.headers.get("x-synthetic-token");
  if (token && header && header === token) return true;
  const cron = req.headers.get("x-cron-secret") ?? req.headers.get("x-internal-secret") ?? "";
  const secret = Deno.env.get("INTERNAL_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";
  if (secret && cron && safeEqual(cron, secret)) return true;
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "", { global: { headers: { Authorization: auth } } });
    const { data: u } = await sb.auth.getUser();
    if (!u.user) return false;
    const { data: isAdmin } = await sb.rpc("is_current_user_admin");
    return isAdmin === true;
  } catch { return false; }
}

/** Usuário da persona; recusa qualquer conta que não seja sandbox de teste. */
async function personaUser(sb: any, persona: string): Promise<string | null> {
  const { data: su } = await sb.from("synthetic_users").select("user_id").eq("persona_id", persona).maybeSingle();
  if (!su?.user_id) return null;
  const { data: p } = await sb.from("profiles").select("is_test,is_sandbox").eq("id", su.user_id).maybeSingle();
  return p?.is_test === true && p?.is_sandbox === true ? su.user_id : null;
}

async function paraphrase(body: any) {
  const cfg = resolveAiProvider();
  if (!cfg) return { variants: [], note: "sem provedor de IA configurado" };
  const n = Math.max(1, Math.min(5, Number(body.count ?? 3)));
  const prompt = `Você simula pessoas reais que falam com um assistente financeiro no WhatsApp, em português do Brasil.\n` +
    `Reescreva a pergunta abaixo de ${n} jeitos diferentes, como pessoas diferentes escreveriam: ${String(body.style ?? "natural")}.\n` +
    `Regras: mantenha EXATAMENTE os mesmos números, valores e meses; mantenha o MESMO pedido e a mesma métrica (se perguntou quanto GASTOU, não vire "valor"; se perguntou quanto RECEBEU ou quanto SOBROU, mantenha); NÃO acrescente categorias, estabelecimentos nem fatos novos; só varie o tom e as palavras; não responda a pergunta; não explique.\n` +
    `Responda só com um array JSON de ${n} strings.\nPergunta: ${JSON.stringify(String(body.text ?? "").slice(0, 300))}`;
  const res = await fetch(aiEndpoint(cfg, "/chat/completions"), {
    method: "POST", headers: aiJsonHeaders(cfg),
    body: JSON.stringify({ model: cfg.modelOverride, temperature: 0.9, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) return { variants: [], note: `provedor ${res.status}` };
  const j = await res.json();
  const text = String(j?.choices?.[0]?.message?.content ?? "");
  try {
    const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
    return { variants: arr.filter((x: unknown) => typeof x === "string").slice(0, n) };
  } catch { return { variants: [], note: "resposta fora do formato" }; }
}

export async function newConversation(sb: any, userId: string) {
  // Cada cenário começa do zero: a sessão (memória de período, categoria, última análise) é por usuário e canal e
  // sobrevivia ao cenário anterior ("o lançamento que você corrigiu foi R$ 45" aparecendo em "quanto foi?").
  // Só roda para contas sandbox: `userId` vem de `personaUser`, que confere is_test e is_sandbox.
  await sb.from("agent_sessions").delete().eq("user_id", userId);
  for (let i = 0; i < 25; i++) {
    const phone = `+55119999${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
    const { data, error } = await sb.from("conversations").insert({ user_id: userId, source: "whatsapp", phone_e164: phone, last_message_at: new Date().toISOString() }).select("id").single();
    if (!error) return { conversation_id: data.id, phone, since: new Date().toISOString() };
    if (error.code !== "23505") return { error: `conversation_failed:${error.code}` };
  }
  return { error: "phone_exhausted" };
}

export async function runTurn(sb: any, userId: string, conversationId: string, phone: string, rawText: string) {
  const text = String(rawText ?? "").slice(0, 2000);
  if (!conversationId || !phone || !text) return { error: "turn_invalid", status: 400 };
  const inboundId = crypto.randomUUID();
  const { error: ie } = await sb.from("inbound_messages").insert({
    id: inboundId, provider: "waha", provider_message_id: `syn-${Date.now()}-${inboundId}`, from_phone: phone, to_phone: "+5500000000000",
    body: text, received_at: new Date().toISOString(), has_media: false, logical_dedup_key: `syn:${conversationId}:${inboundId}`,
  });
  if (ie) return { error: `inbound_failed:${ie.code ?? "unknown"}`, status: 500 };
  await sb.from("conversation_messages").insert({ conversation_id: conversationId, user_id: userId, direction: "inbound", body_masked: text.slice(0, 500) });
  const started = Date.now();
  try {
    const result = await runOrchestrator({ user_id: userId, conversation_id: conversationId, inbound_message_id: inboundId, text, source: "simulator", to_phone: phone });
    let run: any = null;
    if (result.run_id) {
      const { data } = await sb.from("agent_runs").select("model,provider,path,status,llm_calls,tokens_in,tokens_out,error_sanitized").eq("id", result.run_id).maybeSingle();
      run = data;
    }
    return { reply: result.reply, reply_kind: result.reply_kind, path: result.path, run_id: result.run_id, latency_ms: Date.now() - started, run };
  } catch (error) {
    return { error: String((error as Error)?.message ?? error).slice(0, 300), status: 500 };
  }
}

export async function listTxs(sb: any, userId: string, since: string) {
  const { data } = await sb.from("transactions").select("amount,type,occurred_at,description,status,categories(name)").eq("user_id", userId).gte("created_at", since);
  return (data ?? []).map((t: any) => ({ amount: Number(t.amount), type: t.type, occurred_at: t.occurred_at, description: t.description, status: t.status, category: t.categories?.name ?? null }));
}

export async function cleanupTxs(sb: any, userId: string, since: string) {
  const { data } = await sb.from("transactions").delete().eq("user_id", userId).gte("created_at", since).select("id");
  await sb.from("pending_confirmations").delete().eq("user_id", userId);
  return data?.length ?? 0;
}

export { personaUser, paraphrase };

export async function handle(req: Request, opts: HandlerOptions = {}): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = opts.token ?? Deno.env.get("SYNTHETIC_TOKEN") ?? undefined;
  if (!(await authorized(req, token))) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({}));
  const sb: any = service();
  const action = String(body.action ?? "");

  if (action === "paraphrase") return json(await paraphrase(body));

  if (action === "seed") {
    const { data, error } = await sb.rpc("synthetic_seed", { p_persona: String(body.persona ?? ""), p_spec: body.spec ?? {} });
    return error ? json({ error: String(error.message).slice(0, 200) }, 500) : json(data);
  }

  if (action === "run_start") {
    const { data, error } = await sb.from("synthetic_runs").insert({ label: String(body.label ?? "rodada").slice(0, 80), suite: body.suite === "golden" ? "golden" : "synthetic", git_sha: body.git_sha ?? null, config: body.config ?? {} }).select("id").single();
    return error ? json({ error: error.message }, 500) : json({ run_id: data.id });
  }
  if (action === "run_results") {
    const rows = (Array.isArray(body.results) ? body.results : []).slice(0, 200).map((r: any) => ({
      run_id: body.run_id, scenario_id: String(r.scenario_id ?? r.id), persona_id: r.persona_id ?? null, style: r.style ?? null, rep: r.rep ?? 1,
      area: r.area ?? null, verdict: r.verdict, layers: r.layers ?? {}, why: r.why ?? null, turns: r.turns ?? [], replies: r.replies ?? [], latency_ms: r.latency_ms ?? null,
    }));
    const { error } = await sb.from("synthetic_results").insert(rows);
    return error ? json({ error: error.message }, 500) : json({ inserted: rows.length });
  }
  if (action === "run_delete") {
    const { error } = await sb.from("synthetic_runs").delete().eq("id", String(body.run_id ?? ""));
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }
  if (action === "run_finish") {
    const { error } = await sb.from("synthetic_runs").update({ summary: body.summary ?? {}, finished_at: new Date().toISOString() }).eq("id", body.run_id);
    return error ? json({ error: error.message }, 500) : json({ ok: true });
  }

  if (action === "tick") {
    // A rotina agendada não espera a resposta: a fatia roda em segundo plano (`wait: true` aguarda, para teste).
    const work = runJobTick(sb, { newConversation, runTurn, listTxs, cleanupTxs, personaUser, paraphrase }, { budgetMs: Number(body.budget_ms ?? 100_000) });
    if (body.wait === true) return json(await work);
    (globalThis as any).EdgeRuntime?.waitUntil?.(work.catch(() => undefined));
    return json({ accepted: true });
  }

  // Ações por persona
  const persona = String(body.persona ?? "");
  const userId = await personaUser(sb, persona);
  if (!userId) return json({ error: "persona_not_sandbox" }, 404);

  if (action === "new") {
    const r: any = await newConversation(sb, userId);
    return r.error ? json(r, 500) : json(r);
  }
  if (action === "txs") return json({ txs: await listTxs(sb, userId, String(body.since)) });
  if (action === "cleanup") return json({ deleted: await cleanupTxs(sb, userId, String(body.since)) });
  if (action === "turn") {
    const r: any = await runTurn(sb, userId, String(body.conversation_id ?? ""), String(body.phone ?? ""), String(body.text ?? ""));
    return json(r, r.status ?? 200);
  }
  return json({ error: "action_invalid" }, 400);
}
