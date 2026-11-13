/* eslint-disable @typescript-eslint/no-explicit-any */
// Edge Function: habits-ai (Hábitos F6). Duas ações, ambas com a pessoa autenticada:
//  - suggest_plan { title }  -> { cue_text, minimum_text } (nunca para hábito de saúde/substância)
//  - narrate_week {}         -> { text, source: "ai" | "template" } (números vêm do banco; a IA só escreve o texto)
//  - summarize_book { project_id } -> { bullets, source: "ai" | "template" } (organiza SÓ as anotações da pessoa; não grava nada)
// Limites: precisa de Hábitos liberado; teto mensal de custo por pessoa; guarda de números; sem linguagem clínica; reserva em texto fixo.
// Nenhuma ação escreve em tabelas de Hábitos.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { resolveAiProvider } from "../_shared/ai-runtime.ts";
import { callStructuredFunction } from "../_shared/ai-structured.ts";
import { estimateAiCostUsd, recordAiUsage } from "../_shared/aiUsageLedger.ts";
import { weeklyReview, mergeAutoLogs, type HabitDef, type LogRow, type PauseRange } from "../_shared/habits-core/index.ts";
import {
  AI_MONTHLY_CAP_USD, BOOK_SYSTEM, BOOK_TOOL, NARRATIVE_SYSTEM, NARRATIVE_TOOL, PLAN_SYSTEM, PLAN_TOOL, bookUser, factNumbers, fallbackBook, fallbackNarrative,
  guardBook, guardNarrative, narrativeUser, planRefused, sanitizePlan, type BookNote, type ReviewFacts,
} from "../_shared/habits/ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = (Deno.env.get("NINO_HABITS_MODEL") ?? Deno.env.get("NINO_AI_MODEL") ?? "openai/gpt-oss-120b").trim();
const FN = "habits-ai";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function monthSpentUsd(sb: any, userId: string): Promise<number> {
  const from = new Date(); from.setUTCDate(1); from.setUTCHours(0, 0, 0, 0);
  const { data } = await sb.from("ai_usage_ledger").select("estimated_cost_usd").eq("user_id", userId).eq("function_name", FN).gte("created_at", from.toISOString()).limit(2000);
  return ((data as Array<{ estimated_cost_usd: number | null }> | null) ?? []).reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0);
}

async function callModel(sb: any, userId: string, operation: string, system: string, user: string, tool: any): Promise<any | null> {
  const provider = resolveAiProvider();
  if (!provider) return null;
  const started = Date.now();
  const call = await callStructuredFunction({ provider, model: MODEL, tool, system, user, temperature: 0.3, reasoning_effort: "low", max_attempts: 2 });
  await recordAiUsage(sb, {
    workload: "OTHER_AI", function_name: FN, operation, user_id: userId, model: MODEL, provider: provider.provider,
    input_tokens: call.input_tokens, output_tokens: call.output_tokens, estimated_cost_usd: estimateAiCostUsd(MODEL, call.input_tokens, call.output_tokens),
    success: call.ok, http_status: call.status, error_code: call.error_code, latency_ms: Date.now() - started, reason_for_ai_call: operation,
  });
  if (!call.ok) return null;
  try { return JSON.parse(call.arguments || "{}"); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ ok: false, error: "unauthorized" }, 401);
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const sbUser = createClient(SUPABASE_URL, SERVICE_ROLE, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await sbUser.auth.getUser();
  const userId = u?.user?.id;
  if (!userId) return json({ ok: false, error: "unauthorized" }, 401);

  let body: { action?: unknown; title?: unknown; project_id?: unknown } = {};
  try { body = await req.json(); } catch { /* validação abaixo */ }

  // Só quem tem Hábitos liberado (mesmo portão do restante).
  const { data: snapData, error: snapErr } = await sb.rpc("hb_snapshot_as", { p_user: userId, p_days: 28 });
  if (snapErr || !snapData) return json({ ok: false, error: "not_enabled" }, 403);

  if (body.action === "suggest_plan") {
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 80) : "";
    if (title.length < 2) return json({ ok: false, error: "invalid_title" }, 400);
    if (planRefused(title)) return json({ ok: true, source: "none", reason: "sensitive_no_ai", plan: { cue_text: null, minimum_text: null } });
    if (await monthSpentUsd(sb, userId) >= AI_MONTHLY_CAP_USD) return json({ ok: true, source: "none", reason: "monthly_cap", plan: { cue_text: null, minimum_text: null } });
    const out = await callModel(sb, userId, "suggest_plan", PLAN_SYSTEM, JSON.stringify({ habito: title }), PLAN_TOOL);
    if (!out) return json({ ok: true, source: "none", reason: "ai_unavailable", plan: { cue_text: null, minimum_text: null } });
    return json({ ok: true, source: "ai", plan: sanitizePlan(out, title) });
  }

  if (body.action === "narrate_week") {
    const snap = snapData as any;
    const normalHabits = (snap.habits as any[]).filter((h) => h.kind === "do_daily" && (h.sensitivity ?? "normal") === "normal" && (h.status ?? "active") === "active");
    const logs = mergeAutoLogs((snap.logs as LogRow[]) ?? [], (snap.auto_logs as LogRow[]) ?? []);
    const pausesOf = (id: string): PauseRange[] => ((snap.pauses as any[]) ?? []).filter((p) => p.habit_id === id).map((p) => ({ from: p.from, to: p.to }));
    const defs = normalHabits.map((h) => ({ def: { id: h.id, kind: h.kind, started_on: h.started_on, days_of_week: h.days_of_week, weekly_target: h.weekly_target, quantity_target: h.quantity_target, quantity_period: h.quantity_period, rest_per_week: h.rest_per_week } as HabitDef, pauses: pausesOf(h.id) }));
    const rows = weeklyReview(defs, logs, snap.today);
    const titleOf = (id: string) => normalHabits.find((h) => h.id === id)?.title ?? "Hábito";
    const facts: ReviewFacts = { rows: rows.map((r) => ({ ...r, title: titleOf(r.habit_id) })) };
    if (facts.rows.length === 0) return json({ ok: true, source: "none", reason: "no_data", text: "" });
    const template = fallbackNarrative(facts);
    if (await monthSpentUsd(sb, userId) >= AI_MONTHLY_CAP_USD) return json({ ok: true, source: "template", reason: "monthly_cap", text: template });
    const out = await callModel(sb, userId, "narrate_week", NARRATIVE_SYSTEM, narrativeUser(facts), NARRATIVE_TOOL);
    const text = typeof out?.text === "string" ? out.text.trim() : "";
    const verdict = guardNarrative(text, factNumbers(facts));
    if (!verdict.ok) {
      if (out) console.warn("[habits-ai] guard_rejected", verdict.reason);
      return json({ ok: true, source: "template", reason: out ? `guard:${verdict.reason}` : "ai_unavailable", text: template });
    }
    return json({ ok: true, source: "ai", text });
  }

  if (body.action === "summarize_book") {
    const pid = typeof body.project_id === "string" ? body.project_id : "";
    if (!/^[0-9a-f-]{36}$/i.test(pid)) return json({ ok: false, error: "invalid_project" }, 400);
    const { data: pr } = await sb.from("hb_projects").select("id,title").eq("id", pid).eq("user_id", userId).maybeSingle();
    if (!pr) return json({ ok: false, error: "not_found" }, 404);
    const { data: rows } = await sb.from("hb_project_notes").select("body,page").eq("project_id", pid).eq("user_id", userId).order("created_at", { ascending: true }).limit(300);
    let budget = 30000; // teto de texto enviado ao modelo: livros com muitas anotações longas não estouram o custo
    const notes = ((rows as BookNote[] | null) ?? []).filter((n) => typeof n.body === "string" && n.body.trim().length > 0).filter((n) => (budget -= n.body.length) >= 0);
    if (notes.length === 0) return json({ ok: true, source: "none", reason: "no_notes", bullets: [] });
    const template = fallbackBook(notes);
    if (await monthSpentUsd(sb, userId) >= AI_MONTHLY_CAP_USD) return json({ ok: true, source: "template", reason: "monthly_cap", bullets: template });
    const out = await callModel(sb, userId, "summarize_book", BOOK_SYSTEM, bookUser(String((pr as any).title ?? ""), notes), BOOK_TOOL);
    const verdict = guardBook(out?.bullets, notes);
    if (!verdict.ok) {
      if (out) console.warn("[habits-ai] book_guard_rejected", verdict.reason);
      return json({ ok: true, source: "template", reason: out ? `guard:${verdict.reason}` : "ai_unavailable", bullets: template });
    }
    return json({ ok: true, source: "ai", bullets: verdict.bullets });
  }
  return json({ ok: false, error: "unknown_action" }, 400);
});

