// Formato canônico de resposta do Nino (`nino_answer_format.v1`).
//
// Toda resposta analítica tem a MESMA estrutura, montada a partir do envelope
// determinístico das tools — nunca escrita à mão pela LLM:
//
//   1. resultado (número principal)
//   2. delta explicado (drivers da tool)
//   3. base (período, amostra, confiança)
//
// Este módulo só TRADUZ fatos já calculados em texto curto pt-BR. Ele não
// soma, não divide e não infere nada.

import type { EngineEnvelope, EngineEvidence, EngineConfidence } from "../finance-core/engineEnvelope.ts";
import type { Provenance, Confidence } from "../analytics/provenance.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function brl(n: number | null | undefined): string {
  return BRL.format(Number(n ?? 0));
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "confiança alta",
  medium: "confiança média",
  low: "confiança baixa",
  insufficient_data: "dados insuficientes",
  insufficient: "dados insuficientes",
};

export function confidenceLabel(c: EngineConfidence | Confidence | string | null | undefined): string {
  return CONFIDENCE_LABEL[String(c ?? "")] ?? "confiança não informada";
}

export function formatDatePt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return String(iso);
  return `${d}/${m}/${y}`;
}

/** Linha de base: período + amostra + confiança. Uma frase, sempre igual. */
export function describeEvidence(
  evidence: EngineEvidence | Provenance | null | undefined,
): string {
  if (!evidence) return "Base: sem evidência disponível — não posso afirmar número.";
  const period = "period" in evidence && evidence.period
    ? evidence.period
    : null;
  const from = period ? formatDatePt((period as { from: string }).from) : "—";
  const to = period ? formatDatePt((period as { to: string }).to) : "—";
  const sample = "sample_size" in evidence
    ? Number(evidence.sample_size ?? 0)
    : Number((evidence as Provenance).row_count ?? 0);
  const version = "formula_version" in evidence ? evidence.formula_version : "";
  const confidence = "confidence" in evidence
    ? confidenceLabel((evidence as Provenance).confidence)
    : "confiança não informada";
  const comparison = "comparison_period" in evidence && evidence.comparison_period
    ? ` · comparado com ${formatDatePt(evidence.comparison_period.from)}–${formatDatePt(evidence.comparison_period.to)}`
    : "";
  return `Base: ${from}–${to}${comparison} · ${sample} lançamento(s) · ${confidence}${version ? ` · ${version}` : ""}`;
}

/** Frase honesta quando não há amostra — nunca projetar número nesse caso. */
export function insufficientDataSentence(sampleSize: number): string {
  return sampleSize > 0
    ? `Ainda estou aprendendo seu ritmo: tenho só ${sampleSize} lançamento(s) nessa janela, então não dou número firme.`
    : "Ainda não tenho lançamentos suficientes nessa janela para afirmar número.";
}

export type DeltaDriver = {
  label?: string | null;
  name?: string | null;
  delta_abs?: number | null;
  amount?: number | null;
  value?: number | null;
};

/** Delta explicado a partir dos drivers já calculados pelo motor. */
export function describeDelta(
  drivers: DeltaDriver[] | null | undefined,
  opts?: { limit?: number; total?: number | null },
): string {
  const list = (drivers ?? []).filter(Boolean);
  if (list.length === 0) return "Não há driver identificado para essa variação.";
  const limit = opts?.limit ?? 3;
  const parts = list.slice(0, limit).map((d) => {
    const label = d.label ?? d.name ?? "sem identificação";
    const value = Number(d.delta_abs ?? d.amount ?? d.value ?? 0);
    const sign = value > 0 ? "+" : value < 0 ? "−" : "";
    return `${label} (${sign}${brl(Math.abs(value))})`;
  });
  const head = opts?.total != null
    ? `Variação de ${brl(opts.total)} explicada por: `
    : "Principais responsáveis: ";
  return head + parts.join(", ") + ".";
}

/** Resposta completa no formato canônico (resultado → delta → base). */
export function formatEngineAnswer(input: {
  headline: string;
  envelope: { evidence: EngineEvidence; confidence: EngineConfidence; drivers?: DeltaDriver[] } | null;
  deltaTotal?: number | null;
  driverLimit?: number;
}): string {
  const env = input.envelope;
  if (!env) return "Não tenho evidência para responder isso com número.";
  if (env.confidence === "insufficient_data") {
    return [insufficientDataSentence(env.evidence.sample_size), describeEvidence(env.evidence)].join("\n");
  }
  return [
    input.headline,
    describeDelta(env.drivers, { limit: input.driverLimit, total: input.deltaTotal }),
    describeEvidence(env.evidence),
  ].join("\n");
}

/** Anexa ao resultado da tool o bloco de narrativa pronto. */
export function withAnswerFormat<F, B, D>(
  envelope: EngineEnvelope<F, B, D>,
  headline: string,
  deltaTotal?: number | null,
): Record<string, unknown> {
  return {
    ...envelope,
    answer_format: {
      version: "nino_answer_format.v1",
      headline,
      delta_line: describeDelta(envelope.drivers as DeltaDriver[], { total: deltaTotal ?? null }),
      evidence_line: describeEvidence(envelope.evidence),
      confidence_label: confidenceLabel(envelope.confidence),
    },
  };
}
