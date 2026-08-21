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
