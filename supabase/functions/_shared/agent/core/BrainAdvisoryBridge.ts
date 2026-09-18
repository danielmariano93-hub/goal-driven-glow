// BrainAdvisoryBridge (nino_advisory_bridge.v2)
//
// Conversation Brain is the ONLY authority for advisory intent. This bridge
// binds the already-resolved advisory_kind to existing deterministic engines.
// It never classifies the user's language again.

import type { CapabilityDecision } from "./CapabilityRouter.ts";
import type { ConversationTurnContract } from "./ConversationTurnContract.ts";
import { parseBrAmountWithScale } from "../parser.ts";

export type AdvisoryBridgeResult = {
  version: "nino_advisory_bridge.v2";
  capability: CapabilityDecision;
  reason: string;
};

function targetAmount(text: string): number | undefined {
  const raw = String(text ?? "");
  const money = raw.match(/r\$\s*(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*(?:mil|mi|k|milh(?:ao|oes|ão|ões)))?/i);
  if (!money?.[1]) return undefined;
  const suffix = String(money[2] ?? "");
  const value = parseBrAmountWithScale(money[1], suffix);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

const MONTH_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6,
  sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
};

function monthsFrom(text: string): number | undefined {
  const normalized = String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  const hit = normalized.match(/\b(?:ultimos?|proximos?|em|nos?)\s+(\d{1,2}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s+mes(?:es)?\b/);
  const token = String(hit?.[1] ?? "");
  const value = /^\d+$/.test(token) ? Number(token) : (MONTH_WORDS[token] ?? 0);
  return value >= 3 && value <= 36 ? value : undefined;
}

function normalizedPeriod(contract: ConversationTurnContract): string {
  return String(contract.focus.period_expression ?? contract.focus.period_expressions?.[0] ?? "")
    .toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function cap(
  name: CapabilityDecision["name"],
  tool: string,
  reason: string,
  args: Record<string, unknown> = {},
): AdvisoryBridgeResult {
  return {
    version: "nino_advisory_bridge.v2",
    reason,
    capability: {
      name,
      execution: "deterministic",
      allowed_tools: [tool],
      required_tool: tool,
      context: { metrics: true },
      tool_args: args,
      reason,
    },
  };
}

export function resolveBrainAdvisory(
  contract: ConversationTurnContract,
): AdvisoryBridgeResult | null {
  if (contract.mode !== "read" || contract.domain !== "advisory") return null;
  const kind = contract.advisory_kind ?? null;
  if (!kind) return null;
  const raw = String(contract.canonical_request ?? "").trim();
  const months = monthsFrom(raw);

  switch (kind) {
    case "current_insight": {
      // O significado (insight) vem do Brain; aqui só vinculamos o escopo
      // temporal já resolvido a um engine existente. Insight de hoje usa dicas
      // ativas; insight do mês usa os destaques factuais do mês corrente.
      const period = normalizedPeriod(contract);
      const monthScoped = /\bmes\b|\bmensal\b/.test(period);
      return monthScoped
        ? cap("insights", "get_spending_highlights", "turn_contract:current_month_insight")
        : cap("insights", "get_daily_insights", "turn_contract:current_daily_insight", { limit: 3 });
    }
    case "next_best_action":
      return cap("next_best_action", "get_next_best_action", "turn_contract:next_best_action", {
        ...(months ? { months } : {}),
      });
    case "goal_strategy":
      return cap("goal_strategy", "get_goal_strategy", "turn_contract:goal_strategy", {
        ...(contract.focus.goal ? { goal: contract.focus.goal } : {}),
      });
    case "wealth_opportunity":
      return cap("wealth_opportunity", "analyze_wealth_opportunity", "turn_contract:wealth_opportunity", {
        ...(months ? { months } : {}),
      });
    case "financial_plan": {
      const target = targetAmount(raw);
      return cap("financial_plan", "build_financial_plan", "turn_contract:financial_plan", {
        ...(target ? { target_amount: target } : {}),
        ...(contract.focus.goal ? { goal: contract.focus.goal } : {}),
        ...(months ? { months } : {}),
      });
    }
    default:
      return null;
  }
}
