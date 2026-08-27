// CapabilityRegistry (`nino_agent.v1`) — matriz única de capacidades do produto.
//
// O CapabilityRouter decide QUAL rota usar num turno. Este registry responde a
// outra pergunta, que antes não tinha fonte única: "o Nino sabe fazer isso?".
// Cada entrada declara domínio, ferramenta canônica, se escreve no ledger, o
// risco da escrita e a superfície onde o resultado aparece.
//
// Puro e testável: nenhuma dependência de rede.

export type CapabilityDomain =
  | "ledger"
  | "cards"
  | "goals"
  | "debts"
  | "recurring"
  | "investments"
  | "analysis"
  | "advisor"
  | "emotions"
  | "sharing"
  | "reports"
  | "meta";

export type RiskLevel = "read_only" | "low" | "medium" | "high";

export type CapabilityEntry = {
  key: string;
  label: string;
  domain: CapabilityDomain;
  /** Ferramenta canônica que responde/executa. */
  tool: string;
  /** Escreve no banco (exige rascunho + confirmação + prova de escrita). */
  writes: boolean;
  risk: RiskLevel;
  /** Onde o usuário vê o resultado. */
  surfaces: Array<"app" | "whatsapp">;
  /** Frase curta usada quando o usuário pergunta o que o Nino faz. */
  says: string;
};

export const CAPABILITIES: readonly CapabilityEntry[] = [
  // --- Ledger ---
  { key: "entry.expense", label: "Registrar despesa", domain: "ledger", tool: "create_transaction_draft", writes: true, risk: "medium", surfaces: ["app", "whatsapp"], says: "registrar gastos e recebimentos" },
  { key: "entry.transfer", label: "Registrar transferência", domain: "ledger", tool: "create_transfer_draft", writes: true, risk: "medium", surfaces: ["app", "whatsapp"], says: "registrar transferências entre contas" },
  { key: "entry.update", label: "Corrigir lançamento", domain: "ledger", tool: "draft_transaction_update", writes: true, risk: "high", surfaces: ["app", "whatsapp"], says: "corrigir um lançamento já registrado" },
  { key: "entry.delete", label: "Cancelar lançamento", domain: "ledger", tool: "draft_transaction_delete", writes: true, risk: "high", surfaces: ["app", "whatsapp"], says: "cancelar um lançamento com auditoria" },
  { key: "ledger.search", label: "Buscar lançamentos", domain: "ledger", tool: "search_transactions", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "encontrar lançamentos pelo nome ou período" },
  { key: "ledger.recent", label: "Últimos lançamentos", domain: "ledger", tool: "list_recent_transactions", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "mostrar seus últimos lançamentos" },

  // --- Cartões ---
  { key: "cards.list", label: "Cartões", domain: "cards", tool: "list_credit_cards", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "consultar seus cartões" },
  { key: "cards.pay_bill", label: "Pagar fatura", domain: "cards", tool: "pay_credit_card_bill_draft", writes: true, risk: "high", surfaces: ["app", "whatsapp"], says: "dar baixa no pagamento de uma fatura" },

  // --- Metas ---
  { key: "goals.overview", label: "Metas", domain: "goals", tool: "get_goals_overview", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "acompanhar suas metas" },
  { key: "goals.strategy", label: "Plano da meta", domain: "goals", tool: "get_goal_strategy", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "montar o plano para bater uma meta" },
  { key: "goals.create", label: "Criar meta", domain: "goals", tool: "create_goal_draft", writes: true, risk: "low", surfaces: ["app", "whatsapp"], says: "criar uma meta nova" },
  { key: "goals.contribute", label: "Aportar em meta", domain: "goals", tool: "add_goal_contribution_draft", writes: true, risk: "medium", surfaces: ["app", "whatsapp"], says: "registrar um aporte em meta" },

  // --- Dívidas / recorrências ---
  { key: "debts.status", label: "Dívidas", domain: "debts", tool: "get_debt_status", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "ver o estado das suas dívidas e atrasos" },
  { key: "debts.create", label: "Registrar dívida", domain: "debts", tool: "create_debt_draft", writes: true, risk: "low", surfaces: ["app", "whatsapp"], says: "registrar uma dívida" },
  { key: "recurring.discover", label: "Recorrências", domain: "recurring", tool: "discover_recurring", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "descobrir gastos que se repetem" },

  // --- Análise ---
  { key: "analysis.snapshot", label: "Situação atual", domain: "analysis", tool: "get_financial_snapshot", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "mostrar como está sua situação hoje" },
  { key: "analysis.forecast", label: "Fechamento do mês", domain: "analysis", tool: "forecast_month_close", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "projetar o fechamento do mês" },
  { key: "analysis.compare", label: "Comparar períodos", domain: "analysis", tool: "compare_periods", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "comparar períodos" },
  { key: "analysis.weekday", label: "Padrão por dia", domain: "analysis", tool: "get_weekday_spending_pattern", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "explicar seu padrão por dia da semana" },
  { key: "analysis.merchants", label: "Estabelecimentos", domain: "analysis", tool: "analyze_merchants", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "mostrar onde seu dinheiro está indo" },
  { key: "analysis.leaks", label: "Vazamentos", domain: "analysis", tool: "find_savings_opportunities", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "encontrar onde é possível cortar" },
  { key: "analysis.cost_structure", label: "Estrutura de custo", domain: "analysis", tool: "analyze_cost_structure", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "separar custo fixo de variável" },
  { key: "analysis.health", label: "Diagnóstico geral", domain: "analysis", tool: "assess_financial_health", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "fazer um diagnóstico geral da sua vida financeira" },
  { key: "analysis.performance", label: "Desempenho", domain: "analysis", tool: "assess_financial_performance", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "avaliar seu desempenho no período" },

  // --- Consultoria ---
  { key: "advisor.before_spending", label: "Antes de gastar", domain: "advisor", tool: "run_before_spending", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "dizer se um gasto cabe agora" },
  { key: "advisor.installment", label: "Parcelar ou não", domain: "advisor", tool: "plan_installment_decision", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "decidir entre à vista e parcelado" },

  // --- Emoções ---
  { key: "emotions.checkin", label: "Check-in emocional", domain: "emotions", tool: "log_emotional_checkin", writes: true, risk: "low", surfaces: ["app", "whatsapp"], says: "registrar como você está se sentindo" },
  { key: "emotions.patterns", label: "Emoção e gasto", domain: "emotions", tool: "get_emotion_finance_patterns", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "relacionar emoção e gasto" },

  // --- Compartilhado ---
  { key: "sharing.split", label: "Dividir o rolê", domain: "sharing", tool: "create_split_expense_draft", writes: true, risk: "medium", surfaces: ["app", "whatsapp"], says: "dividir uma conta com outras pessoas" },
  { key: "sharing.goals", label: "Metas conjuntas", domain: "sharing", tool: "list_shared_goals", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "acompanhar metas conjuntas" },

  // --- Relatórios ---
  { key: "reports.chart", label: "Gráfico", domain: "reports", tool: "generate_chart_artifact", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "gerar um gráfico do período" },
  { key: "reports.template", label: "Relatório", domain: "reports", tool: "generate_report_from_template", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "montar um relatório do período" },
  // --- Patrimônio e investimentos ---
  { key: "patrimony.net_worth", label: "Patrimônio", domain: "investments", tool: "get_net_worth", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "mostrar seu patrimônio (contas, investimentos e dívidas)" },
  { key: "investments.list", label: "Carteira de investimentos", domain: "investments", tool: "list_investments", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "consultar sua carteira de investimentos" },

  // --- Cartões (compromissos futuros) ---
  { key: "cards.future_installments", label: "Parcelas futuras", domain: "cards", tool: "get_future_installments", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "mostrar as parcelas que ainda vão cair" },

  // --- Recorrências e agenda ---
  { key: "recurring.list", label: "Recorrências ativas", domain: "recurring", tool: "list_recurring_rules", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "listar suas recorrências ativas" },
  { key: "agenda.commitments", label: "Agenda de compromissos", domain: "recurring", tool: "get_commitments_agenda", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "mostrar os compromissos que vencem em seguida" },

  // --- Leituras canônicas restantes ---
  { key: "accounts.list", label: "Contas", domain: "ledger", tool: "list_accounts", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "consultar suas contas" },
  { key: "categories.list", label: "Categorias", domain: "ledger", tool: "list_categories", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "consultar suas categorias" },
  { key: "ledger.summary", label: "Resumo do mês", domain: "analysis", tool: "get_financial_summary", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "resumir entradas e saídas do mês" },
  { key: "ledger.detail", label: "Detalhe do lançamento", domain: "ledger", tool: "get_transaction", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "abrir o detalhe de um lançamento" },
  { key: "analysis.spending", label: "Onde gastou", domain: "analysis", tool: "analyze_spending", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "resumir onde você gastou" },
  { key: "analysis.day", label: "Gasto do dia", domain: "analysis", tool: "get_spending_for_date", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "somar o gasto de um dia específico" },
  { key: "analysis.insights", label: "Insights do dia", domain: "analysis", tool: "get_daily_insights", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "trazer o insight do dia" },
  { key: "analysis.highlights", label: "Destaques de gasto", domain: "analysis", tool: "get_spending_highlights", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "destacar o que puxou seu gasto" },
  { key: "analysis.anomalies", label: "Gastos fora do padrão", domain: "analysis", tool: "detect_spending_anomalies", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "apontar gastos fora do seu padrão" },
  { key: "analysis.change", label: "Por que mudou", domain: "analysis", tool: "explain_spending_change", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "explicar por que seu gasto mudou" },
  { key: "analysis.behavior_change", label: "Mudança de comportamento", domain: "analysis", tool: "explain_behavior_change", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "explicar mudanças no seu comportamento" },
  { key: "analysis.metric", label: "Comparar indicador", domain: "analysis", tool: "compare_financial_metric", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "comparar um indicador seu no tempo" },
  { key: "analysis.evolution", label: "Evolução financeira", domain: "analysis", tool: "analyze_financial_evolution", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "mostrar sua evolução financeira" },
  { key: "analysis.trajectory", label: "Trajetória longitudinal", domain: "analysis", tool: "analyze_longitudinal_trajectory", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "mostrar sua trajetória mês a mês e quando o padrão mudou" },
  { key: "analysis.wealth_opportunity", label: "Oportunidade patrimonial", domain: "analysis", tool: "analyze_wealth_opportunity", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "calcular quanto você poderia ter acumulado e quanto dá para guardar por mês" },
  { key: "analysis.financial_plan", label: "Plano financeiro", domain: "analysis", tool: "build_financial_plan", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "montar seu plano: quanto por mês, de onde tirar e os próximos passos" },
  { key: "analysis.series", label: "Série diária", domain: "analysis", tool: "spending_timeseries_daily", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "mostrar o gasto dia a dia" },
  { key: "analysis.trend", label: "Tendência da média diária", domain: "analysis", tool: "spending_average_daily_trend", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "mostrar a tendência da sua média diária" },
  { key: "analysis.merchant_distribution", label: "Distribuição por estabelecimento", domain: "analysis", tool: "merchant_distribution", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "distribuir o gasto por estabelecimento" },
  { key: "analysis.merchant_profile", label: "Perfil do estabelecimento", domain: "analysis", tool: "merchant_profile", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "abrir o perfil de um estabelecimento" },
  { key: "goals.category_list", label: "Metas por categoria", domain: "goals", tool: "list_category_spending_goals", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "acompanhar seus tetos por categoria" },
  { key: "goals.projection", label: "Projeção da meta", domain: "goals", tool: "project_goal_completion", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "projetar quando a meta fecha" },
  { key: "goals.pace", label: "Ritmo da meta", domain: "goals", tool: "simulate_goal_pace", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "simular o ritmo de uma meta" },
  { key: "sharing.goal_progress", label: "Progresso da meta conjunta", domain: "sharing", tool: "get_shared_goal_progress", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "ver o progresso de uma meta conjunta" },
  { key: "sharing.goal_pace", label: "Ritmo da meta conjunta", domain: "sharing", tool: "simulate_shared_goal_pace", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "simular o ritmo de uma meta conjunta" },
  { key: "sharing.goal_ranking", label: "Ranking da meta conjunta", domain: "sharing", tool: "explain_shared_goal_ranking", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "explicar o ranking de uma meta conjunta" },
  { key: "sharing.goal_create", label: "Criar meta conjunta", domain: "sharing", tool: "create_shared_goal_draft", writes: true, risk: "low", surfaces: ["app", "whatsapp"], says: "criar uma meta conjunta" },
  { key: "sharing.goal_contribute", label: "Aportar em meta conjunta", domain: "sharing", tool: "add_shared_goal_contribution_draft", writes: true, risk: "medium", surfaces: ["app", "whatsapp"], says: "registrar aporte em meta conjunta" },
  { key: "emotions.history", label: "Histórico emocional", domain: "emotions", tool: "get_emotional_checkins", writes: false, risk: "read_only", surfaces: ["app", "whatsapp"], says: "revisitar seus check-ins emocionais" },

  // --- Meta (confirmação de rascunhos) ---
  { key: "meta.confirm", label: "Confirmar pendência", domain: "meta", tool: "confirm_pending_action", writes: true, risk: "medium", surfaces: ["app", "whatsapp"], says: "confirmar um rascunho pendente" },
  { key: "meta.cancel", label: "Cancelar pendência", domain: "meta", tool: "cancel_pending_action", writes: false, risk: "low", surfaces: ["app", "whatsapp"], says: "cancelar um rascunho pendente" },
];

const BY_TOOL = new Map(CAPABILITIES.map((c) => [c.tool, c]));
const BY_KEY = new Map(CAPABILITIES.map((c) => [c.key, c]));

export function capabilityByTool(tool: string): CapabilityEntry | null {
  return BY_TOOL.get(String(tool ?? "").trim()) ?? null;
}

export function capabilityByKey(key: string): CapabilityEntry | null {
  return BY_KEY.get(String(key ?? "").trim()) ?? null;
}

export function writeTools(): string[] {
  return CAPABILITIES.filter((c) => c.writes).map((c) => c.tool);
}

export function riskOfTool(tool: string): RiskLevel {
  return capabilityByTool(tool)?.risk ?? "read_only";
}

/** Resumo em pt-BR do que o Nino sabe fazer, por domínio (sem jargão técnico). */
export function capabilitySummary(domains?: CapabilityDomain[]): string {
  const wanted = domains?.length ? new Set(domains) : null;
  const list = CAPABILITIES.filter((c) => !wanted || wanted.has(c.domain));
  const seen = new Set<string>();
  const phrases = list.map((c) => c.says).filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
  return phrases.join("; ");
}
