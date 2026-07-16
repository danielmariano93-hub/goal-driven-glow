// One-shot admin bootstrap. Called manually by the project owner via HTTPS.
// Guardrails:
//   - Requires JWT of an existing authenticated user (verify_jwt = true) OR service role.
//   - Requires header X-Bootstrap-Secret === CRON_SECRET.
//   - Env BOOTSTRAP_DISABLED=1 hard-disables the function.
//   - Reads target credentials from env only. Never accepts password from request body.
//   - Never logs or returns the password.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOOTSTRAP_DISABLED = Deno.env.get("BOOTSTRAP_DISABLED") === "1";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const TARGET_EMAIL = (Deno.env.get("BOOTSTRAP_ADMIN_EMAIL") ?? "daniel.assis@nocontrole.com.br").toLowerCase();
const TARGET_PASSWORD = Deno.env.get("BOOTSTRAP_ADMIN_PASSWORD") ?? "";
const TARGET_NAME = Deno.env.get("BOOTSTRAP_ADMIN_NAME") ?? "Daniel Assis";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (BOOTSTRAP_DISABLED) return json({ ok: false, error: "disabled" }, 410);
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const bootHeader = req.headers.get("x-bootstrap-secret") ?? "";
  if (!CRON_SECRET || bootHeader !== CRON_SECRET) {
    return json({ ok: false, error: "forbidden" }, 403);
  }
  if (!TARGET_PASSWORD) {
    return json({ ok: false, error: "missing_password_env" }, 400);
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Locate or create user
  let userId: string | null = null;
  let created = false;
  // Paginate through users to find by email (admin API list has no exact filter guarantee).
  for (let page = 1; page <= 50 && !userId; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return json({ ok: false, error: "list_users_failed" }, 500);
    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === TARGET_EMAIL);
    if (found) { userId = found.id; break; }
    if (data.users.length < 200) break;
  }

  if (!userId) {
    const { data, error } = await svc.auth.admin.createUser({
      email: TARGET_EMAIL,
      password: TARGET_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: TARGET_NAME },
    });
    if (error || !data.user) {
      return json({ ok: false, error: "create_user_failed" }, 500);
    }
    userId = data.user.id;
    created = true;
  }

  // 2. Upsert profile
  await svc.from("profiles").upsert({
    id: userId,
    display_name: TARGET_NAME,
    onboarding_completed_at: new Date().toISOString(),
    timezone: "America/Sao_Paulo",
    currency: "BRL",
  }, { onConflict: "id" });

  // 3. Financial settings default
  await svc.from("user_financial_settings").upsert({
    user_id: userId,
    approximate_monthly_income: null,
    income_frequency: "mensal",
    income_day: null,
    timezone: "America/Sao_Paulo",
    currency: "BRL",
  }, { onConflict: "user_id" });

  // 4. Roles: admin + user (idempotent via unique(user_id, role))
  await svc.from("user_roles").upsert(
    [{ user_id: userId, role: "admin" }, { user_id: userId, role: "user" }],
    { onConflict: "user_id,role", ignoreDuplicates: true },
  );

  // 5. Audit trail (no password / no token)
  await svc.from("admin_grants_audit").insert({
    user_id: userId,
    granted_by: "bootstrap",
    notes: created ? "created via admin-bootstrap" : "grant refreshed via admin-bootstrap",
  });

  return json({
    ok: true,
    created,
    user_id: userId,
    roles: ["admin", "user"],
    hint: "Remova BOOTSTRAP_ADMIN_PASSWORD e defina BOOTSTRAP_DISABLED=1 após confirmar o login.",
  });
});
