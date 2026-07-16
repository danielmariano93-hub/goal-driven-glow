// Edge function: insights-generate
// Gera uma dica personalizada para o usuário autenticado usando Lovable AI Gateway.
// - JWT do usuário obrigatório.
// - Rate-limit: 1 geração por 6h (se já existe insight ativo válido).
// - Fallback editorial em falha.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";

const PROMPT_VERSION = "v1";
const MODEL = "google/gemini-3.5-flash";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const supaUser = createClient(SUPABASE_URL, SERVICE_ROLE, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data: userData } = await supaUser.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return json({ error: "unauthorized" }, 401);

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  // Se já existe uma ativa não-expirada e recém-gerada (< 6h), reaproveita.
  const cutoff = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
  const { data: existing } = await supa
    .from("user_insights")
    .select("*")
    .eq("user_id", uid)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .gt("generated_at", cutoff)
    .order("generated_at", { ascending: false })
    .limit(1);
  if (existing && existing.length > 0) {
    return json({ insight: existing[0], cached: true });
  }

  // Agrega dados mínimos server-side.
  const ym = new Date().toISOString().slice(0, 7);
  const [{ count: txCount }, { data: goals }, { data: recentTx }] = await Promise.all([
    supa.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", uid),
    supa.from("goals").select("id,name,target_amount,status").eq("user_id", uid).eq("status", "active"),
    supa
      .from("transactions")
      .select("kind,amount,category_id,occurred_at")
      .eq("user_id", uid)
      .gte("occurred_at", `${ym}-01`)
      .order("occurred_at", { ascending: false })
      .limit(200),
  ]);

  const txs = (recentTx ?? []) as any[];
  const income = txs.filter((t) => t.kind === "income").reduce((s, t) => s + Number(t.amount), 0);
  const expense = txs.filter((t) => t.kind === "expense").reduce((s, t) => s + Number(t.amount), 0);
  const totalCount = txCount ?? 0;

  const facts = {
    total_tx_ever: totalCount,
    month: ym,
    income_month: Number(income.toFixed(2)),
    expense_month: Number(expense.toFixed(2)),
    balance_month: Number((income - expense).toFixed(2)),
    active_goals: (goals ?? []).length,
    goal_names: (goals ?? []).slice(0, 3).map((g: any) => g.name),
  };

  const isOnboarding = totalCount < 3;

  // Gera via Lovable AI, com fallback editorial.
  let insight: any = null;

  if (LOVABLE_API_KEY) {
    try {
      const system = `Você é o assistente do NoControle.ia. Escreva uma dica curta em português brasileiro (título ≤ 60 chars, texto ≤ 200 chars) baseada estritamente nos dados fornecidos. Tom: caloroso, direto, aliado. Não invente valores. Sem julgamento. Sem promessa de retorno financeiro. Não recomende investimentos regulados. Se houver poucos dados, use type "onboarding" e diga que ainda está te conhecendo. Responda somente em JSON.`;
      const user = `Dados do usuário (JSON): ${JSON.stringify(facts)}. Gere UMA dica.`;

      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": LOVABLE_API_KEY,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (resp.ok) {
        const j = await resp.json();
        const content = j.choices?.[0]?.message?.content;
        const parsed = typeof content === "string" ? JSON.parse(content) : content;
        const type = ["habit", "alert", "celebration", "onboarding", "opportunity"].includes(parsed.type)
          ? parsed.type
          : isOnboarding
          ? "onboarding"
          : "habit";
        insight = {
          type,
          title: String(parsed.title ?? "").slice(0, 100),
          body: String(parsed.body ?? "").slice(0, 400),
          cta_label: String(parsed.cta_label ?? "Ver detalhes").slice(0, 60),
          cta_route: /^\/app\//.test(parsed.cta_route ?? "") ? parsed.cta_route : "/app/lancamentos",
          model: MODEL,
        };
      }
    } catch (_e) {
      /* fallback */
    }
  }

  if (!insight) {
    insight = isOnboarding
      ? {
          type: "onboarding",
          title: "Vamos nos conhecer melhor",
          body: "Registre seu primeiro gasto ou entrada para eu começar a te ajudar de verdade.",
          cta_label: "Anotar gasto",
          cta_route: "/app/lancamentos",
          model: "fallback",
        }
      : {
          type: "habit",
          title: "Um passo por vez",
          body: "Registrar seus gastos por 3 dias seguidos já muda como você enxerga o próprio dinheiro.",
          cta_label: "Anotar gasto",
          cta_route: "/app/lancamentos",
          model: "fallback",
        };
  }

  const now = new Date();
  const { data: inserted, error } = await supa
    .from("user_insights")
    .insert({
      user_id: uid,
      ...insight,
      evidence: facts,
      prompt_version: PROMPT_VERSION,
      generated_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
      status: "active",
    })
    .select("*")
    .single();

  if (error) return json({ error: error.message }, 500);
  return json({ insight: inserted, cached: false });
});
