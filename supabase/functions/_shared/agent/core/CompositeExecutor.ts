// CompositeExecutor (`nino_brain.v2`) — executa perguntas compostas de verdade.
//
// O ConversationOrchestrator decompõe a mensagem em `tasks[]`. Aqui cada
// subtarefa é roteada para a capability/ferramenta canônica, executada com o
// mesmo período do turno, deduplicada e formatada por um formatter
// determinístico. A LLM não precisa "lembrar" de responder tudo: o Core
// responde cada parte com o número que o motor calculou.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { runTool } from "./ToolRuntime.ts";
import { classifyCapability, type CapabilityDecision } from "./CapabilityRouter.ts";
import { routeIntent } from "./IntentRouter.ts";
import { interpretSemanticQuery } from "../../intelligence/semanticQuery.ts";
import type { TurnPlan } from "./ConversationOrchestrator.ts";
import {
  formatFinancialSnapshot, formatForecastMonthClose, formatGoalsOverview,
  formatMerchantDistribution, formatFinancialEvolution, formatBeforeSpending,
  formatRecentTransactions, formatSpendingForDate,
} from "./DeterministicAnswers.ts";

export type CompositeTaskStatus = "ok" | "empty" | "failed" | "skipped_duplicate" | "not_deterministic";

export type CompositeTask = {
  index: number;
  text: string;
  capability: string;
  tool: string | null;
  args: Record<string, unknown>;
  status: CompositeTaskStatus;
  block: string | null;
  result?: unknown;
};

export type CompositeOutcome = {
  tasks: CompositeTask[];
  answered: number;
  reply: string;
  toolCalls: any[];
};

/** Ferramentas que aceitam período explícito — o turno compartilha from/to. */
const PERIOD_TOOLS = new Set([
  "merchant_distribution", "analyze_merchants", "analyze_spending", "compare_periods",
  "merchant_profile", "analyze_cost_structure", "find_savings_opportunities",
  "detect_spending_anomalies", "explain_behavior_change", "spending_timeseries_daily",
]);

const FORMATTERS: Record<string, (result: any) => string> = {
  financial_snapshot: formatFinancialSnapshot,
  goals_overview: formatGoalsOverview,
  before_spending: formatBeforeSpending,
  recent_transactions: (r) => formatRecentTransactions(r as any[]),
  weekday_literal: formatSpendingForDate,
  forecast_month_close: formatForecastMonthClose,
  merchant_distribution: formatMerchantDistribution,
  financial_evolution: formatFinancialEvolution,
};

function headline(result: any): string | null {
  const h = result?.answer_format?.headline ?? result?.headline;
  return typeof h === "string" && h.trim().length > 8 ? h.trim() : null;
}

function formatBlock(capability: string, result: unknown): string | null {
  const formatter = FORMATTERS[capability];
  if (formatter) {
    try {
      const text = formatter(result as any);
      if (text && text.trim()) return text.trim();
    } catch { /* cai para a headline canônica */ }
  }
  return headline(result);
}

function keyOf(tool: string, args: Record<string, unknown>): string {
  return `${tool}:${JSON.stringify(Object.entries(args).sort(([a], [b]) => a.localeCompare(b)))}`;
}

/**
 * Executa as subtarefas do plano do turno. Retorna `null` quando a mensagem não
 * é composta ou quando nenhuma subtarefa tem rota determinística — nesses casos
 * o fluxo normal (planner com LLM) segue valendo.
 */
export async function executeComposite(
  sb: SupabaseClient,
  args: { user_id: string; conversation_id: string; plan: TurnPlan },
): Promise<CompositeOutcome | null> {
  const plan = args.plan;
  if (!plan.composed || plan.tasks.length < 2) return null;

  const decisions: Array<{ text: string; capability: CapabilityDecision }> = plan.tasks.map((text) => ({
    text,
    capability: classifyCapability(text, routeIntent(text).intent, interpretSemanticQuery(text)),
  }));
  const deterministic = decisions.filter((d) => d.capability.required_tool && !d.capability.clarification);
  if (deterministic.length < 2) return null;

  const tasks: CompositeTask[] = [];
  const toolCalls: any[] = [];
  const seen = new Map<string, CompositeTask>();

  for (let i = 0; i < decisions.length; i++) {
    const { text, capability } = decisions[i];
    const tool = capability.required_tool;
    if (!tool || capability.clarification) {
      tasks.push({
        index: i, text, capability: capability.name, tool: null, args: {},
        status: "not_deterministic", block: null,
      });
      continue;
    }
    const toolArgs: Record<string, unknown> = { ...(capability.tool_args ?? {}) };
    if (PERIOD_TOOLS.has(tool)) {
      toolArgs.from = plan.effective_period.from;
      toolArgs.to = plan.effective_period.to;
    }
    const key = keyOf(tool, toolArgs);
    const previous = seen.get(key);
    if (previous) {
      // Chamada redundante: reaproveita a evidência já obtida, sem repetir custo.
      tasks.push({
        index: i, text, capability: capability.name, tool, args: toolArgs,
        status: "skipped_duplicate", block: null, result: previous.result,
      });
      continue;
    }

    const execution = await runTool(
      { sb, user_id: args.user_id, conversation_id: args.conversation_id, user_text: text },
      tool, toolArgs, { timeoutMs: 12_000, maxRetries: 1 },
    );
    toolCalls.push({
      step_index: toolCalls.length + 1, tool_name: execution.tool_name, args: execution.args,
      result: execution.ok ? execution.result : null, ok: execution.ok,
      duration_ms: execution.duration_ms, error: execution.error,
    });
    if (!execution.ok) {
      const task: CompositeTask = {
        index: i, text, capability: capability.name, tool, args: toolArgs,
        status: "failed", block: null,
      };
      tasks.push(task); seen.set(key, task);
      continue;
    }
    const block = formatBlock(capability.name, execution.result);
    const task: CompositeTask = {
      index: i, text, capability: capability.name, tool, args: toolArgs,
      status: block ? "ok" : "empty", block, result: execution.result,
    };
    tasks.push(task); seen.set(key, task);
  }

  const blocks: string[] = [];
  const unanswered: string[] = [];
  for (const task of tasks) {
    if (task.status === "ok" && task.block) blocks.push(task.block);
    else if (task.status === "skipped_duplicate") continue;
    else unanswered.push(task.text);
  }

  const answered = tasks.filter((t) => t.status === "ok").length;
  if (answered === 0) return null;

  if (unanswered.length) {
    // Nunca inventamos resposta: dizemos exatamente qual parte ficou de fora.
    blocks.push(
      `Sobre "${unanswered[0].replace(/\s+/g, " ").slice(0, 90)}" eu não consegui fechar o número agora — te respondo essa parte assim que der.`,
    );
  }

  return { tasks, answered, reply: blocks.join("\n\n"), toolCalls };
}
