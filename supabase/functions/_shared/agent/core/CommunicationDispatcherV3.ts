// CommunicationDispatcherV3 — catalogue policy + editable templates + real
// preview-safe rendering. It keeps the existing notification/outbound queues.
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { decideCommunication, type CommunicationPreferences, type DeliveryHistory } from "../../intelligence/communicationPolicy.ts";
import type { CommunicationCandidate } from "../../intelligence/contracts.ts";
import { suggestionLogicalKey } from "../../intelligence/logicalDedup.ts";


export type DispatchOutcome = {
  id: string;
  channel: string;
  status: "delivered" | "queued" | "skipped" | "failed" | "simulated";
  reason?: string;
  title?: string;
  body?: string;
};

export type SuggestionDispatchState = "dispatched" | "deferred" | "awaiting_approval" | "dismissed";

/**
 * Um adiamento de qualquer canal tem precedência sobre uma entrega parcial.
 * Assim, uma notificação criada no app durante o horário silencioso não faz o
 * alerta de WhatsApp desaparecer: a sugestão volta depois para concluir o canal.
 */
export function resolveSuggestionDispatchState(args: {
  anyQueued: boolean;
  deferUntil: string | null;
  awaitingApproval: boolean;
}): SuggestionDispatchState {
  if (args.deferUntil) return "deferred";
  if (args.anyQueued) return "dispatched";
  if (args.awaitingApproval) return "awaiting_approval";
  return "dismissed";
}

type CatalogEntry = {
  kind: string;
  active: boolean;
  allowed_channels: string[];
  requires_manual_approval: boolean;
  default_channels?: string[] | null;
  sensitivity?: string | null;
  fallback_policy?: string | null;
  min_severity_for_whatsapp?: string | null;
};

const SEVERITY_RANK: Record<string, number> = { info: 1, attention: 2, critical: 3 };

/**
 * Canal elegível vem do catálogo (tipo, sensibilidade, severidade mínima) — não
 * mais da severidade sozinha. `channel_ready` do candidato deixa de anular a
 * preferência de WhatsApp do usuário.
 */
export function catalogAllowsChannel(
  entry: CatalogEntry | undefined,
  target: "app" | "whatsapp",
  severity: string,
): { ok: boolean; reason?: string } {
  if (!entry) return { ok: true };
  if (entry.active === false) return { ok: false, reason: "kind_disabled_in_catalog" };
  const channels = (entry.default_channels?.length ? entry.default_channels : entry.allowed_channels) ?? ["app"];
  if (!channels.includes(target)) return { ok: false, reason: "channel_disabled_in_catalog" };
  if (target === "whatsapp") {
    const min = SEVERITY_RANK[String(entry.min_severity_for_whatsapp ?? "attention")] ?? 2;
    if ((SEVERITY_RANK[severity] ?? 1) < min) return { ok: false, reason: "severity_below_whatsapp_threshold" };
    if (String(entry.sensitivity ?? "normal") === "high") return { ok: false, reason: "sensitive_kind_app_only" };
  }
  return { ok: true };
}

type TemplateRow = {
  id: string;
  kind: string;
  channel: "app" | "whatsapp";
  title_template: string;
  body_template: string;
  version: number;
};

async function loadCatalog(sb: SupabaseClient): Promise<Map<string, CatalogEntry>> {
  const { data, error } = await sb.from("communication_catalog")
    .select("kind,active,allowed_channels,requires_manual_approval,default_channels,sensitivity,fallback_policy,min_severity_for_whatsapp");
  if (error) throw new Error(`communication_catalog:${error.message}`);
  const map = new Map<string, CatalogEntry>();
  for (const row of ((data as CatalogEntry[] | null) ?? [])) map.set(row.kind, row);
  return map;
}


async function loadTemplates(sb: SupabaseClient): Promise<Map<string, TemplateRow>> {
  const { data, error } = await sb.from("communication_templates")
    .select("id,kind,channel,title_template,body_template,version")
    .eq("active", true);
  if (error) throw new Error(`communication_templates:${error.message}`);
  const map = new Map<string, TemplateRow>();
  for (const row of ((data as TemplateRow[] | null) ?? [])) map.set(`${row.kind}:${row.channel}`, row);
  return map;
}

function notificationType(kind: string): string {
  if (/achievement|celebr|streak|improvement/i.test(kind)) return "achievement";
  if (/goal/i.test(kind)) return "goal_reached";
  if (/bill|recurr|due/i.test(kind)) return "recurrence_due";
  return "system";
}

function primitiveContext(candidate: CommunicationCandidate, actionUrl: string | null): Record<string, string> {
  const values: Record<string, string> = {
    title: candidate.title,
    body: candidate.body,
    kind: candidate.kind,
    severity: candidate.severity,
    dedup_key: candidate.dedup_key,
    action_url: actionUrl ?? "",
  };
  for (const [key, value] of Object.entries((candidate.evidence ?? {}) as Record<string, unknown>)) {
    if (["string", "number", "boolean"].includes(typeof value)) values[key] = String(value);
  }
  return values;
}

export function renderCommunicationTemplate(
  template: Pick<TemplateRow, "title_template" | "body_template"> | null | undefined,
  candidate: CommunicationCandidate,
  actionUrl: string | null,
): { title: string; body: string } {
  if (!template) return { title: candidate.title, body: candidate.body };
  const context = primitiveContext(candidate, actionUrl);
  const render = (value: string) => value
    .replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => context[key] ?? "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/ {2,}/g, " ")
    .trim();
  return {
    title: render(template.title_template).slice(0, 100) || candidate.title,
    body: render(template.body_template).slice(0, 1800) || candidate.body,
  };
}

async function loadPreferences(sb: SupabaseClient, userId: string): Promise<CommunicationPreferences> {
  const [prefsResp, profileResp] = await Promise.all([
    sb.from("notification_preferences")
      .select("proactive_financial,emotional_checkin,smart_tips,whatsapp_proactive,quiet_start,quiet_end,max_proactive_per_week,max_proactive_per_day,muted_proactive_kinds,timezone,quiet_behavior")
      .eq("user_id", userId).maybeSingle(),
    sb.from("profiles").select("timezone").eq("id", userId).maybeSingle(),
  ]);
  const { data, error } = prefsResp;
  if (error) throw new Error(`notification_preferences:${error.message}`);

  return {
    proactive_financial: (data as any)?.proactive_financial ?? true,
    emotional_checkin: (data as any)?.emotional_checkin ?? true,
    smart_tips: (data as any)?.smart_tips ?? true,
    whatsapp_proactive: (data as any)?.whatsapp_proactive ?? false,
    quiet_start: (data as any)?.quiet_start ?? "21:00",
    quiet_end: (data as any)?.quiet_end ?? "08:00",
    max_proactive_per_week: Number((data as any)?.max_proactive_per_week ?? 3),
    max_proactive_per_day: Number((data as any)?.max_proactive_per_day ?? 1),
    muted_proactive_kinds: Array.isArray((data as any)?.muted_proactive_kinds) ? (data as any).muted_proactive_kinds : [],
    // Fuso: preferência do usuário → perfil → fallback do produto.
    timezone: (data as any)?.timezone ?? (profileResp.data as any)?.timezone ?? null,
    quiet_behavior: (data as any)?.quiet_behavior ?? "defer",
  };

}

async function history(sb: SupabaseClient, userId: string): Promise<DeliveryHistory[]> {
  const { data, error } = await sb.from("communication_deliveries")
    .select("created_at,kind,channel,status,dedup_key")
    .eq("user_id", userId)
    .gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString())
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(`communication_history:${error.message}`);
  return (data as DeliveryHistory[] | null) ?? [];
}

async function record(sb: SupabaseClient, args: {
  user_id: string;
  suggestion_id: string;
  kind: string;
  channel: string;
  status: string;
  reason?: string;
  dedup_key?: string;
  evidence?: unknown;
  block_context?: Record<string, unknown>;
}) {
  const { error } = await sb.from("communication_deliveries").upsert({
    user_id: args.user_id,
    suggestion_id: args.suggestion_id,
    kind: args.kind,
    channel: args.channel,
    status: args.status,
    reason: args.reason ?? null,
    dedup_key: args.dedup_key ?? null,
    logical_dedup_key: args.dedup_key ? suggestionLogicalKey(args.user_id, args.dedup_key) : null,

    evidence: args.evidence ?? {},
    cost_usd: 0,
    block_context: args.block_context ?? {},
    delivered_at: args.status === "delivered" ? new Date().toISOString() : null,
  }, { onConflict: "suggestion_id,channel" });
  if (error) throw new Error(`communication_delivery:${error.message}`);
}

export async function dispatchSuggestions(
  sb: SupabaseClient,
  userId: string,
  opts: {
    channel?: "app" | "whatsapp";
    channels?: Array<"app" | "whatsapp">;
    max?: number;
    dryRun?: boolean;
  } = {},
): Promise<DispatchOutcome[]> {
  const nowIso = new Date().toISOString();
  const columns = "id,user_id,channel_ready,kind,title,body,severity,dedup_key,action,evidence";
  const limit = opts.max ?? 5;
  const [pendingResp, deferredResp] = await Promise.all([
    sb.from("pending_proactive_suggestions").select(columns)
      .eq("user_id", userId).eq("status", "pending")
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("created_at", { ascending: true }).limit(limit),
    // Adiadas voltam à fila quando a janela de silêncio/cap expira.
    sb.from("pending_proactive_suggestions").select(columns)
      .eq("user_id", userId).eq("status", "deferred")
      .lte("next_attempt_at", nowIso)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("next_attempt_at", { ascending: true }).limit(limit),
  ]);
  const error = pendingResp.error ?? deferredResp.error;
  if (error) throw new Error(`pending_suggestions:${error.message}`);

  const deferredIds = ((deferredResp.data as any[] | null) ?? []).map((row) => row.id);
  if (deferredIds.length > 0 && opts.dryRun !== true) {
    await sb.from("pending_proactive_suggestions")
      .update({ status: "pending", next_attempt_at: null, defer_reason: null })
      .in("id", deferredIds);
  }

  const rows = [
    ...(((pendingResp.data as any[] | null) ?? [])),
    ...(((deferredResp.data as any[] | null) ?? [])),
  ].slice(0, limit) as CommunicationCandidate[];

  const [prefs, recent, catalog, templates] = await Promise.all([
    loadPreferences(sb, userId),
    history(sb, userId),
    loadCatalog(sb),
    loadTemplates(sb),
  ]);
  const rollout: Array<"app" | "whatsapp"> = opts.channels?.length ? opts.channels : ["app", "whatsapp"];
  const targets: Array<"app" | "whatsapp"> = opts.channel ? [opts.channel] : ["app", "whatsapp"];
  const dryRun = opts.dryRun === true;
  const results: DispatchOutcome[] = [];

  const { data: link, error: linkError } = await sb.from("whatsapp_links")
    .select("phone_e164").eq("user_id", userId).eq("status", "active")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (linkError) throw new Error(`whatsapp_link:${linkError.message}`);

  for (const candidate of rows) {
    let anyQueued = false;
    let deferUntil: string | null = null;
    let deferReason: string | null = null;
    let awaitingApproval = false;
    for (const target of targets) {
      const entry = catalog.get(candidate.kind);
      const catalogGate = catalogAllowsChannel(entry, target, String(candidate.severity));
      const gate = !rollout.includes(target)
        ? "rollout_channel_disabled"
        : !catalogGate.ok
        ? catalogGate.reason!
        : entry?.requires_manual_approval && (candidate as unknown as { approved_at?: string }).approved_at == null
        ? "awaiting_manual_approval"
        : null;
      if (gate) {
        if (gate === "awaiting_manual_approval") awaitingApproval = true;
        if (!dryRun) {
          await record(sb, {
            user_id: userId, suggestion_id: candidate.id, kind: candidate.kind, channel: target,
            status: "suppressed", reason: gate, dedup_key: candidate.dedup_key,
            evidence: candidate.evidence, block_context: { policy_reason: gate, target },
          });
        }
        results.push({ id: candidate.id, channel: target, status: "skipped", reason: gate });
        continue;
      }


      const decision = decideCommunication({ candidate, target, preferences: prefs, history: recent });
      if (!decision.allowed) {
        if (decision.temporary) {
          // Bloqueio temporário: adia, não descarta.
          deferReason = decision.reason;
          deferUntil = decision.retryAt ?? new Date(Date.now() + 3_600_000).toISOString();
        }
        if (!dryRun) {
          await record(sb, {
            user_id: userId, suggestion_id: candidate.id, kind: candidate.kind, channel: target,
            status: "suppressed", reason: decision.reason, dedup_key: candidate.dedup_key,
            evidence: candidate.evidence,
            block_context: { policy_reason: decision.reason, target, temporary: Boolean(decision.temporary) },
          });
        }
        results.push({ id: candidate.id, channel: target, status: "skipped", reason: decision.reason });
        continue;
      }


      const actionUrl = typeof candidate.action?.route === "string" ? candidate.action.route : null;
      const template = templates.get(`${candidate.kind}:${target}`);
      const rendered = renderCommunicationTemplate(template, candidate, actionUrl);
      if (dryRun) {
        results.push({
          id: candidate.id,
          channel: target,
          status: "simulated",
          reason: template ? `template_v${template.version}` : "deterministic_fallback",
          title: rendered.title,
          body: rendered.body,
        });
        continue;
      }

      try {
        if (target === "app") {
          const logicalKey = suggestionLogicalKey(userId, candidate.dedup_key);
          // Mesmo assunto já comunicado (ex.: relatório inteligente do período)
          // não gera segunda notificação, mesmo com dedup_key de superfície
          // diferente.
          const { data: alreadyCommunicated } = await sb.from("notifications")
            .select("id").eq("user_id", userId).eq("logical_dedup_key", logicalKey).maybeSingle();
          if (alreadyCommunicated) {
            await record(sb, {
              user_id: userId, suggestion_id: candidate.id, kind: candidate.kind, channel: target,
              status: "suppressed", reason: "logical_duplicate",
              dedup_key: candidate.dedup_key, evidence: candidate.evidence,
              block_context: { policy_reason: "logical_duplicate", logical_dedup_key: logicalKey },
            });
            results.push({ id: candidate.id, channel: target, status: "skipped", reason: "logical_duplicate" });
            continue;
          }
          const { error: notificationError } = await sb.from("notifications").upsert({
            user_id: userId,
            type: notificationType(candidate.kind),
            title: rendered.title,
            body: rendered.body,
            action_url: actionUrl,
            dedup_key: `proactive:${candidate.dedup_key}`,
            logical_dedup_key: logicalKey,
          }, { onConflict: "user_id,dedup_key" });
          if (notificationError) throw notificationError;
          await record(sb, {
            user_id: userId, suggestion_id: candidate.id, kind: candidate.kind, channel: target,
            status: "delivered", reason: template ? `in_app_template_v${template.version}` : "in_app_notification_created",
            dedup_key: candidate.dedup_key, evidence: candidate.evidence,
          });
          anyQueued = true;
          results.push({ id: candidate.id, channel: target, status: "delivered", title: rendered.title, body: rendered.body });

        } else {
          if (!(link as any)?.phone_e164) {
            await record(sb, {
              user_id: userId, suggestion_id: candidate.id, kind: candidate.kind, channel: target,
              status: "suppressed", reason: "no_active_whatsapp_link",
              dedup_key: candidate.dedup_key, evidence: candidate.evidence,
              block_context: { policy_reason: "no_active_whatsapp_link", target },
            });
            results.push({ id: candidate.id, channel: target, status: "skipped", reason: "no_active_whatsapp_link" });
            continue;
          }
          const { error: outboundError } = await sb.from("outbound_messages").insert({
            user_id: userId,
            to_phone: (link as any).phone_e164,
            body: `${rendered.title}\n\n${rendered.body}`.trim(),
            provider: "waha",
            status: "queued",
            kind: "proactive",
            channel: "whatsapp",
            idempotency_key: `proactive:${candidate.id}:whatsapp`,
            context_type: "proactive_suggestion",
            context_id: candidate.id,
            surface: "whatsapp",
            feature: "proactive_communication",
            metadata: {
              suggestion_kind: candidate.kind,
              severity: candidate.severity,
              evidence: candidate.evidence,
              template_id: template?.id ?? null,
              template_version: template?.version ?? null,
            },
          });
          if (outboundError) throw outboundError;
          await record(sb, {
            user_id: userId, suggestion_id: candidate.id, kind: candidate.kind, channel: target,
            status: "queued", reason: template ? `whatsapp_template_v${template.version}` : "whatsapp_queued",
            dedup_key: candidate.dedup_key, evidence: candidate.evidence,
          });
          anyQueued = true;
          results.push({ id: candidate.id, channel: target, status: "queued", title: rendered.title, body: rendered.body });
        }
      } catch (caught) {
        const reason = String((caught as Error).message).slice(0, 160);
        await record(sb, {
          user_id: userId, suggestion_id: candidate.id, kind: candidate.kind, channel: target,
          status: "failed", reason, dedup_key: candidate.dedup_key, evidence: candidate.evidence,
        });
        results.push({ id: candidate.id, channel: target, status: "failed", reason });
      }
    }

    if (!dryRun) {
      // Adiada ≠ descartada ≠ aguardando aprovação: cada estado tem retorno próprio.
      const nextStatus = resolveSuggestionDispatchState({ anyQueued, deferUntil, awaitingApproval });
      await sb.from("pending_proactive_suggestions").update({
        status: nextStatus,
        dispatched_at: anyQueued ? new Date().toISOString() : null,
        dismissed_at: nextStatus === "dismissed" ? new Date().toISOString() : null,
        next_attempt_at: nextStatus === "deferred" ? deferUntil : null,
        defer_reason: nextStatus === "deferred" ? deferReason : null,
        logical_dedup_key: suggestionLogicalKey(userId, candidate.dedup_key),
      }).eq("id", candidate.id).eq("status", "pending");
    }

  }
  return results;
}
