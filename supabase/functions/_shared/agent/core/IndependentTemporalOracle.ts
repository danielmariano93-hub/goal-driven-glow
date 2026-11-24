// Independent high-confidence temporal oracle for financial comparisons.
//
// This is a CLOSED grammar for two calendar relations, NOT a second general
// intent model. It only recognizes unambiguous current-month vs immediately
// preceding-month requests and refuses to infer on all other utterances.
// The oracle never repairs the IR: it can only veto an executed scope.
// It uses NinoClock's local civil date, not UTC slices or hardcoded offsets.
import { daysInMonth, previousMonth, today as localToday } from "../../finance-core/ninoClock.ts";

import type { CanonicalConversationTurnContract } from "./ConversationTurnContract.ts";

/**
 * Grounding eligibility is part of the canonical boundary: do not convert
 * ordinary language, writes, advisory turns or compound financial operations
 * into a different query. Only the already-approved single compare query may
 * receive a deterministic calendar relation.
 */
export function scopeForSingleComparison(
  turn: CanonicalConversationTurnContract,
  text: string,
  referenceDay?: string,
): IndependentMonthComparison | null {
  if (turn.mode !== "read" || turn.domain !== "financial_read") return null;
  if (turn.financial_read?.queries.length !== 1) return null;
  if (turn.financial_read.queries[0].operation !== "compare") return null;
  return independentMonthComparison(text, referenceDay);
}

/**
 * Deterministic temporal grounding of a V3 comparison contract. This is the
 * ONLY write to the comparison's resolved windows: the compiler and the
 * fulfillment proof consume the exact same pair. Source semantics (metric,
 * entities, operations, filter, comparison type) are left untouched.
 */
export function groundComparisonTurn(
  turn: CanonicalConversationTurnContract,
  resolved: IndependentMonthComparison,
): CanonicalConversationTurnContract {
  const target = `${resolved.target.from}..${resolved.target.to}`;
  const baseline = `${resolved.baseline.from}..${resolved.baseline.to}`;
  return {
    ...turn,
    focus: {
      ...turn.focus,
      period_expression: target,
      period_expressions: [baseline, target],
    },
    resolution: { ...turn.resolution, time: "resolved" },
  };
}

export type TemporalWindow = { from: string; to: string };
export type IndependentMonthComparison = {
  target: TemporalWindow;
  baseline: TemporalWindow;
  mode: "same_elapsed_days" | "previous_full_month";
};

const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// A narrow spelling normalizer for the CLOSED temporal vocabulary. The
// normalization is shared by grounding and the final independent oracle, so
// ordinary human typos cannot bypass the proof and release incorrect numbers.
// No general-purpose natural-language intent decisions occur here.
function adjacentTranspose(actual: string, canonical: string): boolean {
  if (actual.length !== canonical.length || actual === canonical) return false;
  const mismatches: number[] = [];
  for (let i = 0; i < actual.length; i++) if (actual[i] !== canonical[i]) mismatches.push(i);
  return mismatches.length === 2 && mismatches[1] === mismatches[0] + 1
    && actual[mismatches[0]] === canonical[mismatches[1]]
    && actual[mismatches[1]] === canonical[mismatches[0]];
}

function missingOneLetter(actual: string, canonical: string): boolean {
  if (canonical.length - actual.length !== 1) return false;
  for (let i = 0; i < canonical.length; i++) {
    if (canonical.slice(0, i) + canonical.slice(i + 1) === actual) return true;
  }
  return false;
}

const normalize = (text: string) => {
  const simple = String(text ?? "").toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/([aeiou])\1+/g, "$1")
    .replace(/\s+/g, " ").trim();
  const tokens = simple.split(" ");
  return tokens.map((token, index) => {
    if (token.startsWith("com") && adjacentTranspose(token, "comparado")) return "comparado";
    if (index > 0 && tokens[index - 1] === "mes"
      && (adjacentTranspose(token, "anterior") || missingOneLetter(token, "anterior"))) return "anterior";
    if (index > 0 && tokens[index - 1] === "mes"
      && (adjacentTranspose(token, "passado") || missingOneLetter(token, "passado"))) return "passado";
    return token;
  }).join(" ");
};

const comp = /\b(compar(?:a|ando|ar|acao|ado|e|o)?|versus|vs|diferenc|relacao|mais ou menos|aument|dimin|subiu|caiu)\b/;
const current = /\b(?:esse|este|neste|nesse) mes\b|\b(?:ate|até) (?:agora|hoje|o momento)\b/;
const prior = /\bmes (?:passado|anterior)\b/;
const full = /\b(?:inteiro|inteira|completo|completa|todo|toda|fechado|fechada)\b/;

/** Build an independent source-text scope only when the intended calendar
 * relation is unambiguous. Explicit day/range restrictions are delegated to
 * the general temporal resolver instead of being silently overridden. */
export function independentMonthComparison(
  text: string,
  referenceDay: string = localToday(),
): IndependentMonthComparison | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDay)) return null;
  const d = new Date(`${referenceDay}T12:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== referenceDay) return null;
  const message = normalize(text);
  if (!comp.test(message) || !current.test(message)) return null;
  if (/\b(?:dia|dias)\s+\d{1,2}\b|\b(?:de|do)\s+\d{1,2}\s+(?:a|ate)\s+\d{1,2}\b/.test(message)) return null;

  const month = referenceDay.slice(0, 7);
  const prev = previousMonth(month);
  const previousName = MONTHS[Number(prev.slice(5, 7)) - 1];
  const namesMentioned = MONTHS.filter(m => new RegExp(`\\b${m}\\b`).test(message));
  // A named non-previous month makes the high-confidence current/previous
  // policy inapplicable; another comparison may be fully intentional.
  if (namesMentioned.some(n => n !== previousName && n !== MONTHS[Number(month.slice(5, 7)) - 1])) return null;
  const previousReference = prior.test(message) || namesMentioned.includes(previousName);
  if (!previousReference) return null;

  const explicitFull = new RegExp(`\\b(?:mes (?:passado|anterior)|${previousName}) (?:inteiro|inteira|completo|completa|todo|toda|fechado|fechada)\\b`).test(message);
  // A 'whole month' adjective not attached to the baseline is ambiguous.
  if (full.test(message) && !explicitFull) return null;
  // On the last day the current month is complete; the implicit comparison
  // convention is not unambiguous, so do not force a partial-month rule.
  if (!explicitFull && Number(referenceDay.slice(8, 10)) === daysInMonth(month)) return null;
  const mode = explicitFull ? "previous_full_month" : "same_elapsed_days";
  const prevEnd = daysInMonth(prev);
  const day = Math.min(Number(referenceDay.slice(8, 10)), prevEnd);
  const baselineTo = mode === "previous_full_month" ? prevEnd : day;
  return {
    mode,
    target: { from: `${month}-01`, to: referenceDay },
    baseline: { from: `${prev}-01`, to: `${prev}-${String(baselineTo).padStart(2, "0")}` },
  };
}
