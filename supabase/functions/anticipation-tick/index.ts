// Edge Function: anticipation-tick
// Motor de Antecipação Comportamental Financeira (anticipation_contract.v1).
// Estágios: facts+patterns+opportunities (run) e dispatch para a fila proativa.
//
// Autorização: x-cron-secret, bearer de admin de plataforma ou bearer de usuário
// comum com { self: true } (sempre em modo simulado, só para si mesmo).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { httpContext } from "../_shared/http.ts";
import { runAnticipationForUser, dispatchAnticipations } from "../_shared/anticipation/runner.ts";
import { dispatchSuggestions } from "../_shared/agent/core/NotificationDispatcher.ts";
import { selectProactiveUserIds } from "../_shared/intelligence/proactiveAudience.ts";
import { writeJobHeartbeat } from "../_shared/heartbeats.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";

Deno.serve(async (req) => {
  const h = httpContext("anticipation-tick", req);
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
      if (admin && (admin as any).active) { authorised = true; isAdmin = true; }
      else if (body?.self === true) { authorised = true; selfUserId = uid; }
    }
  }
  if (!authorised) return h.fail("unauthorized", 401);

  const selfMode = selfUserId !== null;
  // Usuário final nunca dispara envio: só recalcula o próprio quadro.
  const dryRun = selfMode ? true : body?.dry_run !== false;
  const stages: string[] = Array.isArray(body?.only) && body.only.length > 0
    ? body.only.map(String)
    : ["run", "dispatch"];

  let userIds: string[] = [];
  if (selfMode) userIds = [selfUserId!];
  else if (body?.user_id) userIds = [String(body.user_id)];
  else {
    userIds = await selectProactiveUserIds(sb, {
      limit: Number(body?.limit) || 25,
      activityDays: 90,
      onboardingDays: 60,
    });
  }

  const runs: unknown[] = [];
  const errors: string[] = [];

  if (stages.includes("run")) {
    for (const uid of userIds) {
      try {
        runs.push(await runAnticipationForUser(sb, uid, {
          dryRun,
          includeInactiveDetectors: body?.include_inactive_detectors === true,
        }));
      } catch (error) {
        errors.push(`run:${uid}:${error instanceof Error ? error.message : String(error)}`.slice(0, 200));
      }
    }
  }

  let dispatch = { evaluated: 0, queued: 0, expired: 0, converted: 0, simulated: 0, errors: [] as string[] };
  let delivered = 0;
  if (stages.includes("dispatch") && !selfMode) {
    try {
      dispatch = await dispatchAnticipations(sb, {
        userId: body?.user_id ? String(body.user_id) : undefined,
        limit: Number(body?.dispatch_limit) || 50,
        dryRun,
      });
      // Entrega real reusa o pipeline de comunicação já auditado.
      if (!dryRun && dispatch.queued > 0) {
        for (const uid of userIds) {
          const outcomes = await dispatchSuggestions(sb, uid, { max: 2, channels: ["app", "whatsapp"] });
          delivered += outcomes.filter((o) => o.status === "delivered" || o.status === "queued").length;
        }
      }
    } catch (error) {
      errors.push(`dispatch:${error instanceof Error ? error.message : String(error)}`.slice(0, 200));
    }
  }

  const durationMs = Date.now() - startedAt;
  if (!selfMode && isAdmin) {
    await writeJobHeartbeat({
      jobKey: "anticipation-tick",
      ok: errors.length === 0,
      processed: userIds.length,
      failed: errors.length,
      errorCode: errors[0]?.slice(0, 80) ?? null,
      stages: {
        generated: runs.reduce((sum, r) => sum + Number((r as { opportunities_scheduled?: number }).opportunities_scheduled ?? 0), 0),
        enqueued: dispatch.queued,
        app_delivered: delivered,
        skipped: dispatch.expired + dispatch.simulated,
      },
      sb,
    });
  }

  return h.ok({
    ok: true,
    dry_run: dryRun,
    stages,
    scanned: userIds.length,
    duration_ms: durationMs,
    runs,
    dispatch: { ...dispatch, delivered },
    errors,
  });
});
