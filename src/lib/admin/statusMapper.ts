// Central mapper for admin operational statuses.
// Frontend must NEVER render raw backend codes; always route through here.

export type Tone = "success" | "warn" | "danger" | "neutral" | "info";

export type StatusView = {
  label: string;
  tone: Tone;
  impact?: string;
};

const WHATSAPP: Record<string, StatusView> = {
  connected: { label: "Conectado", tone: "success", impact: "O assistente pode conversar pelo WhatsApp normalmente." },
  awaiting_qr: { label: "Aguardando leitura do QR Code", tone: "info", impact: "Escaneie o código no aparelho para concluir a conexão." },
  connecting: { label: "Conectando", tone: "info", impact: "A conexão está sendo estabelecida." },
  disconnected: { label: "Desconectado", tone: "warn", impact: "O assistente não pode responder pelo WhatsApp agora." },
  needs_attention: { label: "Atenção necessária", tone: "warn", impact: "Alguma verificação falhou. Tente reconectar." },
  unavailable: { label: "Não foi possível verificar agora", tone: "warn", impact: "Tente novamente em instantes." },
  not_configured: { label: "Integração ainda não concluída", tone: "neutral", impact: "Revise a conexão para ativar o canal." },
};

const AGENT: Record<string, StatusView> = {
  working: { label: "Funcionando", tone: "success", impact: "O assistente está respondendo normalmente." },
  attention: { label: "Atenção necessária", tone: "warn", impact: "Algo pode estar limitando as respostas." },
  unavailable: { label: "Indisponível", tone: "danger", impact: "O assistente está fora do ar temporariamente." },
  not_setup: { label: "Ainda não configurado", tone: "neutral", impact: "Publique uma versão de comportamento para ativar o assistente." },
};

const JOB: Record<string, StatusView> = {
  healthy: { label: "Saudável", tone: "success" },
  delayed: { label: "Atrasado", tone: "warn", impact: "A automação está executando com atraso." },
  failing: { label: "Com falha", tone: "danger", impact: "As últimas execuções falharam." },
  idle: { label: "Sem atividade", tone: "neutral", impact: "Rodou recentemente, mas não havia nada para processar." },
  not_scheduled: { label: "Automação ainda não ativada", tone: "neutral", impact: "Nunca foi executada. Configure a automação internamente." },
};

const FALLBACK: StatusView = { label: "Não foi possível verificar agora", tone: "warn" };

export function mapWhatsAppStatus(code: string | null | undefined): StatusView {
  if (!code) return FALLBACK;
  return WHATSAPP[code] ?? FALLBACK;
}
export function mapAgentStatus(code: string | null | undefined): StatusView {
  if (!code) return FALLBACK;
  return AGENT[code] ?? FALLBACK;
}
export function mapJobStatus(code: string | null | undefined): StatusView {
  if (!code) return FALLBACK;
  return JOB[code] ?? FALLBACK;
}

export function humanizeRelative(iso: string | null | undefined): string {
  if (!iso) return "sem registro";
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return "há instantes";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return `há ${d} d`;
}

// -----------------------------------------------------------------------------
// WAHA credential validation (sanitized). All labels/hints are user-facing;
// they never reference URLs, tokens, env-var names, or provider brand names.
// -----------------------------------------------------------------------------

export type WahaValidateCode =
  | "ok"
  | "unreachable"
  | "unauthorized"
  | "session_missing"
  | "webhook_missing"
  | "webhook_mismatch"
  | "not_configured"
  | "status_error";

const VALIDATE_LABELS: Record<WahaValidateCode, StatusView> = {
  ok:               { label: "Tudo certo",             tone: "success" },
  unreachable:      { label: "Servidor sem resposta",  tone: "warn",   impact: "Não consegui falar com o servidor agora." },
  unauthorized:     { label: "Credenciais recusadas",  tone: "danger", impact: "As credenciais foram recusadas." },
  session_missing:  { label: "Sessão ainda não existe", tone: "warn",  impact: "Clique em Conectar para criar a sessão." },
  webhook_missing:  { label: "Webhook não configurado", tone: "warn",  impact: "Clique em Sincronizar webhook." },
  webhook_mismatch: { label: "Webhook divergente",      tone: "warn",  impact: "O webhook aponta para outro endereço." },
  not_configured:   { label: "Não configurado",         tone: "neutral", impact: "As credenciais ainda não foram cadastradas." },
  status_error:     { label: "Não foi possível verificar", tone: "warn", impact: "Tente novamente em instantes." },
};

export function mapWahaValidate(code: WahaValidateCode | string | null | undefined): StatusView {
  if (!code) return FALLBACK;
  return VALIDATE_LABELS[code as WahaValidateCode] ?? FALLBACK;
}
