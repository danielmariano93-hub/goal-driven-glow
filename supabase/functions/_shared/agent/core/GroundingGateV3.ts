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

function directionState(labels: string[]) {
  const normalized = new Set(labels.map((label) => String(label).trim().toLowerCase()));
  return {
    increase: ["up", "increase", "aumento", "subiu"].some((label) => normalized.has(label)),
    decrease: ["down", "decrease", "queda", "caiu"].some((label) => normalized.has(label)),
    noIncrease: normalized.has("no_increase"),
    noDecrease: normalized.has("no_decrease"),
    flat: normalized.has("flat"),
  };
}

function directionMentions(reply: string) {
  // O formatter canônico pode dizer "Aumentaram: nenhuma" ou
  // "Nenhuma dessas categorias diminuiu". Essas frases são evidência de AUSÊNCIA
  // de uma direção, não uma afirmação positiva daquela direção. Removemos essas
  // cláusulas antes de procurar verbos positivos para não transformar negação em
  // direction_inverted.
  const noIncreasePatterns = [
    /\baumentaram\s*:\s*nenhuma\b/gi,
    /\bnenhuma(?:\s+dessas)?\s+categorias?\s+aumentou\b[^.!\n]*/gi,
    /\bn(?:ã|a)o\s+(?:houve|teve)\s+aumento\b[^.!\n]*/gi,
    /\bsem\s+aumento\b[^.!\n]*/gi,
    /\bn(?:ã|a)o\s+aument(?:ou|aram)\b[^.!\n]*/gi,
  ];
  const noDecreasePatterns = [
    /\bdiminu(?:í|i)ram\s*:\s*nenhuma\b/gi,
    /\bnenhuma(?:\s+dessas)?\s+categorias?\s+diminuiu\b[^.!\n]*/gi,
    /\bn(?:ã|a)o\s+(?:houve|teve)\s+(?:queda|redu(?:ç|c)ão)\b[^.!\n]*/gi,
    /\bsem\s+(?:queda|redu(?:ç|c)ão)\b[^.!\n]*/gi,
    /\bn(?:ã|a)o\s+(?:diminuiu|caiu|reduziu)\b[^.!\n]*/gi,
  ];

  const saysNoIncrease = noIncreasePatterns.some((rx) => {
    rx.lastIndex = 0;
    return rx.test(reply);
  });
  const saysNoDecrease = noDecreasePatterns.some((rx) => {
    rx.lastIndex = 0;
    return rx.test(reply);
  });

  let positiveText = reply;
  for (const rx of [...noIncreasePatterns, ...noDecreasePatterns]) {
    rx.lastIndex = 0;
    positiveText = positiveText.replace(rx, " ");
  }

  return {
    saysNoIncrease,
    saysNoDecrease,
    saysUp: /\b(aumentou|aumentaram|subiu|subiram|cresceu|cresceram|aumento\s+de|maior\s+que)\b/i.test(positiveText),
    saysDown: /\b(diminuiu|diminuíram|diminuiram|caiu|caíram|cairam|reduziu|reduziram|queda\s+de|menor\s+que)\b/i.test(positiveText),
  };
}

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

  // Direção: distingue afirmação positiva de negação/ausência. Ex.:
  // "Diminuíram: nenhuma" NÃO significa que houve queda; significa no_decrease.
  const directionLabels = claims
    .filter((c) => c.type === "direction" && c.label)
    .map((c) => String(c.label).toLowerCase());
  if (directionLabels.length) {
    const expected = directionState(directionLabels);
    const said = directionMentions(reply);
    const positiveMismatch = (said.saysUp && !expected.increase) || (said.saysDown && !expected.decrease);
    const absenceMismatch = (said.saysNoIncrease && !expected.noIncrease) || (said.saysNoDecrease && !expected.noDecrease);
    if (positiveMismatch || absenceMismatch) {
      verdicts.push({
        kind: "direction",
        token: directionLabels.join(","),
        status: "semantic_mismatch",
        detail: positiveMismatch ? "direction_inverted" : "direction_absence_mismatch",
      });
    } else if (said.saysUp || said.saysDown || said.saysNoIncrease || said.saysNoDecrease) {
      verdicts.push({
        kind: "direction",
        token: directionLabels.join(","),
        status: "exact",
        detail: null,
      });
    }
  }

  const violations = verdicts.filter((v) => v.status === "unbacked" || v.status === "semantic_mismatch");
  return { version: "nino_grounding.v3", ok: violations.length === 0, verdicts, violations };
}
