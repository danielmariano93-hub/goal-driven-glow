const SURFACE: Record<string, string> = {
  app: "Aplicativo",
  inapp: "Aplicativo",
  whatsapp: "WhatsApp",
  admin: "Painel administrativo",
  panel: "Painel administrativo",
  system: "Sistema",
  llm: "Motor do Nino",
  assessor: "Assessor",
  unknown: "Não identificado",
};

const FEATURE: Record<string, string> = {
  agent: "Conversas com o Nino",
  agent_chat: "Conversa no aplicativo",
  agent_reply: "Resposta do Nino",
  agent_confirmation: "Confirmação do Nino",
  agent_error: "Falha do Nino",
  entry: "Lançamentos financeiros",
  ocr: "Leitura de documentos",
  split: "Divisão do rolê",
  split_invite: "Convites da divisão",
  split_reminder: "Lembretes da divisão",
  goal: "Metas",
  forecast: "Previsões",
  insight: "Insights do Nino",
  system: "Mensagens do sistema",
  insight_delivered: "Insight entregue",
  forecast_delivered: "Previsão entregue",
  personalized_response_delivered: "Resposta personalizada",
  goal_progress_explained: "Progresso de meta explicado",
  split_reminder_prepared: "Lembrete da divisão preparado",
  split_result_delivered: "Resultado da divisão entregue",
  transaction_confirmed: "Lançamento confirmado",
  transaction_edited: "Lançamento editado",
  goal_created: "Meta criada",
  document_uploaded: "Documento enviado",
  document_confirmed: "Documento confirmado",
  onboarding_completed: "Onboarding concluído",
  unknown: "Não identificado",
};

const STEP: Record<string, string> = {
  initiated: "Iniciou",
  completed: "Concluiu",
  value_delivered: "Recebeu valor",
  other: "Evento auxiliar",
};

const STATUS: Record<string, string> = {
  new: "Novo",
  activated: "Ativado",
  active: "Ativo",
  at_risk: "Em risco",
  dormant: "Inativo",
  churned: "Abandonou",
  deleted: "Excluído",
};

const ACTION: Record<string, string> = {
  bootstrap: "Auditoria inicializada",
  "clients.identity.read": "Identidade de cliente consultada",
  "clients.identity.masked": "Identidade mascarada consultada",
  "break_glass.open": "Acesso excepcional aberto",
  "break_glass.read": "Dado protegido consultado",
  "break_glass.close": "Acesso excepcional encerrado",
  admin_grant: "Permissão concedida",
  admin_revoke: "Permissão removida",
  message_reprocessed: "Mensagem reprocessada",
  whatsapp_reconnected: "Sessão do WhatsApp reconectada",
};

const JOB: Record<string, string> = {
  product_aggregates_incremental: "Atualização de métricas",
  product_aggregates_full: "Consolidação diária",
  product_events_prune: "Limpeza de eventos antigos",
  "split-reminders-dispatch": "Envio de lembretes da divisão",
  "whatsapp-send": "Fila de envios do WhatsApp",
  refresh_product_daily_value: "Agregação diária de valor",
  refresh_outbound_metrics: "Agregação de mensagens",
  refresh_agent_metrics: "Agregação do assessor",
  refresh_feature_funnel: "Funil de experiências",
  refresh_user_lifecycle: "Ciclo de vida de clientes",
  refresh_cohorts: "Coortes semanais",
};

function humanize(raw: string) {
  return raw.replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

export const dict = {
  surface: (v?: string | null) => (v && SURFACE[v]) || (v ? humanize(v) : "—"),
  feature: (v?: string | null) => (v && FEATURE[v]) || (v ? humanize(v) : "—"),
  step: (v?: string | null) => (v && STEP[v]) || (v ? humanize(v) : "—"),
  status: (v?: string | null) => (v && STATUS[v]) || (v ? humanize(v) : "—"),
  action: (v?: string | null) => (v && ACTION[v]) || (v ? humanize(v) : "—"),
  job: (v?: string | null) => (v && JOB[v]) || (v ? humanize(v) : "—"),
};
