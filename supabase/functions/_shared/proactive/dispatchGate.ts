// deno-lint-ignore-file no-explicit-any
// nino_comm_pillars.v1 — o alocador passa a saber o que o despachante vai decidir (uma só regra).
// `decideCommunication` já é pura: aqui só montamos as entradas dela a partir do que o pipeline já tem.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  DEFAULT_COMMUNICATION_POLICY,
  decideCommunication,
  normalizeCommunicationPolicy,
  policyForUser,
  type CommunicationPolicySettings,
  type CommunicationPreferences,
  type DeliveryHistory,
} from "../intelligence/communicationPolicy.ts";
import { catalogAllowsChannel, type CatalogEntry } from "../intelligence/catalogGate.ts";
import type { CommunicationCandidate } from "../intelligence/contracts.ts";
import { PROACTIVE_WHATSAPP_MIN_INTERVAL_MS } from "../intelligence/proactiveWhatsappCadence.ts";
import type { FinancialSituation } from "./contracts.ts";
import type { RecentDelivery } from "./repetition.ts";

export type DispatchGateInputs = {
  preferences: CommunicationPreferences;
  policy: CommunicationPolicySettings;
  /** Catálogo de comunicação (canais e severidade mínima para WhatsApp). Ausente = não filtra por catálogo. */
  catalog?: Map<string, CatalogEntry>;
};

/** Devolve o motivo pelo qual o despachante não enviaria agora, ou null (pode enviar). */
export function makeCanDispatch(args: DispatchGateInputs & { recent: RecentDelivery[]; now?: Date }) {
  const history: DeliveryHistory[] = args.recent.map((row) => ({
    created_at: row.delivered_at,
    kind: row.kind,
    channel: row.channel,
    status: "delivered",
    dedup_key: null,
  }));
  const nowMs = (args.now ?? new Date()).getTime();
  const lastWhatsappMs = args.recent
    .filter((row) => row.channel === "whatsapp")
    .reduce((max, row) => Math.max(max, Date.parse(row.delivered_at) || 0), 0);
  return (situation: FinancialSituation, channel: "app" | "whatsapp"): string | null => {
    // 0) Cadência do WhatsApp (agent-proactive-tick): no mínimo 2h entre mensagens proativas, salvo crítico.
    if (channel === "whatsapp" && situation.severity !== "critical" && lastWhatsappMs > 0
      && nowMs - lastWhatsappMs < PROACTIVE_WHATSAPP_MIN_INTERVAL_MS) {
      return "whatsapp_global_cooldown";
    }
    // 1) Catálogo: tipo só-app ou severidade abaixo do mínimo nunca sai pelo WhatsApp (ex.: debt_progress).
    const inCatalog = catalogAllowsChannel(args.catalog?.get(situation.communication_kind), channel, situation.severity);
    if (!inCatalog.ok) return inCatalog.reason ?? "catalog_blocked";
    // 2) Política de envio (opt-outs, silêncio, cooldown de 24h do tipo, cotas e override de alta prioridade).
    const candidate: CommunicationCandidate = {
      id: situation.fingerprint,
      user_id: "",
      kind: situation.communication_kind,
      severity: situation.severity,
      title: situation.title,
      body: situation.body,
      channel_ready: "both",
      dedup_key: situation.fingerprint,
      evidence: { priority_score: situation.priority_score, impact_amount: situation.impact_amount, confidence: situation.confidence },
    };
    const decision = decideCommunication({
      candidate, target: channel, preferences: args.preferences, history, policy: args.policy, now: args.now,
    });
    return decision.allowed ? null : decision.reason;
  };
}

/** Preferências e política de envio do usuário (mesmas fontes do despachante). */
export async function loadDispatchGateInputs(sb: SupabaseClient, userId: string): Promise<DispatchGateInputs> {
  const [prefsResp, limitsResp, policyResp, catalogResp] = await Promise.all([
    sb.from("notification_preferences")
      .select("proactive_financial,emotional_checkin,smart_tips,whatsapp_proactive,quiet_start,quiet_end,max_proactive_per_week,max_proactive_per_day,muted_proactive_kinds,timezone,quiet_behavior,anticipation_enabled,anticipation_whatsapp,anticipation_kinds")
      .eq("user_id", userId).maybeSingle(),
    sb.from("proactive_global_limits").select("max_per_day,max_per_week").maybeSingle(),
    sb.from("communication_policy_settings")
      .select("pilot_mode,high_priority_threshold,critical_priority_threshold,allow_high_priority_override,high_priority_kinds,cap_behavior,quiet_hours_high_priority_behavior,attention_weights,pilot_budget_multiplier")
      .maybeSingle(),
    sb.from("communication_catalog")
      .select("kind,active,allowed_channels,requires_manual_approval,default_channels,sensitivity,fallback_policy,min_severity_for_whatsapp"),
  ]);
  const catalog = new Map<string, CatalogEntry>();
  for (const row of ((catalogResp.data as CatalogEntry[] | null) ?? [])) catalog.set(row.kind, row);
  const data = (prefsResp.data ?? {}) as any;
  const limits = (limitsResp.data ?? {}) as any;
  const globalDay = Number(limits.max_per_day ?? 1);
  const globalWeek = Number(limits.max_per_week ?? 3);
  const preferences: CommunicationPreferences = {
    proactive_financial: data.proactive_financial ?? true,
    emotional_checkin: data.emotional_checkin ?? true,
    smart_tips: data.smart_tips ?? true,
    whatsapp_proactive: data.whatsapp_proactive ?? false,
    quiet_start: data.quiet_start ?? "21:00",
    quiet_end: data.quiet_end ?? "08:00",
    max_proactive_per_week: Number(data.max_proactive_per_week ?? globalWeek),
    max_proactive_per_day: Number(data.max_proactive_per_day ?? globalDay),
    muted_proactive_kinds: Array.isArray(data.muted_proactive_kinds) ? data.muted_proactive_kinds : [],
    timezone: data.timezone ?? null,
    quiet_behavior: data.quiet_behavior ?? "defer",
    anticipation_enabled: data.anticipation_enabled ?? undefined,
    anticipation_whatsapp: data.anticipation_whatsapp ?? undefined,
    anticipation_kinds: Array.isArray(data.anticipation_kinds) ? data.anticipation_kinds : null,
  };
  const policy = policyResp.data ? normalizeCommunicationPolicy(policyResp.data) : DEFAULT_COMMUNICATION_POLICY;
  return { preferences, policy: policyForUser(policy, userId), catalog };
}
