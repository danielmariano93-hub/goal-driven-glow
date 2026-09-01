// Edge Function: nino-next-step
// Ponte fina entre o app e o motor de mudança (nino_change_agent.v1).
// NÃO recalcula nada e NÃO cria recomendação: apenas aceita ou dispensa a
// recomendação canônica vigente, reaproveitando o changeLoop (revalidação
// material, compromisso único e ledger de aprendizado seguem no motor).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { httpContext } from "../_shared/http.ts";
import {
  commitLatestRecommendation,
  getActiveCommitmentStatus,
  registerChangeDismissal,
} from "../_shared/agent/changeLoop.ts";
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
  if (action !== "accept" && action !== "dismiss") return h.fail("invalid_action", 400);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  try {
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
