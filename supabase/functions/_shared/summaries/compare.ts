// Regras de comparabilidade da especificação (seção "Comparações"):
// Δ% só com base positiva; base zero → "novo gasto"; ambos zero → "sem variação"; sem base → "sem comparação";
// troca de sinal → só a diferença em reais. Cores neutras: a comparação nunca pinta o número.
import { brl, pct } from "./format.ts";

export interface Comparison { delta_cents: number | null; delta_pct: number | null; text: string }

export function compareCents(current: number | null, reference: number | null, label: string, opts: { spend?: boolean } = {}): Comparison {
  if (current == null) return { delta_cents: null, delta_pct: null, text: "não disponível" };
  if (reference == null) return { delta_cents: null, delta_pct: null, text: "sem comparação" };
  const delta = current - reference;
  if (current === 0 && reference === 0) return { delta_cents: 0, delta_pct: null, text: "sem variação" };
  if (reference === 0) {
    return { delta_cents: delta, delta_pct: null, text: opts.spend && current > 0 ? `novo gasto ${label}` : `${brl(delta, { sign: true })} ${label}` };
  }
  if (delta === 0) return { delta_cents: 0, delta_pct: 0, text: `sem variação ${label}` };
  const signChange = (current < 0) !== (reference < 0) && current !== 0;
  if (reference < 0 || signChange) return { delta_cents: delta, delta_pct: null, text: `${brl(delta, { sign: true })} ${label}` };
  const p = delta / reference;
  return { delta_cents: delta, delta_pct: Math.round(p * 10000) / 10000, text: `${brl(delta, { sign: true })} (${pct(p)}) ${label}` };
}
