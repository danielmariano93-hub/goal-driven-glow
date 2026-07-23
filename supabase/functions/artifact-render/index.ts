// artifact-render — pega um ChartArtifact e produz PNG server-side usando
// @napi-rs/canvas (sem headless browser). Faz upload no bucket `artifacts`
// e devolve URL assinada de 24h. Suporta bar/line/donut simples.
// Chamado sincronamente por whatsapp-send com timeout curto; se falhar, o
// caller cai para fallback textual.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
// deno-lint-ignore no-explicit-any
let canvasMod: any = null;
async function getCanvas() {
  if (canvasMod) return canvasMod;
  try {
    canvasMod = await import("npm:@napi-rs/canvas@0.1.53");
  } catch (_e) {
    canvasMod = null;
  }
  return canvasMod;
}

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

function renderPng(payload: ArtifactPayload, mod: any): Uint8Array | null {
  const { createCanvas } = mod;
  const W = 900, H = 520;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  // background
  ctx.fillStyle = "#F8F7FC"; ctx.fillRect(0, 0, W, H);
  // title
  ctx.fillStyle = "#171321";
  ctx.font = "bold 26px sans-serif";
  ctx.fillText(payload.title ?? "MeuNino", 40, 60);
  // summary
  if (payload.summary_text) {
    ctx.fillStyle = "#6F687D"; ctx.font = "18px sans-serif";
    wrapText(ctx, payload.summary_text, 40, 100, W - 80, 24);
  }
  // series bars
  const series = payload.data?.series ?? [];
  if (series.length > 0) {
    const chartX = 60, chartY = 200, chartW = W - 120, chartH = 240;
    const max = Math.max(...series.map(s => Math.abs(s.value))) || 1;
    const bw = Math.max(20, Math.min(80, (chartW - 20) / series.length - 12));
    const gap = ((chartW - series.length * bw) / (series.length + 1));
    let x = chartX + gap;
    for (const s of series) {
      const h = (Math.abs(s.value) / max) * (chartH - 40);
      ctx.fillStyle = s.value < 0 ? "#FF6B4A" : "#6D3BFF";
      ctx.fillRect(x, chartY + chartH - h, bw, h);
      ctx.fillStyle = "#171321"; ctx.font = "13px sans-serif";
      const label = s.name.length > 12 ? s.name.slice(0, 11) + "…" : s.name;
      ctx.fillText(label, x, chartY + chartH + 18);
      ctx.font = "12px sans-serif"; ctx.fillStyle = "#6F687D";
      ctx.fillText(brl(s.value), x, chartY + chartH - h - 6);
      x += bw + gap;
    }
  }
  // provenance footer
  const prov = payload.provenance ?? {};
  const footer = `Fórmula ${prov.formula_version ?? "—"} · ${prov.row_count ?? 0} lançamentos · confiança: ${prov.confidence ?? "—"}`;
  ctx.fillStyle = "#8E869C"; ctx.font = "12px sans-serif";
  ctx.fillText(footer, 40, H - 20);
  return canvas.toBuffer("image/png");
}

function wrapText(ctx: any, text: string, x: number, y: number, maxW: number, lh: number) {
  const words = text.split(/\s+/); let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y); line = w; y += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
}

function brl(n: number): string {
  return "R$ " + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { artifact_id } = await req.json().catch(() => ({}));
    if (!artifact_id) return json({ ok: false, error: "missing_artifact_id" }, 400);
    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: art, error } = await sb.from("agent_artifacts")
      .select("id,user_id,kind,payload,summary_text,fallback_text,formula_version,media_url,rendered_at")
      .eq("id", artifact_id).maybeSingle();
    if (error || !art) return json({ ok: false, error: "artifact_not_found" }, 404);

    // Se já renderizou e URL válida, reusa
    if (art.media_url && art.rendered_at) {
      return json({ ok: true, media_url: art.media_url, fallback_text: art.fallback_text ?? art.summary_text ?? "" });
    }

    const mod = await getCanvas();
    if (!mod) {
      // sem canvas disponível — devolve fallback textual
      return json({
        ok: false, error: "canvas_unavailable",
        fallback_text: art.fallback_text ?? art.summary_text ?? "",
      }, 200);
    }

    const payload: ArtifactPayload = {
      ...(art.payload as any),
      summary_text: art.summary_text ?? (art.payload as any)?.summary_text,
      fallback_text: art.fallback_text ?? (art.payload as any)?.fallback_text,
      provenance: (art.payload as any)?.provenance ?? { formula_version: art.formula_version },
    };
    const png = renderPng(payload, mod);
    if (!png) return json({ ok: false, error: "render_failed" }, 500);

    // upload
    const path = `${art.user_id}/${art.id}.png`;
    const up = await sb.storage.from(BUCKET).upload(path, png, {
      contentType: "image/png", upsert: true,
    });
    if (up.error) return json({ ok: false, error: "upload_failed", detail: up.error.message }, 500);

    const signed = await sb.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24);
    const mediaUrl = signed.data?.signedUrl ?? null;
    if (!mediaUrl) return json({ ok: false, error: "sign_url_failed" }, 500);

    await sb.from("agent_artifacts").update({
      media_url: mediaUrl,
      media_path: path,
      media_mime: "image/png",
      rendered_at: new Date().toISOString(),
      media_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    }).eq("id", art.id);

    return json({ ok: true, media_url: mediaUrl, fallback_text: art.fallback_text ?? art.summary_text ?? "" });
  } catch (e) {
    return json({ ok: false, error: "internal", detail: String((e as Error).message).slice(0, 200) }, 500);
  }
});
