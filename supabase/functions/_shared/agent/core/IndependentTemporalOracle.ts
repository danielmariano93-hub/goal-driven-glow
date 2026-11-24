// Independent high-confidence temporal oracle for financial comparisons.
//
// This is a CLOSED grammar for two calendar relations, NOT a second general
// intent model. It only recognizes unambiguous current-month vs immediately
// preceding-month requests and refuses to infer on all other utterances.
// The oracle never repairs the IR: it can only veto an executed scope.
// It uses NinoClock's local civil date, not UTC slices or hardcoded offsets.
import { daysInMonth, previousMonth, today as localToday } from "../../finance-core/ninoClock.ts";

export type TemporalWindow = { from: string; to: string };
export type IndependentMonthComparison = {
  target: TemporalWindow;
  baseline: TemporalWindow;
  mode: "same_elapsed_days" | "previous_full_month";
};

const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const normalize = (text: string) => String(text ?? "").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "").replace(/([aeiou])\1+/g, "$1").replace(/\s+/g, " ").trim();

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
