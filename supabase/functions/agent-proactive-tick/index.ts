// Edge Function: agent-proactive-tick
// Scans users, creates proactive candidates and dispatches them through the
// central communication policy. Global proactive_enabled remains the kill switch.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { scanUser } from "../_shared/agent/core/ProactiveEngine.ts";
import { recomputeProfile } from "../_shared/agent/core/UserProfile.ts";
import { dispatchSuggestions } from "../_shared/agent/core/NotificationDispatcher.ts";
import { selectProactiveUserIds } from "../_shared/intelligence/proactiveAudience.ts";
import { refreshBehaviorHypotheses } from "../_shared/agent/core/BehaviorService.ts";
import { generateAdvisorReviews } from "../_shared/agent/core/AdvisorReviewService.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? "";

function stageError(stage: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${stage}:${message}`.slice(0, 160);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const cron = req.headers.get("x-cron-secret") ?? "";
  const bearer = req.headers.get("Authorization") ?? "";
  let authorised = CRON_SECRET !== "" && cron === CRON_SECRET;
  if (!authorised && bearer.startsWith("Bearer ")) {
    const sbAuth = createClient(SUPABASE_URL, SERVICE_ROLE, {
      global: { headers: { Authorization: bearer } }, auth: { persistSession: false },
    });
    const { data } = await sbAuth.auth.getUser();
    if (data?.user?.id) {
      const { data: admin } = await sb.from("platform_admins")
        .select("active").eq("user_id", data.user.id).maybeSingle();
      authorised = !!admin && !!(admin as any).active;
    }
  }
  if (!authorised) return json({ error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const { data: settings } = await sb.from("agent_settings")
    .select("proactive_enabled").eq("id", 1).maybeSingle();
  if (!(settings as any)?.proactive_enabled && body?.force !== true) {
    return json({ ok: true, disabled: true, reason: "proactive_enabled_is_false", scanned: 0, results: [] });
  }

  let userIds: string[] = [];
  if (body?.user_id) {
    userIds = [String(body.user_id)];
  } else {
    // Inclui cadastro, uso do produto, lançamentos e conversas com o assessor.
    userIds = await selectProactiveUserIds(sb, { limit: 100, activityDays: 60, onboardingDays: 45 });
  }

  const results: Array<{
    user_id: string;
    suggestions: number;
    deliveries: number;
    behavior_hypotheses: number;
    advisor_reviews: number;
    errors: string[];
  }> = [];
  for (const uid of userIds) {
    const errors: string[] = [];
    let suggestions = 0, deliveries = 0, behaviorHypotheses = 0, advisorReviews = 0;

    // Profile refresh is useful but not allowed to suppress the existing
    // proactive pipeline; scanUser can still load/recompute its own context.
    try {
      await recomputeProfile(sb, uid);
    } catch (error) {
      errors.push(stageError("profile", error));
    }

    // New intelligence stages are isolated from each other and from the
    // pre-existing scan/dispatch flow.
    const [behaviorResult, reviewsResult] = await Promise.allSettled([
      refreshBehaviorHypotheses(sb, uid),
      generateAdvisorReviews(sb, uid),
    ]);

    if (behaviorResult.status === "fulfilled") {
      behaviorHypotheses = behaviorResult.value.persisted;
    } else {
      errors.push(stageError("behavior", behaviorResult.reason));
    }

    if (reviewsResult.status === "fulfilled") {
      advisorReviews = reviewsResult.value.weekly + reviewsResult.value.monthly;
    } else {
      errors.push(stageError("advisor", reviewsResult.reason));
    }

    try {
      const generated = await scanUser(sb, uid);
      suggestions = generated.length;
      const dispatched = await dispatchSuggestions(sb, uid, { max: 3 });
      deliveries = dispatched.filter(d => d.status === "delivered" || d.status === "queued").length;
      errors.push(...dispatched
        .filter(d => d.status === "failed")
        .map(d => stageError("dispatch", d.reason ?? "dispatch_failed")));
    } catch (error) {
      errors.push(stageError("proactive", error));
    }

    results.push({
      user_id: uid,
      suggestions,
      deliveries,
      behavior_hypotheses: behaviorHypotheses,
      advisor_reviews: advisorReviews,
      errors,
    });
  }
  return json({ ok: true, scanned: userIds.length, results });
});
