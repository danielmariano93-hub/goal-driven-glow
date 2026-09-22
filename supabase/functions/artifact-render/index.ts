// artifact-render — renderiza ChartArtifact como PNG em TypeScript puro,
// faz upload no bucket `artifacts` e devolve URL assinada de 24h.
// Chamado sincronamente por whatsapp-send com timeout curto; se falhar,
// o caller cai para fallback textual.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { httpContext } from "../_shared/http.ts";
import { renderArtifactPng } from "../_shared/artifacts/png.ts";
import { validateChartArtifactV2 } from "../_shared/artifacts/schema.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "artifacts";

type ArtifactPayload = {
  kind: string;
  title?: string;
  summary_text?: string;
  fallback_text?: string;
  data?: {
    series?: Array<{ name: string; value: number }>;
    // deno-lint-ignore no-explicit-any
    [k: string]: any;
  };
  provenance?: { formula_version?: string; row_count?: number; confidence?: string };
};

Deno.serve(async (req) => {
  const h = httpContext("artifact-render", req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Endpoint interno: a função usa service role para ler artefatos de qualquer
  // usuário. Um JWT autenticado comum não pode atravessar esta fronteira.
  const auth = req.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${SERVICE_ROLE}`) return h.fail("unauthorized", 401);

  try {
    const { artifact_id } = await req.json().catch(() => ({}));
    if (!artifact_id) return h.fail("missing_artifact_id", 400);
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: art, error } = await sb.from("agent_artifacts")
      .select("id,user_id,kind,payload,summary_text,fallback_text,formula_version,media_url,rendered_at")
      .eq("id", artifact_id).maybeSingle();
    if (error || !art) return h.fail("artifact_not_found", 404);

    // Se já renderizou e URL válida, reusa.
    if (art.media_url && art.rendered_at) {
      return h.ok({ media_url: art.media_url, fallback_text: art.fallback_text ?? art.summary_text ?? "" });
    }

    const payload: ArtifactPayload = {
      ...(art.payload as any),
      summary_text: art.summary_text ?? (art.payload as any)?.summary_text,
      fallback_text: art.fallback_text ?? (art.payload as any)?.fallback_text,
      provenance: (art.payload as any)?.provenance ?? { formula_version: art.formula_version },
    };

    // Valida contrato antes de renderizar sem bloquear payloads v1.
    const validation = validateChartArtifactV2(art.payload);
    if (!validation.ok && validation.version === "v2") {
      console.warn("[artifact-render] v2_validation_errors", {
        artifact_id: art.id,
        errors: validation.errors.slice(0, 8),
      });
    }

    // Encoder TypeScript puro: compatível com Supabase Edge/Deno e sem
    // dependência nativa de canvas. Isso mantém o bundle bem abaixo do limite
    // de upload das Edge Functions.
    const png = await renderArtifactPng(payload as any);

    const path = `${art.user_id}/${art.id}.png`;
    const up = await sb.storage.from(BUCKET).upload(path, png, {
      contentType: "image/png",
      upsert: true,
    });
    if (up.error) {
      return h.fail("upload_failed", 500, {
        details: { reason: String(up.error.message).slice(0, 200) },
      });
    }

    const signed = await sb.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24);
    const mediaUrl = signed.data?.signedUrl ?? null;
    if (!mediaUrl) return h.fail("sign_url_failed", 500);

    await sb.from("agent_artifacts").update({
      media_url: mediaUrl,
      media_path: path,
      media_mime: "image/png",
      rendered_at: new Date().toISOString(),
      media_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    }).eq("id", art.id);

    return h.ok({
      media_url: mediaUrl,
      fallback_text: art.fallback_text ?? art.summary_text ?? "",
    });
  } catch (e) {
    return h.fail("internal", 500, {
      details: { reason: String((e as Error).message).slice(0, 200) },
    });
  }
});
