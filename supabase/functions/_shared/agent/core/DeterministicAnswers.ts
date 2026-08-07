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
    `Considerando ${money(s.known_future_commitments)} de compromissos conhecidos, a projeção para o fim do mês é ${money(s.projected_month_end_available)}.`,
  ];
  if (s.cards_owed_estimated) lines.push("O valor de cartão contém estimativa porque nem todas as faturas oficiais estão disponíveis.");
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
  const lines = [
    `Simulação de ${money(amount)} em ${date}:`,
    `• disponível imediatamente: ${money(result.available_today)} → ${money(result.available_after_now)}`,
    `• projeção para o fim do mês: ${money(result.projected_month_end_before)} → ${money(result.projected_month_end_after)}`,
    `• compromissos futuros já conhecidos: ${money(result.known_future_commitments)}`,
  ];
  const category = result.category_goal_impact;
  if (category) {
    lines.push(
      `• meta de ${category.category_name}: ${money(category.spent_before)} → ${money(category.spent_after)} de ${money(category.limit)}`,
      category.exceeds
        ? `Essa compra ultrapassaria a meta em ${money(Math.abs(Number(category.remaining_after ?? 0)))}.`
        : `Depois da compra, restariam ${money(category.remaining_after)} nessa meta.`,
    );
  } else {
    lines.push("Não encontrei uma meta ativa para a categoria informada; por isso o impacto por categoria não entrou no cálculo.");
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

function failureReply(capability: CapabilityDecision, error: string | null): string {
  // Raw provider/database errors stay in telemetry and are never exposed to
  // the user. The response says what failed and whether data was changed.
  const suffix = error ? " O motivo técnico foi registrado para diagnóstico." : "";
  if (capability.name === "before_spending") {
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
    return {
      reply: failureReply(capability, execution.error), steps: 1, tokensIn: 0, tokensOut: 0,
      toolCalls: [call], finish: "tool_error",
    };
  }
  let reply: string;
  if (capability.name === "financial_snapshot") reply = formatFinancialSnapshot(execution.result);
  else if (capability.name === "goals_overview") reply = formatGoalsOverview(execution.result);
  else if (capability.name === "before_spending") reply = formatBeforeSpending(execution.result);
  else if (capability.name === "recent_transactions") reply = formatRecentTransactions(execution.result as any[]);
  else if (capability.name === "weekday_literal") reply = formatSpendingForDate(execution.result);
  else return null;
  return { reply, steps: 1, tokensIn: 0, tokensOut: 0, toolCalls: [call], finish: "stop" };
}
