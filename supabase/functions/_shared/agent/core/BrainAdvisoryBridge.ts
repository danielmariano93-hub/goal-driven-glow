// BrainAdvisoryBridge (nino_advisory_bridge.v1)
//
// Conversation Brain remains the authority of meaning. This module does NOT
// classify the raw user turn again: it receives the Brain's canonical request
// and only binds a small set of high-confidence advisory intents to existing
// deterministic financial engines.
//
// Why it exists: advisory engines such as get_next_best_action and
// build_financial_plan predate FinancialQueryIR and are not monetary query
// primitives. Sending them through the generic semantic IR can incorrectly
// produce "unsupported" even though Nino already has a canonical engine.
import type { CapabilityDecision } from "./CapabilityRouter.ts";
import type { ConversationTurnContract } from "./ConversationTurnContract.ts";
import { parseBrAmountWithScale } from "../parser.ts";

export type AdvisoryBridgeResult = {
  version: "nino_advisory_bridge.v1";
  capability: CapabilityDecision;
  reason: string;
};

function norm(text: string): string {
  return String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function targetAmount(text: string): number | undefined {
  const raw = String(text ?? "");
  const money = raw.match(/r\$\s*(\d+(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(\s*(?:mil|mi|k|milh(?:ao|oes|ão|ões)))?/i);
  if (!money?.[1]) return undefined;
  const suffix = String(money[2] ?? "");
  const value = parseBrAmountWithScale(money[1], suffix);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function monthsFrom(text: string): number | undefined {
  const t = norm(text);
  const hit = t.match(/\b(?:ultimos?|proximos?|em|nos?)\s+(\d{1,2})\s+mes(?:es)?\b/);
  const value = Number(hit?.[1] ?? 0);
  return value >= 3 && value <= 36 ? value : undefined;
}

function cap(
  name: CapabilityDecision["name"],
  tool: string,
  reason: string,
  args: Record<string, unknown> = {},
): AdvisoryBridgeResult {
  return {
    version: "nino_advisory_bridge.v1",
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
  if (contract.mode !== "read") return null;
  const raw = String(contract.canonical_request ?? "").trim();
  const t = norm(raw);
  if (!t) return null;

  // Holistic "what should I do now?" — one canonical next action based on
  // cash, debt pressure, goals and wealth-building evidence.
  const nextBest =
    /\bqual (?:e )?o meu proximo passo financeiro\b/.test(t)
    || /\bo que (?:eu )?devo fazer agora (?:com|pelo|pro) (?:o |meu )?dinheiro\b/.test(t)
    || /\bpor onde (?:eu )?comeco (?:financeiramente|a organizar minha vida financeira)\b/.test(t)
    || /\bcomo (?:eu )?comeco a construir patrimonio\b/.test(t)
    || /\bqual (?:e )?a melhor coisa que (?:eu )?posso fazer agora (?:financeiramente|com meu dinheiro)\b/.test(t)
    || /\bo que mais mudaria minha vida financeira agora\b/.test(t)
    || /\bproxima melhor acao\b.*\b(financeir|dinheiro|patrimonio|meta)/.test(t)
    || /\bo que (?:voce|vc) me (?:sugere|recomenda) agora\b.*\b(financeir|dinheiro|patrimonio|vida financeira)/.test(t)
    || /\bqual (?:e )?a sua sugestao pra mim agora\b.*\b(financeir|dinheiro|patrimonio|vida financeira)/.test(t);
  if (nextBest) {
    const months = monthsFrom(raw);
    return cap("next_best_action", "get_next_best_action", "brain_advisory_next_best_action", {
      ...(months ? { months } : {}),
    });
  }

  // Goal strategy is different from merely reading goal progress: the user is
  // explicitly asking for direction on how to reach it.
  const goalStrategy = /\bmeta\w*\b/.test(t)
    && /\b(como (?:faco|fazer|chego|chegar|consigo|conseguir|atinjo|atingir|bater|alcanco|alcancar)|o que (?:faco|fazer|preciso|devo)|plano|estrategia|dicas?|me ajuda|ajuda a|caminho|passos?|quanto (?:preciso|devo|tenho que) (?:guardar|separar|economizar))\b/.test(t);
  if (goalStrategy) {
    return cap("goal_strategy", "get_goal_strategy", "brain_advisory_goal_strategy", {
      ...(contract.focus.goal ? { goal: contract.focus.goal } : {}),
    });
  }

  const wealthOpportunity =
    /\bpoderia ter (?:guardado|acumulado|investido)\b/.test(t)
    || /\bquanto (?:eu )?perdi gastando\b/.test(t)
    || /\bquanto consigo (?:guardar|poupar)\b/.test(t)
    || /\bpatrimonio (?:possivel|potencial)\b/.test(t)
    || /\bse eu tivesse (?:guardado|economizado)\b/.test(t);
  if (wealthOpportunity) {
    const months = monthsFrom(raw);
    return cap("wealth_opportunity", "analyze_wealth_opportunity", "brain_advisory_wealth_opportunity", {
      ...(months ? { months } : {}),
    });
  }

  const financialPlan =
    /\b(?:monte?|montar|faz|fazer|cria[r]?|elabora[r]?) (?:um )?plano\b/.test(t)
    || /\bplano (?:para|pra) (?:eu )?(?:chegar|juntar|alcancar|ter)\b/.test(t)
    || /\bcomo (?:eu )?(?:chego|faco para chegar|junto) (?:a|em|nos?) r?\$?\s?\d/.test(t);
  if (financialPlan) {
    const target = targetAmount(raw);
    const months = monthsFrom(raw);
    return cap("financial_plan", "build_financial_plan", "brain_advisory_financial_plan", {
      ...(target ? { target_amount: target } : {}),
      ...(contract.focus.goal ? { goal: contract.focus.goal } : {}),
      ...(months ? { months } : {}),
    });
  }

  return null;
}
