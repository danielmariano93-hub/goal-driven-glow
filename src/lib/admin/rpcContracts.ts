/**
 * Contratos declarados das RPCs administrativas.
 *
 * Cada RPC `admin_*` tem uma assinatura fixa no banco. Enviar um argumento
 * que a função não declara faz o PostgREST responder 404/PGRST202 e derruba a
 * tela inteira — foi exatamente a regressão do Cockpit (`_tz` enviado para
 * `admin_v2_cockpit`, que só aceita `_from`/`_to`).
 *
 * Este registro é a fonte única da verdade no frontend: `buildArgs` remove
 * qualquer chave não declarada antes da chamada.
 */

export const ADMIN_TZ = "America/Sao_Paulo";

/** Assinaturas reais (validadas contra `pg_get_function_identity_arguments`). */
export const ADMIN_RPC_ARGS = {
  admin_v2_cockpit: ["_from", "_to"],
  admin_v2_metrics_universe: [],
  admin_v2_client_profile: ["_pseudo_id"],
  admin_v2_daily_evolution: ["_from", "_to", "_tz"],
  admin_v2_growth_summary: ["_from", "_to", "_tz"],
  admin_v2_growth_funnel: ["_from", "_to", "_tz"],
  admin_v2_growth_cohorts: ["_from", "_to", "_tz"],
  admin_v2_clients_list: ["_from", "_to", "_tz", "_limit", "_lifecycle", "_financial"],
  admin_v2_clients_identity: ["_pseudo_ids"],
  admin_v2_clients_identity_masked: ["_pseudo_ids"],
  admin_v2_operations_health: ["_hours"],
  admin_v2_contract_health: [],
  admin_v2_assistant_health: ["_days"],
  admin_v2_ia_ocr_metrics: ["_days"],
  admin_v2_whatsapp_monitor: ["_days"],
  admin_v2_message_intelligence: ["_days"],
  admin_v2_messaging_activity: ["_days"],
  admin_v2_nino_quality_summary: ["_days"],
  admin_v2_insight_effectiveness: ["_days"],
  admin_v2_proactive_summary: ["_days", "_channel", "_kind"],
  admin_v2_product_features: ["_from", "_to", "_tz"],
  admin_v2_product_opportunities: ["_from", "_to", "_tz"],
  admin_v2_revenue_summary: ["_from", "_to", "_tz"],
  admin_v2_governance_summary: [],
  admin_v2_audit_list: ["_limit"],
  admin_v2_metrics_audit: [],
  admin_v2_retry_failed_outbound: ["_limit"],
  admin_communication_catalog: [],
  admin_communication_catalog_update: [
    "_kind",
    "_active",
    "_base_priority",
    "_allowed_channels",
    "_cooldown_hours",
    "_max_per_day",
    "_requires_manual_approval",
    "_default_channels",
    "_min_severity_for_whatsapp",
    "_sensitivity",
    "_default_window_hours",
    "_whatsapp_min_absolute_impact",
  ],
  admin_reminder_settings: [],
  admin_reminder_settings_update: [
    "_emotional_enabled",
    "_emotional_hour",
    "_emotional_requires_activity",
    "_emotional_channels",
    "_care_max_per_day",
    "_care_max_per_week",
  ],
  admin_emotion_finance_config: [],
  admin_emotion_finance_config_update: [
    "_window_days",
    "_min_sample",
    "_min_composite_sample",
    "_min_uplift_pct",
    "_min_delta_abs",
    "_lookback_days",
    "_prospective_enabled",
    "_prospective_channels",
  ],
  admin_communication_templates: ["_kind"],
  admin_communication_template_upsert: [
    "_kind",
    "_channel",
    "_title_template",
    "_body_template",
    "_active",
  ],
  admin_proactive_engine_status: [],
  admin_proactive_engine_toggle: ["_enabled", "_channels"],
  admin_proactive_queue: ["_limit"],
  admin_ai_model_routes: [],
  admin_ai_model_route_update: ["_task", "_primary_model", "_fallback_model", "_max_latency_ms", "_max_steps", "_active"],
  admin_agent_knowledge_list: [],
  admin_agent_knowledge_upsert: ["_id", "_key", "_title", "_category", "_content", "_source_url", "_active"],
  admin_split_reminder_policy: [],
  admin_split_reminder_policy_update: [
    "_enabled", "_due_soon_days_before", "_due_today_enabled", "_first_overdue_days",
    "_repeat_every_days", "_max_overdue_reminders", "_send_hour", "_pause_on_reply",
  ],
} as const;

export type AdminRpcName = keyof typeof ADMIN_RPC_ARGS;

export function isKnownAdminRpc(fn: string): fn is AdminRpcName {
  return Object.prototype.hasOwnProperty.call(ADMIN_RPC_ARGS, fn);
}

/**
 * Filtra os argumentos para o que a RPC realmente declara.
 * Chaves com valor `undefined` são descartadas (o banco aplica o default).
 */
export function buildArgs(
  fn: string,
  args: Record<string, unknown> = {},
): Record<string, unknown> {
  if (!isKnownAdminRpc(fn)) return { ...args };
  const allowed = ADMIN_RPC_ARGS[fn] as readonly string[];
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in args && args[key] !== undefined) out[key] = args[key];
  }
  return out;
}

/** Retorna as chaves que seriam descartadas — usado em testes e diagnóstico. */
export function unsupportedArgs(fn: string, args: Record<string, unknown> = {}): string[] {
  if (!isKnownAdminRpc(fn)) return [];
  const allowed = new Set<string>(ADMIN_RPC_ARGS[fn] as readonly string[]);
  return Object.keys(args).filter((k) => !allowed.has(k));
}
