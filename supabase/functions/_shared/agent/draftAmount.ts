// Valor do rascunho de lançamento. O interpretador entrega o valor como texto ("10,80", "R$ 1.250,50") ou número;
// `Number("10,80")` dá NaN e o Nino respondia "não consegui preparar o rascunho" para um pedido claro.
import { parseBrAmount } from "./parser.ts";
import { parseSpelledMoney } from "./amountWords.ts";

export function resolveDraftAmount(rawArg: unknown, userText: string): number | null {
  const fromArg = typeof rawArg === "number" ? rawArg : typeof rawArg === "string" ? parseBrAmount(rawArg) : null;
  if (fromArg != null && Number.isFinite(fromArg) && fromArg > 0) return fromArg;
  const spelled = parseSpelledMoney(String(userText ?? ""));
  return spelled != null && spelled > 0 ? spelled : null;
}
