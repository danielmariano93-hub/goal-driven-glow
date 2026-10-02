// GroundingGate V3 (`nino_semantic_ir.v3`)
//
// Gate #3: a RESPOSTA GERADA respeitou exatamente a evidência? Complementa o
// TruthValidator com validação semântica de dinheiro, ranking, direção,
// entidades e agora também do PERÍODO exibido ao usuário.
import type { EvidenceClaimSet } from "./EvidenceClaims.ts";

export type ClaimVerdict = {
  kind: "money" | "percentage" | "rank" | "entity" | "direction" | "absence" | "period";
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

function brToIso(day: string, month: string, year: string): string | null {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const iso = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const parsed = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/** Extract only explicit user-visible period labels, not arbitrary dates in rows. */
function explicitPeriodMentions(reply: string): Array<{ token: string; from: string; to: string }> {
  const mentions: Array<{ token: string; from: string; to: string }> = [];
  const rangeRx = /\b(?:entre|de|do\s+per[ií]odo\s+de)\s*(\d{1,2})\/(\d{1,2})\/(20\d{2})\s*(?:e|a|at[eé])\s*(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/gi;
  for (const match of reply.matchAll(rangeRx)) {
    const from = brToIso(match[1], match[2], match[3]);
    const to = brToIso(match[4], match[5], match[6]);
    if (from && to) mentions.push({ token: match[0], from, to });
  }
  const singleRx = /\b(?:em|no\s+dia|dia)\s*(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/gi;
  for (const match of reply.matchAll(singleRx)) {
    const day = brToIso(match[1], match[2], match[3]);
    if (day) mentions.push({ token: match[0], from: day, to: day });
  }
  return mentions;
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
      values.some((v) => Math.abs(v - value) < 0.5)
      || values.some((a) => values.some((b) => cents(Math.abs(a - b)) === cents(value)))
    );
    verdicts.push({
      kind: "money",
      token,
      status: exact ? "exact" : derived ? "derived_allowed" : "unbacked",
      detail: exact || derived ? null : "money_not_in_evidence",
    });
  }

  for (const match of reply.matchAll(/(-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s?%/g)) {
    const token = match[1];
    const value = Number(token.replace(/\./g, "").replace(",", "."));
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

  // User-visible date range must be the period proved by engine evidence.
  const periodClaims = new Set(
    claims.filter((c) => c.type === "period" && c.label).map((c) => String(c.label)),
  );
  for (const mention of explicitPeriodMentions(reply)) {
    const label = `${mention.from}..${mention.to}`;
    const exact = periodClaims.has(label);
    verdicts.push({
      kind: "period",
      token: mention.token,
      status: exact ? "exact" : "semantic_mismatch",
      detail: exact ? null : `period_not_in_evidence:${label}`,
    });
  }

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
