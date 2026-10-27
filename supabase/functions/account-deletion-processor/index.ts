// Processa exclusões de conta cuja carência já venceu, sem depender de ação humana.
// Exigência da App Store: o usuário inicia e o processo se conclui sozinho.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { matchesAnySecret, safeEqual } from "../_shared/security/secrets.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRETS = [Deno.env.get("INTERNAL_CRON_SECRET") ?? "", Deno.env.get("CRON_SECRET") ?? ""].filter(Boolean);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Só cron/serviço: antes qualquer chamada com a chave pública podia disparar o processamento.
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const cron = req.headers.get("x-cron-secret") ?? req.headers.get("x-internal-secret") ?? "";
  if (!safeEqual(bearer, SERVICE_ROLE) && !matchesAnySecret(cron, CRON_SECRETS)) {
    return json({ error: "unauthorized" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: due, error } = await admin.rpc("due_deletion_requests", { p_limit: 20 });
  if (error) return json({ error: "queue_failed", detail: error.message.slice(0, 200) }, 500);

  const rows = (due ?? []) as { id: string; user_id: string }[];
  const results: { id: string; ok: boolean; detail?: string }[] = [];

  for (const row of rows) {
    const { data: deletedUserId, error: procErr } = await admin.rpc("admin_process_deletion_request", {
      p_id: row.id,
    });
    if (procErr) {
      results.push({ id: row.id, ok: false, detail: procErr.message.slice(0, 160) });
      continue;
    }
    if (deletedUserId) {
      const { error: authErr } = await admin.auth.admin.deleteUser(deletedUserId as string);
      if (authErr) {
        results.push({ id: row.id, ok: false, detail: `auth: ${authErr.message.slice(0, 140)}` });
        continue;
      }
    }
    results.push({ id: row.id, ok: true });
  }

  return json({ processed: results.length, results });
});
