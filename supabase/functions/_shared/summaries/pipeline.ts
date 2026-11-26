// Fluxo do resumo: pedido → gera (DTO) → desenha e valida o PDF → guarda em armazenamento privado →
// coloca na fila do WhatsApp. Estados: queued → generating → validated → sending → accepted → delivered
// (ou failed_retryable, failed_final, unknown, cancelled). Chave de deduplicação: usuário + tipo + período + canal.
// deno-lint-ignore-file no-explicit-any
import { today as civilToday } from "../finance-core/ninoClock.ts";
import { addDays, ddmm, mondayOf, monthName, rangeLabel, shiftMonth } from "./format.ts";
import { loadMonthlyInput, loadWeeklyInput } from "./loader.ts";
import { buildMonthlySummary } from "./monthly.ts";
import { renderSummaryPdf } from "./render.ts";
import type { SummaryDTO, SummaryType } from "./types.ts";
import { buildWeeklySummary } from "./weekly.ts";

export const SUMMARY_BUCKET = "financial-summaries";
/** Link assinado curto: só o tempo de o provedor baixar o arquivo. */
export const SIGNED_URL_TTL_S = 15 * 60;
export const MAX_PDF_BYTES = 1024 * 1024;

export type SummaryOrigin = "schedule" | "on_demand" | "resend" | "preview";
export type SummaryPeriod = { type: "weekly"; weekStart: string } | { type: "monthly"; month: string };

export interface ProduceRequest {
  userId: string;
  period: SummaryPeriod;
  origin: SummaryOrigin;
  channel: "whatsapp" | "none";
  requestId: string;
  timezone?: string;
  now?: Date;
}

export interface Produced { deliveryId: string; dto: SummaryDTO; storagePath: string; sizeBytes: number; sha256: string; reused: boolean }

const hexOf = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Período padrão de cada pedido (semana fechada anterior; mês fechado anterior). */
export function defaultPeriod(type: SummaryType, today: string, opts: { current?: boolean } = {}): SummaryPeriod {
  if (type === "weekly") return { type, weekStart: opts.current ? mondayOf(today) : addDays(mondayOf(today), -7) };
  return { type, month: opts.current ? today.slice(0, 7) : shiftMonth(today.slice(0, 7), -1) };
}

export function dedupeKey(userId: string, dto: Pick<SummaryDTO, "type" | "period_start" | "is_partial" | "as_of">, channel: string): string {
  return `${userId}:${dto.type}:${dto.period_start}${dto.is_partial ? `@${dto.as_of}` : ""}:${channel}`;
}

/** Texto curto que acompanha o PDF: sem números sensíveis e sem link. */
export function captionFor(dto: SummaryDTO): string {
  if (dto.type === "weekly") {
    const end = addDays(dto.period_end_exclusive, -1);
    return dto.is_partial
      ? `Seu resumo financeiro da semana (${rangeLabel(dto.period_start, dto.as_of)}) está pronto. Segue o PDF.`
      : `Seu resumo financeiro de ${rangeLabel(dto.period_start, end)} está pronto. Segue o PDF.`;
  }
  const m = monthName(dto.period_start.slice(0, 7));
  return dto.is_partial && dto.as_of < addDays(dto.period_end_exclusive, -1)
    ? `Seu resumo financeiro de ${m} até ${ddmm(dto.as_of)} está pronto. Segue o PDF.`
    : `Seu fechamento de ${m} está pronto. Segue o PDF.`;
}

export function fileNameFor(dto: SummaryDTO): string {
  return dto.type === "weekly" ? `Nino-resumo-semana-${dto.period_start}.pdf` : `Nino-resumo-${dto.period_start.slice(0, 7)}.pdf`;
}

export async function buildDto(sb: any, userId: string, period: SummaryPeriod, opts: { timezone: string; today: string; now?: Date }): Promise<SummaryDTO> {
  if (period.type === "weekly") return buildWeeklySummary(await loadWeeklyInput(sb, userId, { today: opts.today, weekStart: period.weekStart, timezone: opts.timezone, now: opts.now }));
  return buildMonthlySummary(await loadMonthlyInput(sb, userId, { today: opts.today, month: period.month, timezone: opts.timezone, now: opts.now }));
}

async function setState(sb: any, id: string, patch: Record<string, unknown>) {
  await sb.from("financial_summary_deliveries").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
}

export async function produceSummary(sb: any, req: ProduceRequest): Promise<Produced> {
  const tz = req.timezone ?? "America/Sao_Paulo";
  const today = civilToday({ timezone: tz }, req.now);
  const dto = await buildDto(sb, req.userId, req.period, { timezone: tz, today, now: req.now });
  const key = dedupeKey(req.userId, dto, req.channel);

  const { data: existing } = await sb.from("financial_summary_deliveries").select("id,status,storage_path,size_bytes,file_sha256,template_version").eq("dedupe_key", key).maybeSingle();
  // Só reaproveita o arquivo se for da mesma versão do layout (layout novo gera de novo).
  if (existing?.storage_path && existing.template_version === dto.template_version && !["failed_final", "cancelled"].includes(String(existing.status))) {
    return { deliveryId: existing.id, dto, storagePath: existing.storage_path, sizeBytes: existing.size_bytes ?? 0, sha256: existing.file_sha256 ?? "", reused: true };
  }
  const base = {
    user_id: req.userId, summary_type: dto.type, period_start: dto.period_start, period_end_exclusive: dto.period_end_exclusive, as_of: dto.as_of,
    is_partial: dto.is_partial, channel: req.channel, origin: req.origin, request_id: req.requestId, dedupe_key: key,
    template_version: dto.template_version, data_version: dto.data_version, status: "generating",
  };
  const { data: row, error } = await sb.from("financial_summary_deliveries").upsert(base, { onConflict: "dedupe_key" }).select("id").single();
  if (error || !row) throw new Error(`summary_row_failed:${error?.message ?? "none"}`);
  const id = row.id as string;

  try {
    const r = await renderSummaryPdf(dto);
    if (r.pages !== 1 || r.sizeBytes > MAX_PDF_BYTES || r.issues.length) {
      await setState(sb, id, { status: "failed_final", error_code: "render_validation", error_details: JSON.stringify({ pages: r.pages, size: r.sizeBytes, issues: r.issues }).slice(0, 500) });
      throw new Error("summary_render_validation");
    }
    const sha = hexOf(await crypto.subtle.digest("SHA-256", r.bytes));
    const path = `${req.userId}/${dto.type}/${dto.period_start}${dto.is_partial ? `_${dto.as_of}` : ""}_${sha.slice(0, 12)}.pdf`;
    const up = await sb.storage.from(SUMMARY_BUCKET).upload(path, r.bytes, { contentType: "application/pdf", upsert: true });
    if (up.error) { await setState(sb, id, { status: "failed_retryable", error_code: "storage_upload", error_details: String(up.error.message).slice(0, 300) }); throw new Error("summary_storage_upload"); }
    await setState(sb, id, {
      status: "validated", storage_path: path, size_bytes: r.sizeBytes, file_sha256: sha, error_code: null, error_details: null,
      metadata: { insight: dto.insight.rule_id, insight_kind: dto.insight.kind, action: dto.action.rule_id, quality_flags: dto.quality_flags, report_id: dto.report_id, generated_at: dto.generated_at },
    });
    return { deliveryId: id, dto, storagePath: path, sizeBytes: r.sizeBytes, sha256: sha, reused: false };
  } catch (e) {
    const msg = (e as Error).message;
    if (!msg.startsWith("summary_")) await setState(sb, id, { status: "failed_retryable", error_code: "generation_error", error_details: msg.slice(0, 300) });
    throw e;
  }
}

/** Coloca o PDF na fila do WhatsApp (o envio real é feito pelo `whatsapp-send`). */
export async function queueWhatsappSummary(sb: any, p: Produced, opts: { userId: string; requestId: string; inboundMessageId?: string | null }): Promise<{ outboundId: string | null; skipped?: string }> {
  const { data: link } = await sb.from("whatsapp_links").select("phone_e164").eq("user_id", opts.userId).eq("status", "active").maybeSingle();
  if (!link?.phone_e164) {
    await setState(sb, p.deliveryId, { status: "cancelled", error_code: "no_active_whatsapp_link" });
    return { outboundId: null, skipped: "no_active_whatsapp_link" };
  }
  const { data: msg, error } = await sb.from("outbound_messages").insert({
    channel: "whatsapp", user_id: opts.userId, to_phone: link.phone_e164, body: captionFor(p.dto), status: "queued",
    kind: p.dto.type === "weekly" ? "weekly_summary_pdf" : "monthly_summary_pdf", feature: "financial_summary",
    idempotency_key: `financial_summary:${p.deliveryId}:${opts.requestId}`, context_type: "financial_summary", context_id: p.deliveryId,
    inbound_message_id: opts.inboundMessageId ?? null, media_mime: "application/pdf", media_status: "pending", next_attempt_at: new Date().toISOString(),
    metadata: { summary_delivery_id: p.deliveryId, storage_bucket: SUMMARY_BUCKET, storage_path: p.storagePath, filename: fileNameFor(p.dto), template_version: p.dto.template_version },
  }).select("id").maybeSingle();
  if (error) {
    await setState(sb, p.deliveryId, { status: "failed_retryable", error_code: "enqueue_failed", error_details: String(error.message).slice(0, 300) });
    return { outboundId: null, skipped: "enqueue_failed" };
  }
  await setState(sb, p.deliveryId, { status: "sending", outbound_message_id: msg?.id ?? null, recipient_hint: String(link.phone_e164).slice(-4) });
  return { outboundId: msg?.id ?? null };
}

/** Flag por usuário (desligada por padrão). */
export async function summariesEnabled(sb: any, userId: string): Promise<boolean> {
  const { data } = await sb.from("financial_feature_flags").select("use_whatsapp_pdf_summaries").eq("user_id", userId).maybeSingle();
  return data?.use_whatsapp_pdf_summaries === true;
}
