// Edge Function: mapa-eval — avaliação OFFLINE da camada de IA do Mapa com o MODELO REAL (spec seção 8).
//
// Roda os cenários de avaliação (`_shared/mapa/evalScenarios.ts`, montados pelos motores reais) pelo mesmo caminho do app
// (pacote de evidência → prompt → modelo → esquema → guarda) e mede: fidelidade, taxa de fallback, violações por tipo, latência,
// e um juiz (mesmo provedor, outro papel) que confere se o texto só afirma o que os fatos sustentam.
// Rodar ANTES de mudar prompt ou modelo. Não grava nada, não usa dados de usuário e não entra na telemetria de produção.
// Acesso: somente com `x-cron-secret`. Corpo opcional: { offset, limit, judge (padrão true), texts (padrão true) }.
// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import { matchesAnySecret } from "../_shared/security/secrets.ts";
import { buildMapaEvidencePack } from "../_shared/finance-core/mapaEvidencePack.ts";
import { evalScenarios } from "../_shared/mapa/evalScenarios.ts";
import { buildJudgePrompt, composeMapaNarrative, parseJudge, providerComplete, type JudgeVerdict } from "../_shared/mapa/narrative.ts";

const CRON_SECRETS = [Deno.env.get("INTERNAL_CRON_SECRET") ?? "", Deno.env.get("CRON_SECRET") ?? ""].filter(Boolean);
const CONCURRENCY = 4;
const TIME_BUDGET_MS = 110_000;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const secret = req.headers.get("x-cron-secret") ?? "";
  if (!secret || !matchesAnySecret(secret, CRON_SECRETS)) return json({ ok: false, error: "unauthorized" }, 401);

  let body: { offset?: number; limit?: number; judge?: boolean; texts?: boolean } = {};
  try { body = await req.json(); } catch { /* padrão */ }
  const complete = providerComplete(null, null, { record: false });
  if (!complete) return json({ ok: false, error: "ai_not_configured" }, 503);
  const judge = providerComplete(null, null, { record: false, operation: "mapa_eval_judge", maxTokens: 1000 })!;

  const all = evalScenarios();
  const offset = Math.max(0, Number(body.offset ?? 0) || 0);
  const limit = Math.min(all.length, Math.max(1, Number(body.limit ?? all.length) || all.length));
  const slice = all.slice(offset, offset + limit);
  const started = Date.now();
  const rows: any[] = [];
  let next = 0;
  const worker = async () => {
    while (next < slice.length && Date.now() - started < TIME_BUDGET_MS) {
      const idx = next++;
      const sc = slice[idx];
      const pack = buildMapaEvidencePack(sc.reading);
      const t0 = Date.now();
      const r = await composeMapaNarrative(pack, complete);
      let verdict: JudgeVerdict | null = null;
      if (body.judge !== false && r.narrative.source === "llm") {
        try { verdict = parseJudge((await judge(buildJudgePrompt(pack, r.narrative))).text); } catch { verdict = null; }
      }
      rows.push({
        i: offset + idx, name: sc.name, mode: pack.mode, action: pack.recommendation?.action ?? null, source: r.narrative.source,
        fallback_reason: r.narrative.fallback_reason, violations: r.guard?.violations ?? [], latency_ms: r.latency_ms ?? Date.now() - t0,
        judge: verdict,
        // diagnóstico: o que o modelo respondeu quando foi reprovado e por quê (só nas reprovações)
        ...(r.raw ? { rejected_raw: r.raw, guard_detail: r.guard?.detail ?? null } : {}),
        ...(body.texts !== false ? { text: { title: r.narrative.title, body: r.narrative.body, question: r.narrative.question }, deterministic: pack.deterministic } : {}),
      });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  rows.sort((a, b) => a.i - b.i);

  // Só modos com recomendação usam a IA; "nada pede ação" e "poucos dados" são texto fixo e NÃO entram na taxa de fallback.
  const eligible = rows.filter((r) => r.fallback_reason !== "template_only_mode");
  const llm = eligible.filter((r) => r.source === "llm");
  const judged = llm.filter((r) => r.judge);
  const violations: Record<string, number> = {};
  for (const r of rows) for (const v of r.violations) violations[v] = (violations[v] ?? 0) + 1;
  const reasons: Record<string, number> = {};
  for (const r of eligible.filter((x) => x.source === "template")) { const k = String(r.fallback_reason ?? "?").split(":")[0]; reasons[k] = (reasons[k] ?? 0) + 1; }
  const lat = llm.map((r) => r.latency_ms).filter((n) => typeof n === "number").sort((a, b) => a - b);
  return json({
    ok: true,
    summary: {
      scenarios_total: all.length, evaluated: rows.length, skipped_by_time: slice.length - rows.length,
      template_only_mode: rows.length - eligible.length, llm_eligible: eligible.length,
      llm_ok: llm.length, fallback: eligible.length - llm.length, fallback_rate_pct: pct(eligible.length - llm.length, eligible.length),
      fallback_reasons: reasons, guard_violations: violations,
      judge: { judged: judged.length, faithful_pct: pct(judged.filter((r) => r.judge.faithful).length, judged.length), clear_pct: pct(judged.filter((r) => r.judge.clear).length, judged.length), calm_pct: pct(judged.filter((r) => r.judge.calm).length, judged.length), actionable_pct: pct(judged.filter((r) => r.judge.actionable).length, judged.length) },
      latency_ms: { p50: lat[Math.floor(lat.length * 0.5)] ?? null, p95: lat[Math.floor(lat.length * 0.95)] ?? null },
    },
    rows,
  });
});
