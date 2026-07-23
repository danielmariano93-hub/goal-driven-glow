// explain_spending_change — decomposição causal de delta entre dois períodos.
// Contribuição = (total_b - total_a) por grupo. Percentual sobre o delta
// positivo total (para não somar >100%). Só descreve; não afirma causalidade.
import type { CompareResult } from "./compare.ts";
import { makeProvenance, type Provenance } from "./provenance.ts";

export type AttributionResult = {
  delta_total: number;
  positive_delta_total: number;
  contributions: Array<{
    name: string;
    delta_abs: number;
    pct_of_positive_delta: number | null;
    direction: "up" | "down" | "flat";
  }>;
  residual: number;
  samples_ok: boolean;
  provenance: Provenance;
};

export const FORMULA_VERSION = "attribute.v1";

export function computeAttribution(cmp: CompareResult): AttributionResult {
  const positive = cmp.by_group.filter(g => g.delta_abs > 0).reduce((s, g) => s + g.delta_abs, 0);
  const contributions = cmp.by_group.map(g => {
    const dir: "up" | "down" | "flat" = g.delta_abs > 0.005 ? "up" : g.delta_abs < -0.005 ? "down" : "flat";
    const pct = positive > 0 && g.delta_abs > 0 ? g.delta_abs / positive : null;
    return {
      name: g.name,
      delta_abs: round2(g.delta_abs),
      pct_of_positive_delta: pct === null ? null : round4(pct),
      direction: dir,
    };
  });

  const sumContribs = contributions.reduce((s, c) => s + c.delta_abs, 0);
  const residual = round2(cmp.delta_abs - sumContribs);

  const samples_ok = cmp.provenance.confidence !== "insufficient_data";

  return {
    delta_total: round2(cmp.delta_abs),
    positive_delta_total: round2(positive),
    contributions,
    residual,
    samples_ok,
    provenance: makeProvenance({
      from: cmp.provenance.period.from,
      to: cmp.provenance.period.to,
      row_count: cmp.provenance.row_count,
      formula_version: FORMULA_VERSION,
      confidence: cmp.provenance.confidence,
      notes: samples_ok ? undefined : ["Amostra pequena; use como descritivo, não como causa."],
    }),
  };
}

function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function round4(n: number) { return Math.round((n + Number.EPSILON) * 10000) / 10000; }
