// IntentRouter — thin wrapper over the deterministic interpreter.
// Extracted for the Agent Core unified pipeline (subetapa 12.4).
// Behavior unchanged: we only give the intent step a stable, named boundary
// so both channels route through the same classification.
import { interpret, type ParsedIntent } from "../parser.ts";

export type RoutedIntent = { intent: ParsedIntent };

export function routeIntent(text: string, now: Date = new Date()): RoutedIntent {
  return { intent: interpret(text, now) };
}
