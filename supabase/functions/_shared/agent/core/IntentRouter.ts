// IntentRouter — thin wrapper over the deterministic interpreter, with an
// early hint for visualization requests so callers can route to the analytical
// engine before the LLM step. Onda 3.5 do plano consolidado.
import { interpret, type ParsedIntent } from "../parser.ts";

export type RoutedIntent = {
  intent: ParsedIntent;
  /** Determinístico: usuário pediu algo visual (gráfico/imagem). */
  visualization_hint: boolean;
};

const VIZ_RX =
  /\b(gr[áa]ficos?|visual(?:iza[cç][aã]o)?|imagem|foto|print|prints?creen|screenshot|chart|plot|desenh[oa])\b/i;

export function routeIntent(text: string, now: Date = new Date()): RoutedIntent {
  const intent = interpret(text, now);
  const visualization_hint = typeof text === "string" && VIZ_RX.test(text);
  return { intent, visualization_hint };
}
