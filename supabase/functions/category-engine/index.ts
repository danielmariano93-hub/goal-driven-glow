import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { streamText, Output, NoObjectGeneratedError } from "npm:ai";
import { z } from "npm:zod";
import { createLovableAiGatewayProvider } from "../_shared/ai-gateway.ts";
import {
  CATEGORY_ENGINE_VERSION,
  classifyDeterministic,
  loadCategorizationContext,
  resultFromLlm,
  type ClassificationInput,
  type ClassificationResult,
} from "../_shared/categorization/engine.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const MODEL = "google/gemini-3.6-flash";

const InputSchema = z.object({
  transaction_id: z.string().nullish(), type: z.enum(["income", "expense", "transfer"]),
  description: z.string().nullish(), explicit_category: z.string().nullish(),
  movement_kind: z.string().nullish(), transfer_group_id: z.string().nullish(), settles_card_id: z.string().nullish(),
});
const BodySchema = z.object({
  operation: z.enum(["classify", "classify_batch", "learn", "review_status", "process_queue"]),
  input: InputSchema.optional(), inputs: z.array(InputSchema).optional(),
  transaction_id: z.string().optional(), category_id: z.string().optional(),
});
const LlmSchema = z.object({ items: z.array(z.object({ index: z.number(), category_id: z.string().nullable(), confidence: z.number() })) });

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function inferWithAi(admin: ReturnType<typeof createClient>, userId: string, inputs: ClassificationInput[], results: ClassificationResult[]) {
  if (!LOVABLE_API_KEY) return results;
  const unresolved = results.map((result, index) => ({ result, input: inputs[index], index }))
    .filter(({ result }) => result.action === "leave_unresolved" && result.category_id === null);
  if (unresolved.length === 0) return results;
  const types = [...new Set(unresolved.map(({ input }) => input.type).filter((type) => type === "income" || type === "expense"))] as Array<"income" | "expense">;
  const contexts = await Promise.all(types.map(async (type) => [type, await loadCategorizationContext(admin, userId, type)] as const));
  const candidates = contexts.flatMap(([type, ctx]) => ctx.candidates.map((category) => ({ ...category, type })));
  const validIds = new Set(candidates.map((category) => category.id));
  try {
    const gateway = createLovableAiGatewayProvider(LOVABLE_API_KEY);
    const generation = streamText({
      model: gateway(MODEL),
      output: Output.object({ schema: LlmSchema }),
      prompt: `Classifique lançamentos financeiros brasileiros. Use somente category_id listado. Não classifique transferências, pagamento de fatura, investimento ou movimento técnico. Se não houver evidência suficiente, retorne category_id null.\n${JSON.stringify({ categories: candidates, items: unresolved.map(({ input, index }) => ({ index, type: input.type, description: input.description })) })}`,
    });
    const output = await generation.output;
    for (const item of output.items ?? []) {
      const target = Number(item.index);
      const decision = resultFromLlm(item, validIds);
      if (decision && results[target]?.category_id == null) results[target] = decision;
    }
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) console.warn("[category-engine] invalid structured output", error.text?.slice(0, 300));
    else console.warn("[category-engine] ai fallback", String(error).slice(0, 300));
  }
  return results;
}

async function persistDecision(admin: ReturnType<typeof createClient>, userId: string, input: ClassificationInput, result: ClassificationResult, mode = "live") {
  if (!input.transaction_id) return result;
  const { data: tx } = await admin.from("transactions").select("id,user_id,category_id,category_source").eq("id", input.transaction_id).eq("user_id", userId).maybeSingle();
  if (!tx || tx.category_source === "user") return { ...result, action: "preserve" };
  const apply = result.action === "auto_apply";
  const { data: decision, error } = await admin.from("category_decisions").insert({
    user_id: userId, transaction_id: tx.id, previous_category_id: tx.category_id,
    decided_category_id: result.category_id, source: result.category_source,
    confidence: result.category_confidence, reason_code: result.reason_code, reason: result.category_reason,
    engine_version: CATEGORY_ENGINE_VERSION, action: result.action, mode, actor: "engine",
    alternatives: result.alternatives, applied_at: apply ? new Date().toISOString() : null,
  }).select("id").single();
  if (error) throw error;
  const patch = apply ? {
    category_id: result.category_id, category_source: result.category_source,
    category_confidence: result.category_confidence, category_reason: result.category_reason,
    category_review_status: "resolved", category_engine_version: CATEGORY_ENGINE_VERSION,
    category_classified_at: new Date().toISOString(), category_decision_id: decision.id,
  } : {
    category_review_status: result.action === "suggest_review" ? "suggested" : "needs_review",
    category_engine_version: CATEGORY_ENGINE_VERSION, category_classified_at: new Date().toISOString(),
    category_decision_id: decision.id,
  };
  const { error: updateError } = await admin.from("transactions").update(patch).eq("id", tx.id).eq("user_id", userId).neq("category_source", "user");
  if (updateError) throw updateError;
  await admin.from("category_classification_queue").update({ status: "completed", processed_at: new Date().toISOString(), last_error: null }).eq("transaction_id", tx.id);
  return result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const client = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return response({ error: "Não autenticado" }, 401);
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return response({ error: "Entrada inválida", details: parsed.error.flatten().fieldErrors }, 400);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const body = parsed.data;
    if (body.operation === "review_status") {
      const { count } = await admin.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", user.id).in("category_review_status", ["suggested", "needs_review"]);
      return response({ pending: count ?? 0, engine_version: CATEGORY_ENGINE_VERSION });
    }
    if (body.operation === "learn") {
      if (!body.transaction_id || !body.category_id) return response({ error: "transaction_id e category_id obrigatórios" }, 400);
      const { error } = await client.rpc("learn_transaction_category", { p_transaction_id: body.transaction_id, p_category_id: body.category_id });
      if (error) throw error;
      return response({ learned: true });
    }
    let inputs = body.operation === "classify" ? (body.input ? [body.input] : []) : (body.inputs ?? []);
    if (body.operation === "process_queue") {
      const { data: queued } = await admin.from("category_classification_queue").select("transaction_id,transactions!inner(id,user_id,type,description,friendly_description,raw_description,movement_kind,transfer_group_id,settles_card_id)")
        .eq("user_id", user.id).in("status", ["queued", "failed"]).lte("available_at", new Date().toISOString()).limit(80);
      inputs = (queued ?? []).map((row: any) => ({ transaction_id: row.transactions.id, type: row.transactions.type, description: row.transactions.friendly_description ?? row.transactions.raw_description ?? row.transactions.description, movement_kind: row.transactions.movement_kind, transfer_group_id: row.transactions.transfer_group_id, settles_card_id: row.transactions.settles_card_id }));
    }
    if (inputs.length === 0) return response({ error: "Nenhum lançamento informado" }, 400);
    let results = await Promise.all(inputs.map((input) => classifyDeterministic(admin, user.id, input)));
    results = await inferWithAi(admin, user.id, inputs, results);
    const persisted = await Promise.all(results.map((result, index) => persistDecision(admin, user.id, inputs[index], result)));
    return response(body.operation === "classify" ? { decision: persisted[0] } : { decisions: persisted, processed: persisted.length });
  } catch (error) {
    console.error("[category-engine]", error);
    return response({ error: "Falha ao categorizar", details: error instanceof Error ? error.message : String(error) }, 500);
  }
});