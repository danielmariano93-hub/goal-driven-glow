// CapabilityRouter — deterministic first-stage routing shared by App and
// WhatsApp. It narrows the 41-tool registry before any model is called and
// marks factual intents that must be answered from one canonical tool.
import type { ParsedIntent } from "../parser.ts";
import { parseBrAmount, shiftSaoPaulo, todaySaoPaulo } from "../parser.ts";
import type { SemanticQuery } from "../../intelligence/contracts.ts";
import type { ContextRequest } from "./FinancialContext360.ts";

export type CapabilityName =
  | "weekday_pattern"
  | "weekday_literal"
  | "goals_overview"
  | "before_spending"
  | "financial_snapshot"
  | "recent_transactions"
  | "split_expense"
  | "transaction_entry"
  | "transaction_management"
  | "visualization"
  | "financial_analysis"
  | "money_leaks"
  | "debt_status"
  | "insights"
  | "shared_goals"
  | "general";

export type CapabilityDecision = {
  name: CapabilityName;
  execution: "deterministic" | "llm_scoped";
  allowed_tools: readonly string[];
  required_tool: string | null;
  context: ContextRequest;
  tool_args?: Record<string, unknown>;
  clarification?: string;
  reason: string;
};

const GROUPS = {
  split: ["list_accounts", "list_categories", "list_credit_cards", "create_split_expense_draft"],
  transactionEntry: [
    "list_accounts", "list_categories", "list_credit_cards", "create_transaction_draft",
    "create_transfer_draft", "pay_credit_card_bill_draft", "create_goal_draft",
    "add_goal_contribution_draft", "create_debt_draft",
  ],
  transactionManagement: [
    "search_transactions", "get_transaction", "list_accounts", "list_categories", "list_credit_cards",
    "draft_transaction_update", "draft_transaction_delete",
  ],
  visualization: [
    "generate_chart_artifact", "spending_timeseries_daily", "spending_average_daily_trend",
    "compare_periods", "get_weekday_spending_pattern", "list_category_spending_goals",
  ],
  analysis: [
    "analyze_spending", "compare_periods", "forecast_month_close", "explain_spending_change",
    "get_spending_highlights", "get_financial_snapshot", "get_weekday_spending_pattern",
    "explain_behavior_change", "analyze_merchants", "merchant_profile",
    "analyze_financial_evolution", "detect_spending_anomalies",
  ],
  // Motores determinísticos que respondem "para onde meu dinheiro vai".
  leaks: [
    "analyze_merchants", "merchant_profile", "discover_recurring", "analyze_cost_structure",
    "find_savings_opportunities", "detect_spending_anomalies", "explain_behavior_change",
  ],
  debts: ["get_debt_status", "list_recent_transactions", "get_financial_snapshot"],
  sharedGoals: [
    "list_shared_goals", "get_shared_goal_progress", "simulate_shared_goal_pace",
    "create_shared_goal_draft", "add_shared_goal_contribution_draft", "explain_shared_goal_ranking",
  ],
  general: [
    "get_financial_snapshot", "list_recent_transactions", "search_transactions", "get_goals_overview",
    "get_daily_insights", "run_before_spending", "get_weekday_spending_pattern", "analyze_spending",
    "get_debt_status", "analyze_merchants", "find_savings_opportunities",
  ],
} as const;

function normalize(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
}

function extractAmount(text: string): number | null {
  const money = text.match(/r\$\s*(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i)?.[1];
  if (money) return parseBrAmount(money);
  const afterVerb = normalize(text).match(/(?:gastar|comprar|compra|gasto|simular|simulacao|custa|valor(?: de)?)\s+(?:de\s+)?(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/)?.[1];
  return afterVerb ? parseBrAmount(afterVerb) : null;
}

function validISODate(value: string): string | undefined {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? value
    : undefined;
}

function extractPlannedDate(text: string): string | undefined {
  const t = normalize(text);
  const today = todaySaoPaulo();
  if (/\bdepois de amanha\b/.test(t)) return shiftSaoPaulo(today, 2);
  if (/\bamanha\b/.test(t)) return shiftSaoPaulo(today, 1);
  if (/\bhoje\b/.test(t)) return today;
  const inDays = Number(t.match(/\b(?:daqui a|em)\s+(\d{1,3})\s+dias?\b/)?.[1] ?? 0);
  if (inDays > 0 && inDays <= 365) return shiftSaoPaulo(today, inDays);
  const iso = t.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return validISODate(iso);
  const br = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?\b/);
  if (br) {
    const year = br[3] ?? today.slice(0, 4);
    return validISODate(`${year}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`);
  }
  const dayOnly = Number(t.match(/\b(?:no\s+)?dia\s+(\d{1,2})\b/)?.[1] ?? 0);
  if (!dayOnly) return undefined;
  const [currentYear, currentMonth, currentDay] = today.split("-").map(Number);
  const base = new Date(Date.UTC(currentYear, currentMonth - 1 + (dayOnly < currentDay ? 1 : 0), 1));
  return validISODate(`${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(dayOnly).padStart(2, "0")}`);
}

function beforeSpendingArgs(text: string): Record<string, unknown> | undefined {
  const amount = extractAmount(text);
  if (!amount) return undefined;
  const t = normalize(text);
  const explicitCategory = t.match(/\bcategoria\s+([a-z0-9 _-]{2,40}?)(?=\s+(?:no|na|dia|hoje|amanha|pelo|com|cartao|credito|parcel|$)|$)/)?.[1]?.trim();
  const naturalCategory = t.match(/\b(?:em|para)\s+([a-z][a-z _-]{1,30}?)(?=\s+(?:hoje|amanha|dia|no|na|pelo|com|cartao|credito|parcel|pix|dinheiro|$)|$)/)?.[1]?.trim();
  const category = explicitCategory ?? (naturalCategory && !["um", "uma", "conta", "cartao", "credito", "hoje", "amanha", "depois de amanha"].includes(naturalCategory) ? naturalCategory : undefined);
  const cardMatch = t.match(/\b(?:cartao|credito)\s+(?:do|da|de)?\s*([a-z0-9 _-]{2,30}?)(?=\s+(?:em|dia|hoje|amanha|parcel|$)|$)/)?.[1]?.trim();
  const installments = Number(t.match(/\b(\d{1,2})\s*x\b/)?.[1] ?? 1);
  return {
    amount,
    ...(category ? { category } : {}),
    ...(extractPlannedDate(text) ? { planned_date: extractPlannedDate(text) } : {}),
    ...(/\b(cartao|credito|parcelad)/.test(t)
      ? { method: "card" }
      : /\b(pix|dinheiro|debito|conta|a vista)\b/.test(t)
        ? { method: "cash" }
        : {}),
    ...(cardMatch ? { card: cardMatch } : {}),
    ...(installments > 1 ? { installments } : {}),
  };
}

function weekdayClarification(text: string): string | null {
  const t = normalize(text);
  const direct = /\b(quanto|qual valor|total|soma)\b.*\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)\b|\b(gastei|gasto)\b.*\b(segunda|terca|quarta|quinta|sexta|sabado|domingo)\b/.test(t);
  if (!direct) return null;
  if (/\b(ultima|passada|mais recente|dia \d{1,2})\b/.test(t)) return null;
  return "Você quer o total da última ocorrência desse dia ou o acumulado desse dia nas últimas semanas?";
}

function lastNamedWeekday(text: string): string | null {
  const t = normalize(text);
  if (!/\b(ultima|passada|mais recente)\b/.test(t)) return null;
  const indexes: Record<string, number> = {
    domingo: 0, segunda: 1, terca: 2, quarta: 3,
    quinta: 4, sexta: 5, sabado: 6,
  };
  const name = Object.keys(indexes).find((weekday) => new RegExp(`\\b${weekday}(?:-feira)?\\b`).test(t));
  if (!name) return null;
  const today = todaySaoPaulo();
  const currentDow = new Date(`${today}T12:00:00Z`).getUTCDay();
  let daysBack = (currentDow - indexes[name] + 7) % 7;
  if (daysBack === 0) daysBack = 7;
  return shiftSaoPaulo(today, -daysBack);
}

export function classifyCapability(
  text: string,
  parsed: ParsedIntent,
  semantic: SemanticQuery | null,
): CapabilityDecision {
  const t = normalize(text);

  if (semantic?.intent === "weekday_pattern") {
    return {
      name: "weekday_pattern", execution: "deterministic",
      allowed_tools: ["get_weekday_spending_pattern"], required_tool: "get_weekday_spending_pattern",
      context: {}, tool_args: {
        interpretation: semantic.interpretation,
        weeks: semantic.period.value,
      }, reason: "semantic_weekday_pattern",
    };
  }

  const directWeekday = weekdayClarification(text);
  const literalDate = lastNamedWeekday(text);
  if (directWeekday || literalDate) {
    return {
      name: "weekday_literal", execution: "deterministic",
      allowed_tools: ["get_spending_for_date"], required_tool: literalDate ? "get_spending_for_date" : null,
      context: {}, tool_args: literalDate ? { date: literalDate } : undefined,
      clarification: directWeekday ?? undefined,
      reason: directWeekday ? "weekday_scope_ambiguous" : "weekday_literal_date",
    };
  }

  if (/\b(dividir|divisao|racha|ratear|role)\b/.test(t)) {
    return {
      name: "split_expense", execution: "llm_scoped", allowed_tools: GROUPS.split,
      required_tool: null, context: { accounts: true, cards: true }, reason: "guided_split_expense",
    };
  }

  if (/\b(?:quais|liste|mostre|mostrar|mostra|resuma|resumir|como (?:estao|vao))\b.{0,40}\bmetas?\b|\bmetas?\b.{0,35}\b(?:cadastradas|minhas|progresso|atingimento|andamento)\b/.test(t)) {
    return {
      name: "goals_overview", execution: "deterministic", allowed_tools: ["get_goals_overview"],
      required_tool: "get_goals_overview", context: {}, reason: "canonical_goals_overview",
    };
  }

  if (/\b(posso gastar|antes de gastar|antes de comprar|se eu .{0,18}(?:gastar|comprar|fizer? (?:um )?gasto)|caso eu .{0,18}(?:gaste|compre)|simul(?:ar|e|acao).*(?:gasto|compra)|impacto.*(?:compra|gasto))\b/.test(t)) {
    const args = beforeSpendingArgs(text);
    const clarification = !args
      ? "Qual valor você quer simular e em qual data pretende gastar?"
      : !args.planned_date
        ? "Em qual data você pretende fazer esse gasto? Pode dizer hoje, amanhã, dia 15 ou uma data completa."
        : undefined;
    return {
      name: "before_spending", execution: "deterministic",
      allowed_tools: ["run_before_spending", "list_categories", "list_credit_cards", "list_accounts"],
      required_tool: clarification ? null : "run_before_spending",
      context: { metrics: true, categoryGoals: true, accounts: true, cards: true },
      tool_args: args, clarification,
      reason: !args ? "simulation_missing_amount" : clarification ? "simulation_missing_date" : "canonical_spending_simulation",
    };
  }

  if (/\b(grafico|visualizacao|chart|linha|barras|pizza|evolucao|tendencia|dia a dia|por dia)\b/.test(t)) {
    return {
      name: "visualization", execution: "llm_scoped", allowed_tools: GROUPS.visualization,
      required_tool: "generate_chart_artifact", context: {}, reason: "artifact_requested",
    };
  }

  if (/\b(metas? conjunta|objetivo conjunto|ranking.*meta|contribuidores|participantes.*meta)\b/.test(t)) {
    return {
      name: "shared_goals", execution: "llm_scoped", allowed_tools: GROUPS.sharedGoals,
      required_tool: null, context: {}, reason: "shared_goals_domain",
    };
  }

  if (/\b(editar|alterar|corrigir|excluir|apagar|deletar)\b.*\b(lancamento|transacao|gasto|receita|despesa)\b/.test(t)) {
    return {
      name: "transaction_management", execution: "llm_scoped", allowed_tools: GROUPS.transactionManagement,
      required_tool: "search_transactions", context: { accounts: true, cards: true }, reason: "transaction_crud",
    };
  }

  if (/\b(divida|dividas|parcela|parcelas|emprestimo|financiamento|consignado|atrasad|em atraso|vencid|vencimento)\b/.test(t)) {
    return {
      name: "debt_status", execution: "deterministic", allowed_tools: GROUPS.debts,
      required_tool: "get_debt_status", context: {}, reason: "canonical_debt_status",
    };
  }

  if (/\b(escapando|escapa|vazando|vazamento|sangrando|assinatura|assinaturas|recorrente|recorrencias|economizar|economia|cortar gasto|fixo|fixos|variavel|variaveis|custo de vida|anomalia|fora do normal|fora do padrao|estabelecimento|onde gasto|com quem gasto)\b/.test(t)) {
    return {
      name: "money_leaks", execution: "llm_scoped", allowed_tools: GROUPS.leaks,
      required_tool: null, context: { metrics: true }, reason: "deterministic_engines_money_leaks",
    };
  }

  // Previsão/fechamento do mês tem UMA tool canônica. Sem rota obrigatória o
  // modelo improvisava e, quando a tool falhava, virava desculpa genérica.
  if (/\b(previsao|previsoes|prever|projecao|projetar|vou fechar|fecho o mes|fechar o mes|fechamento do mes|fim do mes|final do mes|termina o mes|quanto vou gastar (?:no|neste|esse|este) mes)\b/.test(t)) {
    return {
      name: "forecast_month_close", execution: "deterministic",
      allowed_tools: ["forecast_month_close", "get_financial_snapshot"],
      required_tool: "forecast_month_close", context: { metrics: true },
      reason: "canonical_month_close_forecast",
    };
  }

  if (/\b(compare|comparar|comparacao|previsao|projecao|fechamento|por que|porque|mudou|aumentou|diminuiu|onde gasto mais)\b/.test(t)) {
    return {
      name: "financial_analysis", execution: "llm_scoped", allowed_tools: GROUPS.analysis,
      required_tool: null, context: { metrics: true }, reason: "financial_analysis_scoped",
    };
  }


  if (/\b(insight|dica|orientacao|sugestao|o que a ia acha|o que o nino acha)\b/.test(t)) {
    return {
      name: "insights", execution: "llm_scoped",
      allowed_tools: ["get_daily_insights", "get_spending_highlights", "get_financial_snapshot"],
      required_tool: "get_daily_insights", context: { metrics: true }, reason: "current_insights",
    };
  }

  if (parsed.kind === "query" && parsed.topic === "recent") {
    return {
      name: "recent_transactions", execution: "deterministic", allowed_tools: ["list_recent_transactions"],
      required_tool: "list_recent_transactions", context: {}, tool_args: { limit: 5 }, reason: "recent_transactions",
    };
  }

  if (parsed.kind === "query" && parsed.topic === "summary" || /\b(como estou|quanto sobra|disponivel hoje|ritmo|fechamento do mes)\b/.test(t)) {
    return {
      name: "financial_snapshot", execution: "deterministic", allowed_tools: ["get_financial_snapshot"],
      required_tool: "get_financial_snapshot", context: {}, reason: "canonical_financial_snapshot",
    };
  }

  if (["transaction", "transfer", "goal_contribution", "goal"].includes(parsed.kind)) {
    return {
      name: "transaction_entry", execution: "llm_scoped", allowed_tools: GROUPS.transactionEntry,
      required_tool: null, context: { accounts: true, cards: true }, reason: `parsed_${parsed.kind}`,
    };
  }

  return {
    name: "general", execution: "llm_scoped", allowed_tools: GROUPS.general,
    required_tool: null, context: { summary: true, metrics: true }, reason: "bounded_general_assistant",
  };
}

/**
 * Retoma apenas uma simulação determinística que ficou aguardando um slot.
 * Não concatena conversa geral: a mensagem atual precisa parecer uma resposta
 * de data/meio de pagamento, e o turno imediatamente anterior precisa ter sido
 * uma simulação incompleta. Assim "amanhã" completa o cálculo sem entregar o
 * controle do contexto à LLM nem ressuscitar assuntos antigos.
 */
export function resumeDeterministicCapability(
  text: string,
  parsed: ParsedIntent,
  previousUserText?: string | null,
): CapabilityDecision | null {
  if (!previousUserText) return null;
  const slot = normalize(text);
  const looksLikeSlot = /\b(hoje|amanha|depois de amanha|dia\s+\d{1,2}|\d{1,2}\/\d{1,2}|20\d{2}-\d{2}-\d{2}|pix|dinheiro|debito|conta|cartao|credito|\d{1,2}\s*x)\b/.test(slot);
  if (!looksLikeSlot) return null;
  const previous = classifyCapability(previousUserText, parsed, null);
  if (previous.name !== "before_spending" || !previous.clarification) return null;
  const resumed = classifyCapability(`${previousUserText} ${text}`, parsed, null);
  if (resumed.name !== "before_spending" || resumed.clarification || !resumed.required_tool) return null;
  return { ...resumed, reason: "canonical_spending_simulation_resumed" };
}

export function capabilityPrompt(decision: CapabilityDecision): string {
  return [
    `[CAPACIDADE DO TURNO: ${decision.name}]`,
    `Motivo do roteamento: ${decision.reason}.`,
    `Ferramentas permitidas: ${decision.allowed_tools.join(", ") || "nenhuma"}.`,
    decision.required_tool
      ? `A resposta factual deve usar obrigatoriamente ${decision.required_tool}; não responda com memória ou estimativa própria.`
      : "Use apenas as ferramentas permitidas e nunca invente dados ausentes.",
  ].join("\n");
}
