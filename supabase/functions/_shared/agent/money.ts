// Conversor único de valor em reais para as ferramentas do agente.
// Antes havia 3 cópias idênticas de `numberValue` (ciclo de vida de lançamento/meta/recorrência), uma variante com
// porcentagem e um `brMoney` que lia "10.80" como 1080. Todas passam por aqui; a regra mora em `parseBrAmount`.
//   "10,80" -> 10.8 · "R$ 1.250,50" -> 1250.5 · "1.250" -> 1250 (milhar) · "10.80" -> 10.8 · 21 -> 21 · "" -> null
import { parseBrAmount } from "./parser.ts";

export function moneyValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return parseBrAmount(raw);
}
