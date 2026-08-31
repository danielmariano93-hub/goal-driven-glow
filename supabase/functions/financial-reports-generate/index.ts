// Edge function: financial-reports-generate
// Gera Relatórios Financeiros Inteligentes (semanal/mensal) com números
// determinísticos de finance_contract.v2 + reports_catalog.v1, texto validado
// por guardrail numérico e entrega por app (notificação) e WhatsApp (fila).
//
// Modos:
//   - cron  : header x-cron-secret; varre usuários elegíveis e grava heartbeat.
//   - user  : JWT do dono; gera/regenera o próprio relatório (on-demand).
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { fail, respond } from "../_shared/http.ts";
import { writeJobHeartbeat } from "../_shared/heartbeats.ts";
import { periodReviewKey } from "../_shared/intelligence/logicalDedup.ts";

import { resolveAppPublicUrl } from "../_shared/messaging/appUrl.ts";
import { buildShortLink } from "../_shared/agent/core/ShortLinks.ts";
import type { TransactionRow } from "../_shared/finance-core/facts.ts";
import { buildIntelligentReport } from "../_shared/reports-core/engine.ts";
import { resolvePeriods } from "../_shared/reports-core/periods.ts";
import { collectAllowedNumbers, validateNumbers } from "../_shared/reports-core/numericGuard.ts";
import {
  deterministicClosing,
  deterministicSummary,
  whatsappMessage,
} from "../_shared/reports-core/narrative.ts";
import { REPORT_TEMPLATE_VERSION } from "../_shared/reports-core/types.ts";
import type { IntelligentReport, ReportType } from "../_shared/reports-core/types.ts";
import { buildCatalogHighlights } from "./catalogHighlights.ts";
import { getAiBlock, pauseAiCircuit } from "../_shared/aiCircuit.ts";


const FN = "financial-reports-generate";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("INTERNAL_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") ?? "";
const APP_PUBLIC_URL = Deno.env.get("APP_PUBLIC_URL") ?? "";
const MODEL = "openai/gpt-5.6-sol";
const AI_TIMEOUT_MS = 12000;

function logEvent(event: Record<string, unknown>) {
  try { console.log(JSON.stringify({ fn: FN, ...event })); } catch { /* noop */ }
}

type Sb = SupabaseClient;

/**
 * Carrega os lançamentos necessários (período + anterior + margem).
 *
 * `competence_date` é obrigatória: o relatório agrega pela competência canônica
 * (cartão pelo mês da fatura). Sem essa coluna o cálculo degradaria em silêncio
 * para a data da compra e voltaria a divergir do Nino — por isso a ausência é
 * erro explícito, não fallback.
 *
 * A janela recua `COMPETENCE_MARGIN_DAYS` antes do início porque uma compra de
 * cartão feita no ciclo anterior tem competência DENTRO do período do relatório.
 */
const COMPETENCE_MARGIN_DAYS = 75;

function shiftDays(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

async function loadTransactions(sb: Sb, userId: string, fromDate: string): Promise<TransactionRow[]> {
  const { data, error } = await sb
    .from("transactions")
    .select("id,account_id,type,status,amount,occurred_at,competence_date,category_id,refund_of_transaction_id,transfer_group_id,payment_method,credit_card_id,settles_card_id,movement_kind,origin,installments_total,description,friendly_description")
    .eq("user_id", userId)
    .gte("occurred_at", shiftDays(fromDate, -COMPETENCE_MARGIN_DAYS))
    .order("occurred_at", { ascending: true })
    .limit(8000);
  if (error) throw new Error(`load_transactions:${error.message}`);
  const rows = (data ?? []) as unknown as TransactionRow[];
  if (rows.length > 0 && !("competence_date" in (rows[0] as Record<string, unknown>))) {
    throw new Error("load_transactions:missing_competence_date");
  }
  return rows;
}

async function loadContext(sb: Sb, userId: string) {
  const [cats, accounts, snapshots, goals, contributions] = await Promise.all([
    // Categorias globais (user_id IS NULL) precisam entrar: a maioria dos
    // lançamentos aponta para elas e sem isso tudo virava "Sem categoria".
    sb.from("categories").select("id,name").or(`user_id.eq.${userId},user_id.is.null`),

    sb.from("accounts").select("id,name,type,opening_balance,is_active").eq("user_id", userId),
    sb.from("account_balance_snapshots").select("account_id,balance,balance_date,status,anchor_kind,source_document_id,reconciliation_delta").eq("user_id", userId),
    sb.from("goals").select("id,name,target_amount,status,due_date").eq("user_id", userId),
    sb.from("goal_contributions").select("goal_id,amount").eq("user_id", userId),
  ]);
  const categoryNames: Record<string, string> = {};
  for (const c of (cats.data ?? []) as Array<{ id: string; name: string }>) categoryNames[c.id] = c.name;
  return {
    categoryNames,
    accounts: (accounts.data ?? []) as never[],
    balanceSnapshots: (snapshots.data ?? []) as never[],
    goals: (goals.data ?? []) as never[],
    goalContributions: (contributions.data ?? []) as Array<{ goal_id: string; amount: number }>,
  };
}

/** Texto do relatório via Lovable AI Gateway, validado pelo guardrail. */
async function synthesizeNarrative(sb: Sb, report: IntelligentReport): Promise<{
  summary: string; closing: string; source: "ai" | "deterministic"; fallbackReason: string | null;
}> {
  const deterministic = {
    summary: deterministicSummary(report),
    closing: deterministicClosing(report),
    source: "deterministic" as const,
    fallbackReason: null as string | null,
  };
  if (!LOVABLE_API_KEY) return { ...deterministic, fallbackReason: "missing_api_key" };
  if (await getAiBlock(sb)) return { ...deterministic, fallbackReason: "ai_circuit_paused" };

  const allowed = collectAllowedNumbers({
    metrics: report.metrics,
    highlights: report.highlights.map((h) => h.evidence),
    totals: report.payload.totals,
    categories: report.payload.categories,
    health: report.healthScore,
    breakdown: report.healthBreakdown,
  });

  const facts = {
    periodo: report.period.label,
    periodo_anterior: report.previousPeriod.label,
    tipo: report.reportType === "weekly" ? "semanal" : report.reportType === "monthly_partial" ? "mensal parcial (mês aberto)" : "mensal",
    nota_saude: report.healthScore,
    totais: report.payload.totals,
    top_categorias: report.payload.categories.slice(0, 5),
    destaques: report.highlights.map((h) => ({ titulo: h.title, corpo: h.body })),
    qualidade: report.dataQualityFlags,
  };

  const system = [
    "Você é o Nino, assessor financeiro pessoal brasileiro.",
    "Escreva em português do Brasil, tom claro, adulto e acolhedor, sem jargão e sem emojis.",
    "REGRA ABSOLUTA: use SOMENTE os números presentes no JSON de fatos. Nunca calcule, estime, arredonde de forma diferente ou invente valores.",
    "Não prometa funcionalidades. Não use provas sociais.",
    "Responda em JSON puro: {\"summary\": string, \"closing\": string}.",
    "summary: até 3 frases, com uma conclusão principal e no máximo 3 números. closing: 1 frase com o próximo passo mais útil.",
  ].join(" ");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": LOVABLE_API_KEY },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: "none",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(facts) },
        ],
      }),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 200);
      if (res.status === 402 || res.status === 403) await pauseAiCircuit(sb, res.status, detail);
      logEvent({ event: "ai_error", status: res.status, detail });
      return { ...deterministic, fallbackReason: `gateway_${res.status}` };
    }
    const payload = await res.json();
    const raw = payload?.choices?.[0]?.message?.content ?? "";
    let parsed: { summary?: string; closing?: string } = {};
    try { parsed = JSON.parse(raw); } catch { return { ...deterministic, fallbackReason: "invalid_json" }; }
    const summary = String(parsed.summary ?? "").trim();
    const closing = String(parsed.closing ?? "").trim();
    if (!summary || !closing) return { ...deterministic, fallbackReason: "empty_text" };
    const guard = validateNumbers(`${summary}\n${closing}`, allowed);
    if (!guard.ok) {
      logEvent({ event: "numeric_guard_block", offending: guard.offending.slice(0, 8) });
      return { ...deterministic, fallbackReason: `numeric_guard:${guard.offending.slice(0, 3).join(",")}` };
    }
    return { summary, closing, source: "ai", fallbackReason: null };
  } catch (e) {
    return { ...deterministic, fallbackReason: `ai_exception:${(e as Error).message}`.slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

function reportLink(reportId: string): string | null {
  const base = resolveAppPublicUrl({ APP_PUBLIC_URL });
  if (!base) return null;
  return `${base}/app/relatorios-inteligentes/${reportId}?ref=wa_report`;
}

type Prefs = {
  weekly_report_enabled: boolean;
  monthly_report_enabled: boolean;
  report_channel: "app" | "whatsapp" | "both";
  report_timezone: string;
};

async function loadPrefs(sb: Sb, userId: string): Promise<Prefs> {
  const { data } = await sb
    .from("notification_preferences")
    .select("weekly_report_enabled,monthly_report_enabled,report_channel,report_timezone")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    weekly_report_enabled: data?.weekly_report_enabled ?? true,
    monthly_report_enabled: data?.monthly_report_enabled ?? true,
    report_channel: (data?.report_channel ?? "both") as Prefs["report_channel"],
    report_timezone: data?.report_timezone ?? "America/Sao_Paulo",
  };
}

async function generateForUser(
  sb: Sb,
  userId: string,
  reportType: ReportType,
  opts: { force?: boolean; requestId: string; customPeriod?: { start: string; end: string } },
): Promise<{ report_id: string | null; status: string; skipped?: string }> {
  const prefs = await loadPrefs(sb, userId);
  if (!opts.force) {
    if (reportType === "weekly" && !prefs.weekly_report_enabled) return { report_id: null, status: "skipped", skipped: "weekly_disabled" };
    if (reportType === "monthly" && !prefs.monthly_report_enabled) return { report_id: null, status: "skipped", skipped: "monthly_disabled" };
  }

  const reference = new Date();
  const { period, previous } = resolvePeriods(reportType, reference, opts.customPeriod);
  // Guarda de contrato: se o motor de períodos ignorar o intervalo pedido
  // (espelho fora de sincronia), falhamos alto em vez de gravar outro período.
  if (reportType === "custom") {
    const asked = opts.customPeriod;
    if (!asked || period.start !== asked.start || period.end !== asked.end) {
      throw new Error(
        `custom_period_mismatch: pedido ${asked?.start ?? "-"}..${asked?.end ?? "-"} resolvido ${period.start}..${period.end}`,
      );
    }
  }
  const idempotencyKey = reportType === "custom"
    ? `custom:${userId}:${period.start}:${period.end}`
    : `${reportType}:${userId}:${period.start}`;


  // Período livre pode repetir o dia de início com fins diferentes: a chave
  // única inclui o fim do intervalo.
  let existingQuery = sb
    .from("financial_reports")
    .select("id,status,template_version")
    .eq("user_id", userId)
    .eq("report_type", reportType)
    .eq("period_start", period.start);
  if (reportType === "custom") existingQuery = existingQuery.eq("period_end", period.end);
  const { data: existing } = await existingQuery.maybeSingle();
  // Relatório de template antigo é regenerado sozinho (auto-heal de destaques).
  const staleTemplate = !!existing && existing.template_version !== REPORT_TEMPLATE_VERSION;
  // Mês corrente nunca é reaproveitado: o período segue aberto e os números
  // mudam a cada lançamento.
  const isPartial = reportType === "monthly_partial";
  if (existing && !opts.force && !staleTemplate && !isPartial) {
    return { report_id: existing.id as string, status: "exists" };
  }


  const transactions = await loadTransactions(sb, userId, previous.start);
  const ctx = await loadContext(sb, userId);
  const baseInput = {
    reportType,
    referenceDate: reference,
    customPeriod: opts.customPeriod,
    transactions,
    categoryNames: ctx.categoryNames,
    accounts: ctx.accounts,
    balanceSnapshots: ctx.balanceSnapshots,
    goals: ctx.goals,
    goalContributions: ctx.goalContributions,
    timezone: prefs.report_timezone,
  };
  // 1ª passada: números do período. 2ª passada: destaques do período mesclados
  // com o catálogo determinístico de insights (insights_catalog.v1).
  const base = buildIntelligentReport(baseInput);
  const extraHighlights = await buildCatalogHighlights(sb, userId, base.payload, transactions, reference);
  const report = extraHighlights.length > 0
    ? buildIntelligentReport({ ...baseInput, extraHighlights })
    : base;


  const narrative = await synthesizeNarrative(sb, report);

  const row = {
    user_id: userId,
    report_type: reportType,
    period_start: period.start,
    period_end: period.end,
    timezone: prefs.report_timezone,
    status: "published",
    published_at: new Date().toISOString(),
    generated_at: new Date().toISOString(),
    insight_catalog_version: report.catalogVersion,
    template_version: report.templateVersion,
    health_score: report.healthScore,
    health_breakdown: report.healthBreakdown,
    executive_summary: narrative.summary,
    closing_text: narrative.closing,
    text_source: narrative.source,
    text_fallback_reason: narrative.fallbackReason,
    data_quality_status: report.dataQualityStatus,
    data_quality_flags: report.dataQualityFlags,
    payload: report.payload,
    request_id: opts.requestId,
    idempotency_key: idempotencyKey,
  };

  let reportId: string;
  if (existing?.id) {
    const { error } = await sb.from("financial_reports").update(row).eq("id", existing.id);
    if (error) throw new Error(`update_report:${error.message}`);
    reportId = existing.id as string;
    await sb.from("financial_report_metrics").delete().eq("report_id", reportId);
    await sb.from("financial_report_highlights").delete().eq("report_id", reportId);
  } else {
    const { data, error } = await sb.from("financial_reports").insert(row).select("id").single();
    if (error) throw new Error(`insert_report:${error.message}`);
    reportId = data.id as string;
  }

  const metricRows = report.metrics.map((m) => ({
    report_id: reportId,
    metric_key: m.key,
    metric_label: m.label,
    metric_value: m.value,
    metric_text: m.text ?? null,
    comparison_value: m.comparison ?? null,
    comparison_percentage: m.comparisonPct ?? null,
    unit: m.unit,
    evidence: m.evidence ?? {},
    sort_order: m.order,
  }));
  if (metricRows.length > 0) {
    const { error } = await sb.from("financial_report_metrics").insert(metricRows);
    if (error) logEvent({ event: "metrics_insert_error", err: error.message });
  }

  const highlightRows = report.highlights.map((h, i) => ({
    report_id: reportId,
    detector_key: h.detectorKey,
    type: h.type,
    title: h.title,
    body: h.body,
    priority: h.priority,
    confidence: h.confidence,
    category: h.category ?? null,
    evidence: { ...h.evidence, insight_family: h.family ?? h.detectorKey, insight_source: h.source ?? "period" },
    cta_label: h.ctaLabel ?? null,
    cta_route: h.ctaRoute ?? null,
    dedup_key: h.dedupKey,
    selection_reason: h.selectionReason,
    sort_order: i,
  }));
  if (highlightRows.length > 0) {
    const { error } = await sb.from("financial_report_highlights").insert(highlightRows);
    if (error) logEvent({ event: "highlights_insert_error", err: error.message });
  }

  // ---------------- entrega app (notificação) ----------------
  const wantsApp = prefs.report_channel === "app" || prefs.report_channel === "both";
  if (wantsApp) {
    await sb.from("notifications").insert({
      user_id: userId,
      type: "financial_report",
      title: reportType === "weekly"
        ? "Seu relatório da semana está pronto"
        : reportType === "monthly_partial"
          ? "Seu mês até agora está pronto"
          : reportType === "custom"
            ? "Seu relatório do período está pronto"
            : "Seu relatório do mês está pronto",
      body: `${period.label} • nota de saúde ${report.healthScore}/10`,
      action_url: `/app/relatorios-inteligentes/${reportId}`,
      dedup_key: `financial_report:${reportId}`,
      // Relatório e revisão do mesmo período são o mesmo assunto: quem chegar
      // primeiro comunica, o outro é suprimido pela chave lógica.
      logical_dedup_key: periodReviewKey(reportType, userId, period.start),
    });

    await sb.from("financial_report_deliveries").upsert({
      report_id: reportId,
      user_id: userId,
      channel: "app",
      status: "delivered",
      delivered_at: new Date().toISOString(),
      attempt_count: 1,
      last_attempt_at: new Date().toISOString(),
    }, { onConflict: "report_id,channel" });
  }

  // ---------------- entrega WhatsApp (fila) ----------------
  const wantsWhatsApp = prefs.report_channel === "whatsapp" || prefs.report_channel === "both";
  if (wantsWhatsApp) {
    const { data: link } = await sb
      .from("whatsapp_links")
      .select("phone_e164")
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    const phone = link?.phone_e164 ?? null;
    if (!phone) {
      await sb.from("financial_report_deliveries").upsert({
        report_id: reportId, user_id: userId, channel: "whatsapp",
        status: "skipped", error_code: "no_active_whatsapp_link",
      }, { onConflict: "report_id,channel" });
    } else {
      // Link curto: URL longa com parâmetros parece spam no WhatsApp.
      const longLink = reportLink(reportId);
      const short = await buildShortLink(sb, {
        user_id: userId,
        path: `/app/relatorios-inteligentes/${reportId}?ref=wa_report`,
        kind: "financial_report",
        ttl_days: 90,
      });
      const body = whatsappMessage(report, short.shortened ? short.url : longLink);
      const { data: msg, error } = await sb.from("outbound_messages").insert({
        channel: "whatsapp",
        user_id: userId,
        to_phone: phone,
        body,
        status: "queued",
        kind: reportType === "weekly" ? "weekly_report" : "monthly_report",
        idempotency_key: `financial_report:${reportId}`,
        context_type: "financial_report",
        context_id: reportId,
        next_attempt_at: new Date().toISOString(),
        metadata: { origin: FN, report_type: reportType, period_start: period.start },
      }).select("id").maybeSingle();
      await sb.from("financial_report_deliveries").upsert({
        report_id: reportId,
        user_id: userId,
        channel: "whatsapp",
        recipient: phone,
        status: error ? "failed" : "queued",
        provider_message_id: msg?.id ?? null,
        attempt_count: 1,
        last_attempt_at: new Date().toISOString(),
        error_code: error ? String(error.code ?? "enqueue_failed") : null,
        error_details: error ? String(error.message).slice(0, 200) : null,
      }, { onConflict: "report_id,channel" });
    }
  }

  logEvent({
    event: "report_generated",
    user_id: userId,
    report_id: reportId,
    report_type: reportType,
    text_source: narrative.source,
    fallback_reason: narrative.fallbackReason,
    health_score: report.healthScore,
    highlights: report.highlights.length,
  });

  return { report_id: reportId, status: "published" };
}

async function eligibleUserIds(sb: Sb, only: string | null): Promise<string[]> {
  if (only) return [only];
  const { data, error } = await sb.from("profiles").select("id").limit(2000);
  if (error) throw new Error(`load_users:${error.message}`);
  return (data ?? []).map((r: { id: string }) => r.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronHeader = req.headers.get("x-cron-secret") ?? "";
  const isCron = CRON_SECRET !== "" && cronHeader === CRON_SECRET;
  const auth = req.headers.get("Authorization") ?? "";
  if (!isCron && !auth.startsWith("Bearer ")) return fail("unauthorized", { status: 401, functionName: FN });

  let body: {
    report_type?: ReportType; user_id?: string; force?: boolean; mode?: string;
    period_start?: string; period_end?: string;
  } = {};
  try { body = (await req.json()) ?? {}; } catch { /* empty ok */ }
  // `monthly_partial` = relatório do mês corrente (aberto), sempre sob demanda.
  // `custom` = intervalo livre pedido pelo usuário (nunca vem do cron).
  const reportType: ReportType = body.report_type === "monthly"
    ? "monthly"
    : body.report_type === "monthly_partial"
      ? "monthly_partial"
      : body.report_type === "custom"
        ? "custom"
        : "weekly";

  let customPeriod: { start: string; end: string } | undefined;
  if (reportType === "custom") {
    if (isCron) return fail("custom_requires_user", { status: 400, functionName: FN });
    const start = String(body.period_start ?? "");
    const end = String(body.period_end ?? "");
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    if (!ymd.test(start) || !ymd.test(end)) {
      return fail("invalid_period", { status: 400, functionName: FN, message: "Informe as datas de início e fim do período." });
    }
    if (end < start) {
      return fail("invalid_period", { status: 400, functionName: FN, message: "A data final não pode ser anterior à inicial." });
    }
    const todayYmd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    if (end > todayYmd) {
      return fail("invalid_period", { status: 400, functionName: FN, message: "Ainda não é possível fechar um período no futuro." });
    }
    const spanDays = Math.round(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000,
    ) + 1;
    if (spanDays > 366) {
      return fail("invalid_period", { status: 400, functionName: FN, message: "Escolha um período de até 366 dias." });
    }
    customPeriod = { start, end };
  }
  const requestId = crypto.randomUUID();
  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const started = Date.now();

  if (isCron) {
    let processed = 0;
    let failed = 0;
    const jobKey = `financial-reports-${reportType}`;
    try {
      const targets = await eligibleUserIds(sb, body.user_id ?? null);
      for (const uid of targets) {
        try {
          await generateForUser(sb, uid, reportType, { requestId });
          processed++;
        } catch (e) {
          failed++;
          logEvent({ event: "cron_user_error", user_id: uid, err: (e as Error).message });
        }
      }
      await writeJobHeartbeat({
        jobKey, ok: failed === 0, processed, failed,
        errorCode: failed > 0 ? "partial_user_failures" : null,
        sb,
      });
      logEvent({ event: "cron_done", report_type: reportType, processed, failed, latency_ms: Date.now() - started });
      return respond({ processed, failed, report_type: reportType });
    } catch (e) {
      await writeJobHeartbeat({
        jobKey, ok: false, processed, failed: failed + 1,
        errorCode: ((e as Error).message ?? "cron_error").slice(0, 120), sb,
      });
      return fail("cron_failed", { status: 500, functionName: FN });
    }
  }

  // modo usuário: identidade vem do JWT
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(auth.replace("Bearer ", ""));
  if (userErr || !userData?.user) return fail("unauthorized", { status: 401, functionName: FN });

  try {
    const result = await generateForUser(sb, userData.user.id, reportType, {
      force: body.force === true,
      requestId,
      customPeriod,
    });
    return respond(result);
  } catch (e) {
    logEvent({ event: "user_generate_error", err: (e as Error).message });
    return fail("report_generation_failed", { status: 500, functionName: FN, details: { message: (e as Error).message } });
  }
});
