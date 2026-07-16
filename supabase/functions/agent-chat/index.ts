// In-app assessor chat. Runs on user JWT, reuses agent LLM primitives and tools.
// Persists conversation with source='app' — no WhatsApp outbound involved.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const MAX_MSG_LEN = 2000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  // User client (verify JWT)
  const userClient = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: auth } } }
  );
  const { data: userRes, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userRes.user) return json({ error: "unauthorized" }, 401);
  const user_id = userRes.user.id;

  const body = await req.json().catch(() => ({}));
  const text = String(body?.text ?? "").trim().slice(0, MAX_MSG_LEN);
  const requested_conv = typeof body?.conversation_id === "string" ? body.conversation_id : null;
  if (!text) return json({ error: "missing_text" }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false, autoRefreshToken: false } });

  // Rate limit simples: 30 msgs/min por user
  const { count } = await svc
    .from("conversation_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user_id)
    .gte("created_at", new Date(Date.now() - 60_000).toISOString());
  if ((count ?? 0) > 30) return json({ error: "rate_limited" }, 429);

  // Get or create conversation (source='app')
  let conversation_id = requested_conv;
  if (conversation_id) {
    const { data: conv } = await svc.from("conversations")
      .select("id, user_id, source")
      .eq("id", conversation_id)
      .maybeSingle();
    if (!conv || conv.user_id !== user_id || conv.source !== "app") {
      conversation_id = null;
    }
  }
  if (!conversation_id) {
    const { data: newConv, error: convErr } = await svc.from("conversations")
      .insert({ user_id, source: "app", phone_e164: null, last_message_at: new Date().toISOString() } as any)
      .select("id").single();
    if (convErr) return json({ error: "conv_create_failed" }, 500);
    conversation_id = newConv!.id as string;
  }

  // Save inbound
  await svc.from("conversation_messages").insert({
    conversation_id, user_id, direction: "inbound", body_masked: text,
  } as any);
  await svc.from("conversations").update({ last_message_at: new Date().toISOString() } as any).eq("id", conversation_id);

  // Reply
  let reply = "";
  try {
    reply = await generateReply({ svc, user_id, text });
  } catch (e) {
    console.error("[agent-chat] llm_error", String((e as Error).message).slice(0, 200));
    reply = "Não consegui processar agora. Tente reformular em poucas palavras (ex: 'como está meu mês?').";
  }
  if (!reply) reply = "Certo. Me diga em uma frase o que você quer fazer.";

  await svc.from("conversation_messages").insert({
    conversation_id, user_id, direction: "outbound", body_masked: reply,
  } as any);

  return json({ ok: true, conversation_id, reply });
});

async function generateReply(args: { svc: any; user_id: string; text: string }): Promise<string> {
  const { svc, user_id, text } = args;

  // Fetch a compact factual snapshot (safe fields only)
  const [{ data: accounts }, { data: txs }, { data: goals }, { data: cards }] = await Promise.all([
    svc.from("accounts").select("id,name,type,opening_balance,active").eq("user_id", user_id).eq("active", true).limit(20),
    svc.from("transactions").select("type,amount,occurred_at,description,credit_card_id,competence_date")
       .eq("user_id", user_id).order("occurred_at", { ascending: false }).limit(50),
    svc.from("goals").select("name,target_amount,status").eq("user_id", user_id).limit(20),
    svc.from("credit_cards").select("name,total_limit,closing_day,due_day").eq("user_id", user_id).eq("active", true).limit(10),
  ]);

  const ym = new Date().toISOString().slice(0, 7);
  const monthTxs = (txs ?? []).filter((t: any) => (t.occurred_at ?? "").startsWith(ym));
  const income = monthTxs.filter((t: any) => t.type === "income").reduce((a: number, b: any) => a + Number(b.amount || 0), 0);
  const expense = monthTxs.filter((t: any) => t.type === "expense").reduce((a: number, b: any) => a + Number(b.amount || 0), 0);
  const cashOpening = (accounts ?? []).reduce((a: number, b: any) => a + Number(b.opening_balance || 0), 0);
  const netFlow = (txs ?? []).reduce((a: number, t: any) => a + (t.type === "income" ? Number(t.amount) : t.type === "expense" ? -Number(t.amount) : 0), 0);
  const cashNow = cashOpening + netFlow;

  const facts = {
    contas: (accounts ?? []).length,
    saldo_estimado: Math.round(cashNow * 100) / 100,
    entradas_mes: Math.round(income * 100) / 100,
    saidas_mes: Math.round(expense * 100) / 100,
    metas_ativas: (goals ?? []).filter((g: any) => g.status === "active").length,
    cartoes: (cards ?? []).length,
    fatura_atual_por_cartao: (cards ?? []).map((c: any) => {
      const total = monthTxs
        .filter((t: any) => (t as any).competence_date?.startsWith(ym))
        .reduce((a: number, b: any) => a + Number(b.amount || 0), 0);
      return { cartao: c.name, fatura_mes: Math.round(total * 100) / 100, limite: Number(c.total_limit || 0) };
    }),
  };

  // Fallback determinístico se LLM não disponível
  if (!LOVABLE_API_KEY) {
    return buildDeterministicReply(text, facts);
  }

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": LOVABLE_API_KEY,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "Você é o assessor financeiro do NoControle.ia dentro do app. " +
              "Fale em português brasileiro, tom humano, direto, encorajador, sem culpa nem promessas. " +
              "Use APENAS os fatos abaixo; nunca invente valores. Se faltar dado, peça de forma simples. " +
              "Máx 4 linhas. Nada de linguagem técnica.\n\n" +
              "Fatos do usuário (JSON): " + JSON.stringify(facts),
          },
          { role: "user", content: text },
        ],
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`gateway_${res.status}`);
    const data = await res.json();
    const out = String(data?.choices?.[0]?.message?.content ?? "").trim();
    if (!out) return buildDeterministicReply(text, facts);
    return out;
  } catch (e) {
    console.warn("[agent-chat] fallback", String((e as Error).message).slice(0, 100));
    return buildDeterministicReply(text, facts);
  }
}

function fmtBRL(n: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);
}

function buildDeterministicReply(text: string, f: any): string {
  const t = text.toLowerCase();
  if (t.includes("mês") || t.includes("mes")) {
    return `Este mês: entradas ${fmtBRL(f.entradas_mes)}, saídas ${fmtBRL(f.saidas_mes)}. Saldo estimado ${fmtBRL(f.saldo_estimado)}. Quer ver por categoria?`;
  }
  if (t.includes("meta")) {
    return f.metas_ativas > 0
      ? `Você tem ${f.metas_ativas} meta(s) ativa(s). Quer registrar um aporte agora?`
      : "Você ainda não tem metas ativas. Quer criar uma?";
  }
  if (t.includes("cartão") || t.includes("cartao") || t.includes("fatura")) {
    if (!f.cartoes) return "Você ainda não cadastrou nenhum cartão. Posso te levar ao cadastro?";
    const lines = f.fatura_atual_por_cartao
      .map((c: any) => `• ${c.cartao}: fatura atual ${fmtBRL(c.fatura_mes)} (limite ${fmtBRL(c.limite)})`)
      .join("\n");
    return `Faturas em aberto:\n${lines}`;
  }
  return `Estou aqui. Posso te ajudar a registrar um gasto, analisar seu mês, revisar metas ou faturas. O que prefere?`;
}
