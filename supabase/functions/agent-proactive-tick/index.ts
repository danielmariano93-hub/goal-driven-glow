// Edge Function: agent-proactive-tick
// Motor único de comunicação proativa: perfil → comportamento → revisões →
// scan → dispatch, com rollout por canal, simulação e telemetria.
//
// Autorização aceita três modos:
//  1. x-cron-secret (INTERNAL_CRON_SECRET ou CRON_SECRET) — cron/admin;
//  2. Bearer de admin de plataforma;
//  3. Bearer de usuário comum com { self: true } — processa apenas a si mesmo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { httpContext } from "../_shared/http.ts";
import { scanUser } from "../_shared/agent/core/ProactiveEngineV2.ts";
import { recomputeProfile } from "../_shared/agent/core/UserProfile.ts";
import { dispatchSuggestions } from "../_shared/agent/core/NotificationDispatcher.ts";
import { markProactiveScan, selectProactiveUserIds } from "../_shared/intelligence/proactiveAudience.ts";
import { refreshBehaviorHypotheses } from "../_shared/agent/core/BehaviorService.ts";
import { generateAdvisorReviews } from "../_shared/agent/core/AdvisorReviewServiceV2.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("INTERNAL_CRON_SECRET")
  ?? Deno.env.get("CRON_SECRET")
  ?? "";

type Stage = "profile" | "behavior" | "advisor" | "proactive";
const ALL_STAGES: Stage[] = ["profile", "behavior", "advisor", "proactive"];

function stageError(stage: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${stage}:${message}`.slice(0, 160);
}

// deno-lint-ignore no-explicit-any
function normalizeChannels(value: any): Array<"app" | "whatsapp"> {
  const list = Array.isArray(value) ? value : ["app"];
  const out = list.filter((c: unknown) => c === "app" || c === "whatsapp") as Array<"app" | "whatsapp">;
  return out.length > 0 ? out : ["app"];
}

Deno.serve(async (req) => {
  const h = httpContext("agent-proactive-tick", req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return h.fail("method_not_allowed", 405);

  const startedAt = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const cron = req.headers.get("x-cron-secret") ?? "";
  const bearer = req.headers.get("Authorization") ?? "";
  let authorised = CRON_SECRET !== "" && cron === CRON_SECRET;
  let isAdmin = authorised;
  let selfUserId: string | null = null;

  if (!authorised && bearer.startsWith("Bearer ")) {
    const sbAuth = createClient(SUPABASE_URL, SERVICE_ROLE, {
      global: { headers: { Authorization: bearer } }, auth: { persistSession: false },
    });
    const { data } = await sbAuth.auth.getUser();
    const uid = data?.user?.id;
    if (uid) {
      const { data: admin } = await sb.from("platform_admins")
        .select("active").eq("user_id", uid).maybeSingle();
      // deno-lint-ignore no-explicit-any
      if (admin && (admin as any).active) {
        authorised = true;
        isAdmin = true;
      } else if (body?.self === true) {
        authorised = true;
        selfUserId = uid;
      }
    }
  }
  if (!authorised) return h.fail("unauthorized", 401);

  const { data: settingsRow } = await sb.from("agent_settings")
    .select("proactive_enabled,proactive_channels,proactive_rollout_user_ids")
    .eq("id", 1).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const settings = (settingsRow as any) ?? {};
  const channels = normalizeChannels(settings.proactive_channels);
  const rolloutIds: string[] = Array.isArray(settings.proactive_rollout_user_ids)
    ? settings.proactive_rollout_user_ids.map(String)
    : [];

  const dryRun = body?.dry_run === true;
  const stages: Stage[] = Array.isArray(body?.only) && body.only.length > 0
    ? ALL_STAGES.filter((stage) => body.only.includes(stage))
    : ALL_STAGES;

  // Usuário final só pode processar a si mesmo e sem WhatsApp.
  const selfMode = selfUserId !== null;
  const effectiveChannels: Array<"app" | "whatsapp"> = selfMode ? ["app"] : channels;

  if (!settings.proactive_enabled && body?.force !== true && !selfMode) {
    return h.ok({
      ok: true, disabled: true, reason: "proactive_enabled_is_false",
      scanned: 0, channels, results: [],
    });
  }

  let userIds: string[] = [];
  if (selfMode) {
    userIds = [selfUserId!];
  } else if (body?.user_id) {
    userIds = [String(body.user_id)];
  } else if (rolloutIds.length > 0) {
    userIds = rolloutIds.slice(0, Number(body?.limit) || 100);
  } else {
    userIds = await selectProactiveUserIds(sb, {
      limit: Number(body?.limit) || 25,
      activityDays: 60,
      onboardingDays: 45,
    });
  }

  const results: Array<{
    user_id: string;
    suggestions: number;
    deliveries: number;
    behavior_hypotheses: number;
    advisor_reviews: number;
    advisor_skipped?: unknown;
    preview?: Array<{
      kind: string;
      channel_ready: string;
      title: string;
      body: string;
      dedup_key: string;
      evidence: Record<string, unknown>;
    }>;
    errors: string[];
  }> = [];

  for (const uid of userIds) {
    const errors: string[] = [];
    let suggestions = 0, deliveries = 0, behaviorHypotheses = 0, advisorReviews = 0;
    let advisorSkipped: unknown = undefined;
    let preview: Array<{ kind: string; channel_ready: string; title: string; body: string; dedup_key: string; evidence: Record<string, unknown> }> = [];

    if (!dryRun && stages.includes("profile")) {
      try {
        await recomputeProfile(sb, uid);
      } catch (error) {
        errors.push(stageError("profile", error));
      }
    }

    const tasks: Array<Promise<unknown>> = [];
    if (!dryRun && stages.includes("behavior")) tasks.push(refreshBehaviorHypotheses(sb, uid));
    if (!dryRun && stages.includes("advisor")) tasks.push(generateAdvisorReviews(sb, uid));
    const settled = await Promise.allSettled(tasks);
    let cursor = 0;

    if (!dryRun && stages.includes("behavior")) {
      const behaviorResult = settled[cursor++];
      if (behaviorResult?.status === "fulfilled") {
        behaviorHypotheses = (behaviorResult.value as { persisted: number }).persisted;
      } else if (behaviorResult) {
        errors.push(stageError("behavior", behaviorResult.reason));
      }
    }

    if (!dryRun && stages.includes("advisor")) {
      const reviewsResult = settled[cursor++];
      if (reviewsResult?.status === "fulfilled") {
        const value = reviewsResult.value as { weekly: number; monthly: number; skipped?: unknown };
        advisorReviews = value.weekly + value.monthly;
        advisorSkipped = value.skipped;
      } else if (reviewsResult) {
        errors.push(stageError("advisor", reviewsResult.reason));
      }
    }

    if (stages.includes("proactive")) {
      try {
        // Fonte única de conteúdo financeiro: o diagnóstico canônico. O motor
        // legado permanece apenas para sinais operacionais e de engajamento.
        const fromDiagnosis = await syncDiagnosisSuggestions(sb, uid, { persist: !dryRun });
        const generated = await scanUser(sb, uid, { persist: !dryRun, maxSuggestions: 8 });
        suggestions = generated.length + fromDiagnosis.length;
        if (dryRun) {
          preview = generated.map((item) => ({
            kind: item.kind,
            channel_ready: item.channel_ready,
            title: item.title,
            body: item.body,
            dedup_key: item.dedup_key,
            evidence: item.evidence,
          }));
        } else {
          const dispatched = await dispatchSuggestions(sb, uid, {
            max: 3,
            channels: effectiveChannels,
          });
          deliveries = dispatched.filter((d) => d.status === "delivered" || d.status === "queued").length;
          errors.push(...dispatched
            .filter((d) => d.status === "failed")
            .map((d) => stageError("dispatch", d.reason ?? "dispatch_failed")));
        }
      } catch (error) {
        errors.push(stageError("proactive", error));
      }
    }

    results.push({
      user_id: uid,
      suggestions,
      deliveries,
      behavior_hypotheses: behaviorHypotheses,
      advisor_reviews: advisorReviews,
      advisor_skipped: advisorSkipped,
      preview,
      errors,
    });
  }

  const durationMs = Date.now() - startedAt;

  // Rotação justa: registra a rodada para a próxima seleção priorizar quem
  // ficou mais tempo sem varredura.
  if (!selfMode && !dryRun && userIds.length > 0) {
    try {
      await markProactiveScan(sb, userIds);
    } catch (_error) { /* telemetria de rotação não deve derrubar o tick */ }
  }



  // Telemetria só para execuções do motor (não para o botão do usuário final).
  if (!selfMode && !dryRun && isAdmin) {
    const allErrors = results.flatMap((r) => r.errors.map((e) => ({ user_id: r.user_id, error: e })));
    await sb.from("agent_settings").update({
      last_tick_at: new Date().toISOString(),
      last_tick_duration_ms: durationMs,
      last_tick_users: userIds.length,
      last_tick_errors: allErrors.slice(0, 50),
      next_tick_at: new Date(Date.now() + 3600_000).toISOString(),
    }).eq("id", 1);
  }

  return h.ok({
    ok: true,
    scanned: userIds.length,
    channels: effectiveChannels,
    dry_run: dryRun,
    stages,
    duration_ms: durationMs,
    results,
  });
});
