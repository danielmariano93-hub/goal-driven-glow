// Edge Function: nino-next-step
// Ponte fina entre a Home e o motor determinístico de mudança.
// - refresh: recalcula a orientação contra a verdade financeira AGORA e persiste
//   a recomendação canônica vigente;
// - accept/dismiss: fecham o loop de compromisso/aprendizado já existente.
// Nenhuma ação movimenta dinheiro.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { httpContext } from "../_shared/http.ts";
import {
  commitLatestRecommendation,
  getActiveCommitmentStatus,
  persistNextActionRecommendation,
  registerChangeDismissal,
} from "../_shared/agent/changeLoop.ts";
import { computeNextBestAction } from "../_shared/agent/behaviorWealth.ts";
import { NINO_COMMITMENT_COPY } from "../_shared/copy/decisionNarrative.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  const h = httpContext("nino-next-step", req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return h.fail("method_not_allowed", 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return h.fail("unauthorized", 401);

  const sbAuth = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: u } = await sbAuth.auth.getUser();
  const user_id = u?.user?.id;
  if (!user_id) return h.fail("unauthorized", 401);

  let body: { action?: unknown } = {};
  try { body = await req.json(); } catch { /* corpo vazio cai na validação */ }
  const action = typeof body.action === "string" ? body.action : "";
  if (action !== "refresh" && action !== "accept" && action !== "dismiss") {
    return h.fail("invalid_action", 400);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
    if (action === "refresh") {
      // Read-after-write editorial: não exibe uma recomendação persistida de um
      // cenário financeiro anterior. O motor é determinístico e reusa a mesma
      // verdade financeira do Nino/WhatsApp.
      const current = await computeNextBestAction(sb, user_id, { months: 12 });
      const recommendationId = await persistNextActionRecommendation(sb, user_id, current, "app");
      return h.ok({
        action,
        recommendation: {
          id: recommendationId,
          stage: current.stage,
          title: current.action.title,
          detail: current.action.detail,
          route: current.action.route,
          amount: current.action.amount,
          amount_role: current.action.amount_role,
          required_amount: current.action.required_amount,
          goal_id: current.action.goal_id,
          goal_name: current.action.goal_name,
          as_of: current.as_of,
          version: current.version,
        },
      });
    }

    if (action === "accept") {
      const result = await commitLatestRecommendation(sb, user_id);
      const status = String((result as { status?: string })?.status ?? "");
      const message = status === "committed" || status === "already_committed"
        ? NINO_COMMITMENT_COPY.accepted
        : String((result as { message?: string })?.message ?? NINO_COMMITMENT_COPY.accepted);
      return h.ok({ action, result, message });
    }

    const active = await getActiveCommitmentStatus(sb, user_id);
    if (!active) return h.ok({ action, result: null, message: NINO_COMMITMENT_COPY.dismissed });
    const result = await registerChangeDismissal(sb, user_id, active.commitment_id, { origin: "app_next_step" });
    return h.ok({ action, result, message: NINO_COMMITMENT_COPY.dismissed });
  } catch (error) {
    return h.fail(error instanceof Error ? error.message : "next_step_failed", 500);
  }
});
