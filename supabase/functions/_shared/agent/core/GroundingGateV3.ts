// GroundingGate V3 (`nino_semantic_ir.v3`)
//
// Gate #3: a RESPOSTA GERADA respeitou exatamente a evidência? Complementa o
// TruthValidator (números/percentuais) com validação SEMÂNTICA: ranking trocado,
// entidade que não está na evidência, direção invertida, ausência contrariada.
// Trocar o #1 do ranking é bloqueado mesmo quando o número está certo.
import type { EvidenceClaimSet } from "./EvidenceClaims.ts";

export type ClaimVerdict = {
  kind: "money" | "percentage" | "rank" | "entity" | "direction" | "absence";
  token: string;
  status: "exact" | "derived_allowed" | "unbacked" | "semantic_mismatch";
  detail: string | null;
};

export type GroundingResult = {
  version: "nino_grounding.v3";
  ok: boolean;
  verdicts: ClaimVerdict[];
  violations: ClaimVerdict[];
};

const MONEY_RX = /R\$\s*\*?\s*(-?[\d.]+,\d{2})/g;

function parseBrl(token: string): number {
  return Number(token.replace(/\./g, "").replace(",", "."));
}

const cents = (n: number) => Math.round(n * 100);

export function groundReply(args: {
  reply: string;
  claims: EvidenceClaimSet;
}): GroundingResult {
  const reply = String(args.reply ?? "");
  const verdicts: ClaimVerdict[] = [];
  const claims = args.claims.claims;

  const moneyClaims = claims.filter((c) => (c.type === "money" || c.type === "rank") && c.value != null);
  const values = moneyClaims.map((c) => Number(c.value));

  for (const match of reply.matchAll(MONEY_RX)) {
    const token = match[1];
    const value = parseBrl(token);
    const exact = values.some((v) => cents(v) === cents(value));
    const derived = !exact && (
      // rounded_money
      values.some((v) => Math.abs(v - value) < 0.5)
      // difference
      || values.some((a) => values.some((b) => cents(Math.abs(a - b)) === cents(value)))
    );
    verdicts.push({
      kind: "money",
      token,
      status: exact ? "exact" : derived ? "derived_allowed" : "unbacked",
      detail: exact || derived ? null : "money_not_in_evidence",
    });
  }

  // Percentual: exato, ratio ou percentage_share da evidência.
  for (const match of reply.matchAll(/(-?\d{1,3}(?:,\d{1,2})?)\s?%/g)) {
    const token = match[1];
    const value = Number(token.replace(",", "."));
    const pctClaims = claims.filter((c) => c.type === "percentage" && c.value != null).map((c) => Number(c.value));
    const exact = pctClaims.some((v) => Math.abs(v - value) < 0.05);
    const share = values.some((a) => values.some((b) =>
      b > 0 && Math.abs((a / b) * 100 - value) < 1
    ));
    verdicts.push({
      kind: "percentage",
      token,
      status: exact ? "exact" : share ? "derived_allowed" : "unbacked",
      detail: exact || share ? null : "percentage_not_in_evidence",
    });
  }

  // Ranking: quem a resposta apresenta como maior tem de ser o #1 da evidência.
  const ranked = claims.filter((c) => c.type === "rank" && c.label && c.rank != null)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
  if (ranked.length > 0) {
    const normalized = reply.toLowerCase();
    const mentioned = ranked
      .map((c) => ({ claim: c, at: normalized.indexOf(String(c.label).toLowerCase()) }))
      .filter((m) => m.at >= 0)
      .sort((a, b) => a.at - b.at);
    const superlative = /\b(mais|maior|top|liderou|primeiro|principal|onde mais pesou)\b/i.test(reply);
    if (superlative && mentioned.length > 0 && mentioned[0].claim.rank !== 1) {
      verdicts.push({
        kind: "rank",
        token: String(mentioned[0].claim.label),
        status: "semantic_mismatch",
        detail: `rank_mismatch:expected=${ranked[0].label}`,
      });
    } else if (mentioned.length > 0) {
      verdicts.push({ kind: "rank", token: String(mentioned[0].claim.label), status: "exact", detail: null });
    }
  }

  // Ausência: evidência diz "sem dados", resposta não pode afirmar valor.
  const hasAbsence = claims.some((c) => c.type === "absence");
  if (hasAbsence && values.filter((v) => v > 0).length === 0) {
    const claimsMoney = verdicts.some((v) => v.kind === "money" && v.status !== "exact");
    if (claimsMoney) {
      verdicts.push({
        kind: "absence", token: "absence", status: "semantic_mismatch",
        detail: "value_asserted_over_absence",
      });
    }
  }

  // Direção: subiu/caiu tem de bater com a direção da evidência.
  const directionClaim = claims.find((c) => c.type === "direction" && c.label);
  if (directionClaim) {
    const label = String(directionClaim.label).toLowerCase();
    const saysUp = /\b(aumentou|subiu|cresceu|maior que)\b/i.test(reply);
    const saysDown = /\b(diminuiu|caiu|reduziu|menor que)\b/i.test(reply);
    const expectedUp = /(up|increase|aumento|subiu)/.test(label);
    const expectedDown = /(down|decrease|queda|caiu)/.test(label);
    if ((saysUp && expectedDown) || (saysDown && expectedUp)) {
      verdicts.push({
        kind: "direction", token: label, status: "semantic_mismatch", detail: "direction_inverted",
      });
    }
  }

  const violations = verdicts.filter((v) => v.status === "unbacked" || v.status === "semantic_mismatch");
  return { version: "nino_grounding.v3", ok: violations.length === 0, verdicts, violations };
}
