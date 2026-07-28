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

const COMM_KIND: Record<string, string> = {
  advisor_review_weekly: "Acompanhamento semanal do Nino",
  advisor_review_monthly: "Acompanhamento mensal do Nino",
  categorize_transaction: "Categorizar lançamento",
  emotional_spending: "Gasto ligado à emoção",
  engagement_drop: "Queda de uso do app",
  financial_discipline: "Disciplina financeira",
  financial_procrastination: "Adiamento de decisões financeiras",
  forgotten_bill: "Conta possivelmente esquecida",
  impulsive_spending: "Gasto por impulso",
  recurring_pattern: "Padrão recorrente identificado",
  relapse_risk: "Risco de recaída de hábito",
  saving_opportunity: "Oportunidade de economia",
  underused_subscription: "Assinatura pouco usada",
  duplicate_expense: "Possível gasto duplicado",

  spending_spike: "Gasto acima do normal",
  budget_risk: "Risco de estourar o orçamento",
  goal_progress: "Progresso de meta",
  goal_at_risk: "Meta em risco",
  recurring_due: "Recorrência a vencer",
  recurring_missing: "Recorrência não lançada",
  split_pending: "Divisão do rolê em aberto",
  uncategorized_transactions: "Lançamentos sem categoria",
  weekly_digest: "Resumo semanal",
  monthly_digest: "Resumo mensal",
  emotional_checkin: "Convite de check-in emocional",
  cashflow_alert: "Alerta de fluxo de caixa",
  celebration: "Comemoração de conquista",
  onboarding_nudge: "Estímulo de primeiros passos",
};

const COMM_REASON: Record<string, string> = {
  rollout_channel_disabled: "Canal ainda não liberado para o cliente",
  candidate_channel_not_ready: "Conteúdo ainda não pronto para este canal",
  kind_disabled_in_catalog: "Tipo desativado no catálogo",
  channel_disabled_in_catalog: "Canal desativado para este tipo",
  awaiting_manual_approval: "Aguardando aprovação manual",
  no_active_whatsapp_link: "Cliente sem WhatsApp conectado",
  kind_cooldown_24h: "Já enviado nas últimas 24 horas",
  daily_cap_reached: "Limite diário de mensagens atingido",
  quiet_hours: "Fora do horário permitido",
  user_opted_out: "Cliente optou por não receber",
  duplicate_dedup_key: "Mensagem repetida (mesmo assunto)",
  low_priority: "Prioridade baixa para o momento",
};

const CHANNEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  inapp: "Aplicativo",
  app: "Aplicativo",
  both: "Aplicativo e WhatsApp",
  email: "E-mail",
};

const COMM_STATUS: Record<string, string> = {
  queued: "Na fila",
  sent: "Enviada",
  delivered: "Entregue",
  read: "Lida",
  failed: "Falhou",
  suppressed: "Não enviada",
  skipped: "Ignorada",
  acted: "Gerou ação",
  dry_run: "Simulação",
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
  commKind: (v?: string | null) => (v && COMM_KIND[v]) || (v ? humanize(v) : "—"),
  commReason: (v?: string | null) => (v && COMM_REASON[v]) || (v ? humanize(v) : "—"),
  channel: (v?: string | null) => (v && CHANNEL[v]) || (v ? humanize(v) : "—"),
  commStatus: (v?: string | null) => (v && COMM_STATUS[v]) || (v ? humanize(v) : "—"),
};

