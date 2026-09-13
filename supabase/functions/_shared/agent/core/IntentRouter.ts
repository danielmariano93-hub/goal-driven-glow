// IntentRouter — thin wrapper over the deterministic interpreter, with an
// early hint for visualization requests so callers can route to the analytical
// engine before the LLM step. Onda 3.5 do plano consolidado.
import { interpret, type ParsedIntent } from "../parser.ts";
import { isExplicitRepair } from "./ConversationRepair.ts";

export type RoutedIntent = {
  intent: ParsedIntent;
  /** Determinístico: usuário pediu algo visual (gráfico/imagem). */
  visualization_hint: boolean;
};

const VIZ_RX =
  /\b(gr[áa]ficos?|visual(?:iza[cç][aã]o)?|imagem|foto|print|prints?creen|screenshot|chart|plot|desenh[oa])\b/i;

export function routeIntent(text: string, now: Date = new Date()): RoutedIntent {
  // REPAIR é um ato conversacional, não um comando de cancelamento. O parser
  // legado ainda aceita negações curtas; este boundary impede que uma correção
  // como "não foi isso" alcance PolicyEngine como `cancel` antes do DialogueAct.
  const intent: ParsedIntent = isExplicitRepair(text)
    ? { kind: "unknown", text: String(text ?? "") }
    : interpret(text, now);
  const visualization_hint = typeof text === "string" && VIZ_RX.test(text);
  return { intent, visualization_hint };
}
