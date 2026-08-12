// DeterministicAnswers — formats factual tool results without asking an LLM
// to calculate, rename fields or infer missing values.
// deno-lint-ignore-file no-explicit-any
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { LLMTurn } from "../llm.ts";
import { runTool } from "./ToolRuntime.ts";
import type { CapabilityDecision } from "./CapabilityRouter.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const PCT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function money(value: unknown): string { return BRL.format(Number(value ?? 0)); }

export function formatFinancialSnapshot(s: any): string {
  const paceDelta = Number(s.daily_pace ?? 0) - Number(s.typical_daily_pace ?? 0);
  const pace = paceDelta > 0.009
    ? `${money(Math.abs(paceDelta))}/dia acima do seu ritmo típico`
    : paceDelta < -0.009
      ? `${money(Math.abs(paceDelta))}/dia abaixo do seu ritmo típico`
      : "alinhado ao seu ritmo típico";
  const lines = [
    `Hoje você tem ${money(s.available_today)} disponível.`,
    `Neste mês: entradas ${money(s.current_month_income)} e gastos de consumo ${money(s.current_month_expense)}.`,
    `Seu ritmo está em ${money(s.daily_pace)}/dia; o típico é ${money(s.typical_daily_pace)}/dia — ${pace}.`,
  ];
  if (Number(s.card_due_this_month ?? 0) > 0) {
    lines.push(`Cartão a vencer na competência: ${money(s.card_due_this_month)}${s.card_due_estimated ? " (estimado pelas parcelas e compras conhecidas)" : " (fatura oficial)"}.`);
  }
  const otherDebt = Array.isArray(s.active_debts)
    ? s.active_debts.reduce((sum: number, debt: any) => sum + Number(debt.outstanding_balance ?? 0), 0)
    : 0;
  if (otherDebt > 0) lines.push(`Dívidas ativas fora do cartão: ${money(otherDebt)}.`);
  lines.push(`Considerando ${money(s.known_future_commitments)} de outros compromissos conhecidos, a projeção para o fim do mês é ${money(s.projected_month_end_available)}.`);
  return lines.join("\n");
}

export function formatGoalsOverview(result: any): string {
  const personal = Array.isArray(result.items) ? result.items : [];
  const categories = Array.isArray(result.category_goals) ? result.category_goals : [];
  const shared = Array.isArray(result.shared_goals) ? result.shared_goals : [];
  if (!personal.length && !categories.length && !shared.length) {
    return "Você ainda não tem metas cadastradas. Posso te ajudar a criar uma meta financeira, de categoria, doação ou conjunta.";
  }
  const lines = [`Visão geral das suas metas: ${PCT.format(Number(result.overall_attainment_pct ?? 0))}% de atingimento geral.`];
  for (const item of personal.slice(0, 8)) {
    lines.push(`• ${item.name}: ${money(item.achieved)} de ${money(item.target)} (${PCT.format(Number(item.attainment_pct ?? 0))}%). Falta ${money(item.remaining)}.`);
  }
  for (const item of categories.slice(0, 8)) {
    lines.push(`• Categoria ${item.name}: ${money(item.achieved)} usados de ${money(item.target)}; ${money(item.remaining)} disponíveis.`);
  }
  for (const item of shared.slice(0, 5)) {
    lines.push(`• Meta conjunta ${item.title}: alvo de ${money(item.target_amount)}${item.deadline ? ` até ${item.deadline}` : ""}.`);
  }
  return lines.join("\n");
}

export function formatBeforeSpending(result: any): string {
  const amount = Number(result.amount ?? 0);
  const date = String(result.planned_date ?? "hoje");
  const lines = [`Simulação de ${money(amount)} em ${date}:`];
  const scenarios = Array.isArray(result.scenarios) ? result.scenarios : [];
  if (scenarios.length > 1) {
    for (const scenario of scenarios) {
      const label = scenario.method === "card" ? `no cartão${scenario.card?.name ? ` ${scenario.card.name}` : ""}` : "à vista/conta";
      lines.push(
        `• ${label}: disponível agora ${money(scenario.available_after_now)}; fechamento do mês ${money(scenario.projected_month_end_after)}${scenario.cash_impact_date ? `; saída em ${scenario.cash_impact_date}` : ""}.`,
      );
    }
  } else {
    lines.push(
      `• disponível imediatamente: ${money(result.available_today)} → ${money(result.available_after_now)}`,
      `• projeção para o fim do mês: ${money(result.projected_month_end_before)} → ${money(result.projected_month_end_after)}`,
    );
  }
  lines.push(`• compromissos futuros já conhecidos: ${money(result.known_future_commitments)}`);
  const category = result.category_goal_impact;
  if (category) {
    lines.push(
      `• meta de ${category.category_name}: ${money(category.spent_before)} → ${money(category.spent_after)} de ${money(category.limit)}`,
      category.exceeds
        ? `Essa compra ultrapassaria a meta em ${money(Math.abs(Number(category.remaining_after ?? 0)))}.`
        : `Depois da compra, restariam ${money(category.remaining_after)} nessa meta.`,
    );
  } else if (result.category_requested) {
    lines.push("A categoria foi identificada, mas ela não tem uma meta ativa; por isso não há limite de categoria para comparar.");
  } else {
    lines.push("Você não informou a categoria; não presumi uma e não calculei impacto em meta de categoria.");
  }
  if (Array.isArray(result.requires_card_selection) && result.requires_card_selection.length) {
    lines.push(`Para comparar também no crédito, diga qual cartão: ${result.requires_card_selection.map((card: any) => card.name).join(", ")}.`);
  }
  if (Array.isArray(result.limitations) && result.limitations.length) {
    lines.push(`Limitação do cálculo: ${result.limitations.join(" ")}`);
  }
  return lines.join("\n");
}

export function formatRecentTransactions(rows: any[]): string {
  if (!rows.length) return "Ainda não há lançamentos registrados.";
  return ["Seus últimos lançamentos:", ...rows.map((x) =>
    `• ${x.occurred_at} · ${x.type === "expense" ? "−" : "+"}${money(x.amount)}${x.description ? ` · ${x.description}` : ""}`,
  )].join("\n");
}

export function formatSpendingForDate(result: any): string {
  const count = Number(result.transactions_count ?? 0);
  if (count === 0) {
    const excluded = Number(result.excluded_low_confidence ?? 0);
    return excluded > 0
      ? `Não encontrei gastos com data comportamental confiável em ${result.date}. Desconsiderei ${excluded} lançamento${excluded > 1 ? "s" : ""} que parecia${excluded > 1 ? "m" : ""} apenas postagem bancária.`
      : `Não encontrei gastos de consumo em ${result.date}.`;
  }
  const top = Array.isArray(result.categories) && result.categories[0]
    ? ` A maior categoria foi ${result.categories[0].name}, com ${money(result.categories[0].value)}.`
    : "";
  const excluded = Number(result.excluded_low_confidence ?? 0) > 0
    ? ` Desconsiderei ${result.excluded_low_confidence} postagem de baixa confiança para não atribuir ao dia errado.`
    : "";
  return `Em ${result.date}, você gastou ${money(result.total)} em ${count} lançamento${count > 1 ? "s" : ""}.${top}${excluded}`;
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "alta", medium: "média", low: "baixa", insufficient_data: "insuficiente",
};

export function formatForecastMonthClose(result: any): string {
  const point = money(result.point);
  const band = result.low != null && result.high != null
    ? ` Faixa provável entre ${money(result.low)} e ${money(result.high)}.`
    : "";
  const drivers = result.drivers ?? {};
  const lines = [
    `Fechando ${String(result.month ?? "").replace("-", "/")}, a previsão de gasto total é ${point}.${band}`,
    `O que compõe: ${money(drivers.mtd_expense)} já gastos em ${drivers.day_of_month} de ${drivers.days_in_month} dias, mais ${money(drivers.recurring_future)} de compromissos e fatura conhecidos, mais o consumo projetado do restante do mês.`,
  ];
  const provenance = result.provenance ?? {};
  const confidence = CONFIDENCE_LABEL[String(provenance.confidence ?? "")] ?? "não informada";
  const rows = provenance.row_count ?? provenance.sample_size;
  lines.push(`Evidência: ${rows ?? 0} lançamentos do período, motor ${result.model_used}; confiança ${confidence}.`);
  const notes = Array.isArray(result.notes) ? result.notes : [];
  if (notes.length) lines.push(`Limitação: ${notes.join(" ")}`);
  return lines.join("\n");
}

function failureReply(capability: CapabilityDecision, error: string | null): string {
  // Raw provider/database errors stay in telemetry and are never exposed to
  // the user. The response says what failed and whether data was changed.
  const suffix = error ? " O motivo técnico foi registrado para diagnóstico." : "";
  if (capability.name === "before_spending") {
    if (error === "missing_planned_date") return "Preciso da data do gasto para calcular o caixa e a competência corretamente. Nenhum dado foi alterado.";
    if (error === "planned_date_in_past") return "Essa data já passou. Diga uma data de hoje em diante para eu simular sem misturar previsão com histórico; nenhum dado foi alterado.";
    if (error === "category_not_found") return "Não reconheci essa categoria entre as suas categorias cadastradas. Diga o nome como aparece no app; nenhum dado foi alterado.";
    if (error === "card_ambiguous" || error === "card_not_found") return "Preciso saber qual cartão usar para calcular o ciclo e o vencimento corretos. Nenhum dado foi alterado.";
    if (error === "account_not_found") return "Não reconheci a conta informada. Diga o nome como aparece no app; nenhum dado foi alterado.";
    return `Não consegui consultar o motor financeiro para concluir a simulação. Nenhum dado foi alterado.${suffix}`;
  }
  if (capability.name === "goals_overview") {
    return `Não consegui carregar suas metas agora. Nenhuma meta foi alterada.${suffix}`;
  }
  return `Não consegui consultar seus dados financeiros agora. Nenhum dado foi alterado.${suffix}`;
}


export async function executeDeterministicCapability(
  sb: SupabaseClient,
  args: { user_id: string; conversation_id: string; user_text: string; capability: CapabilityDecision },
): Promise<LLMTurn | null> {
  const capability = args.capability;
  if (capability.clarification) {
    return { reply: capability.clarification, steps: 0, tokensIn: 0, tokensOut: 0, toolCalls: [], finish: "stop" };
  }
  if (!capability.required_tool) return null;
  const execution = await runTool({
    sb, user_id: args.user_id, conversation_id: args.conversation_id, user_text: args.user_text,
  }, capability.required_tool, capability.tool_args ?? {}, { timeoutMs: 12_000, maxRetries: 1 });
  const call = {
    step_index: 1, tool_name: execution.tool_name, args: execution.args,
    result: execution.ok ? execution.result : null, ok: execution.ok,
    duration_ms: execution.duration_ms, error: execution.error,
  };
  if (!execution.ok) {
    // Degradação honesta: em vez de "problema técnico", o Nino entrega o que
    // o snapshot canônico consegue provar e diz explicitamente o que faltou.
    const calls = [call];
    if (capability.required_tool !== "get_financial_snapshot") {
      const degraded = await runTool({
        sb, user_id: args.user_id, conversation_id: args.conversation_id, user_text: args.user_text,
      }, "get_financial_snapshot", {}, { timeoutMs: 12_000, maxRetries: 0 });
      calls.push({
        step_index: 2, tool_name: degraded.tool_name, args: degraded.args,
        result: degraded.ok ? degraded.result : null, ok: degraded.ok,
        duration_ms: degraded.duration_ms, error: degraded.error,
      });
      if (degraded.ok) {
        return {
          reply: [
            formatFinancialSnapshot(degraded.result),
            `Não consegui rodar o cálculo completo de ${capability.name} agora, então respondi com a base reconciliada acima. Nenhum dado foi alterado e o motivo técnico ficou registrado.`,
          ].join("\n"),
          steps: 2, tokensIn: 0, tokensOut: 0, toolCalls: calls, finish: "tool_error_degraded",
        };
      }
    }
    return {
      reply: failureReply(capability, execution.error), steps: calls.length, tokensIn: 0, tokensOut: 0,
      toolCalls: calls, finish: "tool_error",
    };
  }
  let reply: string;
  if (capability.name === "financial_snapshot") reply = formatFinancialSnapshot(execution.result);
  else if (capability.name === "goals_overview") reply = formatGoalsOverview(execution.result);
  else if (capability.name === "before_spending") reply = formatBeforeSpending(execution.result);
  else if (capability.name === "recent_transactions") reply = formatRecentTransactions(execution.result as any[]);
  else if (capability.name === "weekday_literal") reply = formatSpendingForDate(execution.result);
  else if (capability.name === "forecast_month_close") reply = formatForecastMonthClose(execution.result);
  else return null;
  return { reply, steps: 1, tokensIn: 0, tokensOut: 0, toolCalls: [call], finish: "stop" };
}

