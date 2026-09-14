// MultiPeriodAnswer (`period_truth.v2`)
//
// Resposta de leitura multi-período: cada período nomeado com o SEU número, sem
// misturar recortes numa única frase. Os números continuam saindo do bloco
// determinístico do motor — este módulo só rotula e ordena.
// deno-lint-ignore-file no-explicit-any
import { semanticBlockText } from "./SemanticAnswerFormatter.ts";

export type MultiPeriodOutcome = {
  query_id: string;
  engine: string | null;
  status: string;
  result: unknown;
};

function titleCase(label: string): string {
  const clean = String(label ?? "").trim();
  if (!clean) return clean;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function totalOf(result: any): number | null {
  const raw = result?.total_metric
    ?? result?.totals?.[result?.metric === "income" ? "income" : "expense"];
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function money(value: number): string {
  return `R$ ${value.toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d)),/g, ".")}`;
}

/**
 * Texto rotulado por período. `null` quando não há bloco utilizável — nesse caso
 * o chamador segue com o texto determinístico normal.
 */
export function multiPeriodText(args: {
  outcomes: MultiPeriodOutcome[];
  labels: Record<string, string>;
  /** Ordem dos períodos pedida pelo usuário. */
  periodOrder: string[];
  comparison_intent: boolean;
}): string | null {
  const blocks: Array<{ label: string; text: string; total: number | null }> = [];
  for (const label of args.periodOrder) {
    for (const outcome of args.outcomes) {
      if (args.labels[outcome.query_id] !== label) continue;
      if (outcome.status !== "ok") continue;
      const text = semanticBlockText(outcome.engine, outcome.result);
      if (!text || !text.trim()) continue;
      blocks.push({ label, text: text.trim(), total: totalOf(outcome.result) });
    }
  }
  if (blocks.length < 2) return null;

  const lines = blocks.map((b) => `*${titleCase(b.label)}*\n${b.text}`);

  // Comparação declarada entre dois períodos: a diferença é derivada dos dois
  // números já apresentados (nunca de uma terceira fonte).
  if (args.comparison_intent && blocks.length === 2
    && blocks[0].total != null && blocks[1].total != null) {
    const delta = blocks[1].total - blocks[0].total;
    const direction = delta > 0 ? "mais" : "menos";
    if (Math.abs(delta) >= 0.01) {
      lines.push(
        `${titleCase(blocks[1].label)} ficou ${money(Math.abs(delta))} ${direction} que ${blocks[0].label}.`,
      );
    } else {
      lines.push(`Os dois períodos ficaram praticamente iguais.`);
    }
  }

  return lines.join("\n\n").trim();
}
