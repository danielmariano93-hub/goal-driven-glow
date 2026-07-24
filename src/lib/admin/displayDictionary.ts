/**
 * Traduz chaves técnicas do banco/RPCs em rótulos amigáveis em português.
 * Regra: nada de "agent", "entry", "surface" cru na UI do admin.
 */

const SURFACE: Record<string, string> = {
  app: "App",
  whatsapp: "WhatsApp",
  assessor: "Assessor",
  panel: "Painel",
  unknown: "Não identificado",
};

const FEATURE: Record<string, string> = {
  agent_reply: "Resposta do assessor",
  agent_confirmation: "Confirmação do assessor",
  agent_error: "Falha do assessor",
  insight_delivered: "Insight entregue",
  forecast_delivered: "Previsão entregue",
  personalized_response_delivered: "Resposta personalizada",
  goal_progress_explained: "Progresso de meta",
  split_reminder_prepared: "Lembrete de divisão",
  split_result_delivered: "Resultado de divisão",
  transaction_confirmed: "Lançamento confirmado",
  transaction_edited: "Lançamento editado",
  goal_created: "Meta criada",
  document_uploaded: "Documento enviado",
  document_confirmed: "Documento confirmado",
  onboarding_completed: "Onboarding concluído",
};

const ACTION: Record<string, string> = {
  "admin_grant": "Permissão concedida",
  "admin_revoke": "Permissão revogada",
  "break_glass_open": "Break-glass aberto",
  "break_glass_close": "Break-glass encerrado",
  "break_glass_read": "Leitura em break-glass",
  "user_suspend": "Usuário suspenso",
  "user_reset_password": "Senha redefinida",
  "user_delete_process": "Exclusão de conta processada",
  "reauth": "Reautenticação",
};

const JOB: Record<string, string> = {
  refresh_product_daily_value: "Agregação diária de valor",
  refresh_outbound_metrics: "Agregação de mensagens",
  refresh_agent_metrics: "Agregação do assessor",
  refresh_feature_funnel: "Funil por feature",
  refresh_user_lifecycle: "Ciclo de vida de usuários",
  refresh_cohorts: "Coortes semanais",
};

function humanize(raw: string): string {
  return raw
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export const dict = {
  surface: (v?: string | null) => (v && SURFACE[v]) || (v ? humanize(v) : "—"),
  feature: (v?: string | null) => (v && FEATURE[v]) || (v ? humanize(v) : "—"),
  action: (v?: string | null) => (v && ACTION[v]) || (v ? humanize(v) : "—"),
  job: (v?: string | null) => (v && JOB[v]) || (v ? humanize(v) : "—"),
};

/** Retorna "—" para valores nulos/indefinidos ou zero desconhecido. */
export function safeNumber(v: number | null | undefined, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v}${suffix}`;
}

/** Formata taxas honestas: denominador zero vira "—", não 0%. */
export function safeRate(numerator: number | null | undefined, denominator: number | null | undefined): string {
  if (!denominator || denominator <= 0) return "—";
  if (numerator === null || numerator === undefined) return "—";
  const pct = (numerator / denominator) * 100;
  return `${pct.toFixed(1).replace(".0", "")}%`;
}
