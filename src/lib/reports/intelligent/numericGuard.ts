// Guardrail numérico: nenhum número inventado pela IA pode chegar ao usuário.
// Qualquer valor monetário/percentual presente no texto precisa existir no
// conjunto de números permitidos (métricas + destaques + payload).
import { round2 } from "@/lib/engine/facts";

export interface GuardResult {
  ok: boolean;
  offending: string[];
}

/** Extrai todos os números citáveis de um objeto arbitrário. */
export function collectAllowedNumbers(source: unknown, acc: Set<number> = new Set()): Set<number> {
  if (source === null || source === undefined) return acc;
  if (typeof source === "number" && Number.isFinite(source)) {
    acc.add(round2(Math.abs(source)));
    acc.add(Math.round(Math.abs(source)));
    return acc;
  }
  if (Array.isArray(source)) {
    for (const item of source) collectAllowedNumbers(item, acc);
    return acc;
  }
  if (typeof source === "object") {
    for (const value of Object.values(source as Record<string, unknown>)) collectAllowedNumbers(value, acc);
  }
  return acc;
}

const NUMBER_RX = /-?\d{1,3}(?:\.\d{3})*(?:,\d+)?|-?\d+(?:[.,]\d+)?/g;

function parseBrNumber(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? Math.abs(n) : null;
}

/**
 * Verifica se todos os números citados no texto pertencem ao conjunto
 * permitido. Tolerância de 1 centavo/0,01 ponto para arredondamento.
 */
export function validateNumbers(text: string, allowed: Set<number>): GuardResult {
  const offending: string[] = [];
  const matches = text.match(NUMBER_RX) ?? [];
  for (const raw of matches) {
    const value = parseBrNumber(raw);
    if (value === null) continue;
    // Números pequenos usados como contagem/ordinal em linguagem natural.
    if (Number.isInteger(value) && value <= 31) continue;
    const rounded = round2(value);
    const hit = [...allowed].some((a) => Math.abs(a - rounded) <= 0.02 || Math.abs(Math.round(a) - Math.round(rounded)) < 1);
    if (!hit) offending.push(raw);
  }
  return { ok: offending.length === 0, offending: [...new Set(offending)] };
}
