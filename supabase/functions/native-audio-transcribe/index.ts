import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { z } from "npm:zod@3.23.8";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { aiBlockReply, getAiBlock, pauseAiCircuit } from "../_shared/aiCircuit.ts";

const ALLOWED_MIME = ["audio/aac", "audio/m4a", "audio/x-m4a", "audio/mp4", "audio/mpeg", "audio/ogg", "audio/webm", "audio/wav"];

// MediaRecorder envia "audio/webm;codecs=opus"; normalizamos antes de validar.
const Body = z.object({
  audio: z.string().min(32).max(4_000_000),
  mime_type: z
    .string()
    .transform((value) => value.split(";")[0].trim().toLowerCase())
    .refine((value) => ALLOWED_MIME.includes(value), { message: "formato de áudio não suportado" }),
  duration_ms: z.number().int().positive().max(150_000),
});

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function decode(value: string): Uint8Array | null {
  try {
    const binary = atob(value.replace(/^data:[^,]+,/, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response({ error: "Método não permitido" }, 405);
  const auth = req.headers.get("Authorization") ?? "";
  const client = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? "",
    { global: { headers: { Authorization: auth } } },
  );
  const { data: userData } = await client.auth.getUser();
  if (!userData.user) return response({ error: "Não autenticado" }, 401);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const existingBlock = await getAiBlock(admin);
  if (existingBlock) return response({ error: aiBlockReply(existingBlock), code: `ai_blocked_${existingBlock.status}` }, existingBlock.status);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return response({ error: parsed.error.flatten().fieldErrors }, 400);
  const bytes = decode(parsed.data.audio);
  if (!bytes || bytes.length < 256 || bytes.length > 3_000_000) return response({ error: "Áudio inválido" }, 400);
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return response({ error: "Transcrição indisponível" }, 503);
  const extension = parsed.data.mime_type.includes("aac") ? "aac" : parsed.data.mime_type.includes("ogg") ? "ogg" : parsed.data.mime_type.includes("wav") ? "wav" : parsed.data.mime_type.includes("webm") ? "webm" : "m4a";
  const form = new FormData();
  form.append("model", "openai/gpt-4o-transcribe");
  form.append("file", new Blob([bytes.buffer], { type: parsed.data.mime_type }), `gravacao.${extension}`);
  const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: `Bearer ${key}`, "X-Lovable-AIG-SDK": "edge-function" }, body: form,
  });
  if (!upstream.ok) {
    const raw = await upstream.text().catch(() => "");
    if (upstream.status === 402 || upstream.status === 403) {
      const block = await pauseAiCircuit(admin, upstream.status, raw);
      return response({ error: aiBlockReply(block ?? { status: upstream.status, requires: null, message: "" }), code: `ai_blocked_${upstream.status}` }, upstream.status);
    }
    return response({ error: raw ? raw.slice(0, 500) : "Não foi possível entender o áudio" }, upstream.status);
  }
  const result = await upstream.json().catch(() => null) as { text?: string } | null;
  const text = result?.text?.trim();
  return text ? response({ text: text.slice(0, 1500) }) : response({ error: "Áudio sem fala" }, 422);
});