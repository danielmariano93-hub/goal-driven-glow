// Edge Function: benefit-statement-read (`benefit_statement.v1`)
// Lê o PRINT do extrato do Ticket Alimentação e devolve candidatos. Não grava nada:
// quem confirma é a pessoa, na tela. Contexto separado do livro-razão (não toca em transactions).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { fail } from "../_shared/http.ts";
import { getAiBlock, pauseAiCircuit } from "../_shared/aiCircuit.ts";
import { recordAiUsage, estimateAiCostUsd } from "../_shared/aiUsageLedger.ts";
import { aiEndpoint, aiJsonHeaders, normalizeAiModel, resolveAiProvider } from "../_shared/ai-runtime.ts";
import { ensureWorkloadAllowed } from "../_shared/aiWorkloadBudget.ts";
import { today as localToday } from "../_shared/finance-core/ninoClock.ts";
import { BENEFIT_STATEMENT_VERSION, parseBenefitStatement } from "../_shared/finance-core/benefitStatement.ts";

const FN = "benefit-statement-read";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MAX_IMAGE_CHARS = 6_000_000; // ~4,5 MB de imagem em base64
const TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `Você transcreve o extrato de um cartão de vale-alimentação/refeição (print de aplicativo).
Devolva APENAS JSON: {"k":"extrato"|"outro","i":[["gasto"|"credito","DD/MM","HH:MM",123.45,"ESTABELECIMENTO"]]}.
Regras:
- Cada linha com valor é uma entrada. Valor em verde com "Crédito recebido" = "credito" (estabelecimento null). As demais = "gasto".
- A data vem do cabeçalho do grupo (ex.: "02 NOV." = "02/11"). Use "DD/MM". Não invente o ano.
- Hora = "HH:MM" da linha, ou null se não aparecer.
- Estabelecimento: copie o texto exatamente como está no print, sem corrigir.
- Valor: número com ponto decimal (R$ 1.227,16 = 1227.16). Nunca devolva valores negativos.
- Se a linha estiver cortada ou ilegível, OMITA a linha. Nunca estime nem complete.
- Se não for um extrato de vale-alimentação, devolva {"k":"outro","i":[]}.`;

async function visionModel(sb: any): Promise<string> {
  const configured = String(Deno.env.get("NINO_AI_VISION_MODEL") ?? "").trim();
  if (configured) return configured;
  const { data } = await sb.from("ai_model_routes").select("primary_model").eq("task", "vision").eq("active", true).maybeSingle();
  return String(data?.primary_model ?? Deno.env.get("NINO_AI_MODEL") ?? "openai/gpt-oss-120b");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", { status: 405, functionName: FN });

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return fail("unauthorized", { status: 401, functionName: FN });
  const sbAuth = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await sbAuth.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) return fail("unauthorized", { status: 401, functionName: FN });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const access = await sb.from("benefit_wallet_access").select("user_id").eq("user_id", userId).maybeSingle();
  if (access.error || !access.data) return fail("feature_not_enabled", { status: 403, functionName: FN });

  let image = "";
  try { image = String((await req.json())?.image ?? ""); } catch { /* corpo inválido */ }
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) return fail("invalid_image", { status: 400, functionName: FN });
  if (image.length > MAX_IMAGE_CHARS) return fail("image_too_large", { status: 413, functionName: FN });

  const provider = resolveAiProvider();
  if (!provider) return fail("ai_unavailable", { status: 503, functionName: FN });
  if (await getAiBlock(sb)) return fail("ai_unavailable", { status: 503, functionName: FN });
  const budget = await ensureWorkloadAllowed(sb, "DOCUMENT_INGEST");
  if (!budget.allowed) return fail("ai_budget_blocked", { status: 429, functionName: FN });

  const today = localToday();
  const model = normalizeAiModel(await visionModel(sb), provider);
  const started = Date.now();
  let tokensIn = 0, tokensOut = 0, httpStatus: number | null = null, success = false, errorCode: string | null = null;
  try {
    const res = await fetch(aiEndpoint(provider, "chat/completions"), {
      method: "POST",
      headers: aiJsonHeaders(provider),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: [{ type: "text", text: `Hoje é ${today}. Transcreva o extrato.` }, { type: "image_url", image_url: { url: image } }] },
        ],
        response_format: { type: "json_object" },
        max_tokens: 3000,
      }),
    });
    httpStatus = res.status;
    if (!res.ok) {
      errorCode = `gateway_${res.status}`;
      if (res.status === 402 || res.status === 403) await pauseAiCircuit(sb, res.status, await res.text());
      return fail("ai_unavailable", { status: 502, functionName: FN });
    }
    const data = await res.json();
    tokensIn = Number(data?.usage?.prompt_tokens ?? 0);
    tokensOut = Number(data?.usage?.completion_tokens ?? 0);
    let raw: any = null;
    try { raw = JSON.parse(String(data?.choices?.[0]?.message?.content ?? "{}")); } catch { errorCode = "extraction_json"; }
    if (errorCode) return fail("unreadable", { status: 422, functionName: FN });
    success = true;
    const parsed = parseBenefitStatement(raw, today);
    return json({
      ok: true, version: BENEFIT_STATEMENT_VERSION, today,
      recognized: raw?.k === "extrato", items: parsed.items, discarded: parsed.discarded,
    });
  } catch (e) {
    errorCode = (e as Error).name === "TimeoutError" ? "timeout" : "fetch_error";
    return fail("ai_unavailable", { status: 502, functionName: FN });
  } finally {
    await recordAiUsage(sb, {
      workload: "DOCUMENT_INGEST", function_name: FN, operation: "benefit_statement_vision", user_id: userId, run_id: crypto.randomUUID(),
      model, provider: provider.provider, operation_type: "vision",
      input_tokens: tokensIn, output_tokens: tokensOut, estimated_cost_usd: estimateAiCostUsd(model, tokensIn, tokensOut),
      success, http_status: httpStatus, error_code: errorCode, latency_ms: Date.now() - started, batch_size: 1, unique_items: 1,
      idempotency_key: `${userId}:${started}`, reason_for_ai_call: "benefit_statement_vision", payload_bytes: image.length, metadata: {},
    } as any).catch(() => {});
  }
});
