// Elegibilidade de canal pelo catálogo de comunicação (função pura). Fica fora do despachante para que o alocador de
// atenção use a MESMA regra ao decidir quem fala (nino_comm_pillars.v1) sem puxar as dependências de Deno.
export type CatalogEntry = {
  kind: string;
  active: boolean;
  allowed_channels: string[];
  requires_manual_approval: boolean;
  default_channels?: string[] | null;
  sensitivity?: string | null;
  fallback_policy?: string | null;
  min_severity_for_whatsapp?: string | null;
};

export const SEVERITY_RANK: Record<string, number> = { info: 1, attention: 2, critical: 3 };

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
