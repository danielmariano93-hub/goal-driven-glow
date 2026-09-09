// SignalGrouping (`nino_narrative.v1`)
//
// Vários sinais que contam a MESMA história viram uma leitura só: um fato
// principal e apoios. Nada é recalculado — só reordenado e agrupado.
// deno-lint-ignore-file no-explicit-any
import type { CommunicationCandidate } from "../../intelligence/contracts.ts";

const SEVERITY_RANK: Record<string, number> = { info: 1, attention: 2, critical: 3 };

/** Assunto do sinal: categoria, meta, cartão, dívida ou o próprio tipo. */
export function subjectKeyOf(candidate: Pick<CommunicationCandidate, "kind" | "dedup_key"> & {
  evidence?: Record<string, unknown> | null;
}): string {
  const ev = (candidate.evidence ?? {}) as Record<string, unknown>;
  const explicit = [ev.subject_key, ev.category_id, ev.category, ev.category_name, ev.goal_id, ev.card_id, ev.debt_id]
    .map((v) => (v == null ? "" : String(v).trim().toLowerCase()))
    .find((v) => v.length > 0);
  if (explicit) return explicit;
  return String(candidate.dedup_key ?? candidate.kind ?? "").toLowerCase();
}

/** Domínio grosseiro do sinal, para saber quando dois sinais falam do mesmo tema. */
export function domainOf(kind: string): string {
  const k = String(kind ?? "");
  if (/goal/.test(k)) return "goals";
  if (/debt/.test(k)) return "debts";
  if (/card/.test(k)) return "cards";
  if (/cash|imbalance|pressure/.test(k)) return "cashflow";
  if (/spend|category|merchant|impulsive|emotional|weekday|weekend|month_phase|small_spend/.test(k)) return "spending";
  if (/saving|subscription/.test(k)) return "opportunity";
  return "other";
}

export type SignalGroup<T> = {
  group_key: string;
  primary: T;
  supporting: T[];
};

function score(candidate: any): number {
  const severity = SEVERITY_RANK[String(candidate?.severity ?? "info")] ?? 1;
  const impact = Math.abs(Number((candidate?.evidence ?? {}).impact_amount ?? 0)) || 0;
  return severity * 1_000_000 + impact;
}

/**
 * Agrupa por assunto quando ele existe e por domínio quando o assunto é o
 * próprio tipo — assim "ritmo acima do normal" + "mobilidade" + "lazer" viram
 * uma leitura de gastos, não três avisos.
 */
export function groupSignals<T extends Pick<CommunicationCandidate, "kind" | "dedup_key" | "severity">>(
  candidates: T[],
): Array<SignalGroup<T>> {
  const buckets = new Map<string, T[]>();
  for (const candidate of candidates) {
    const subject = subjectKeyOf(candidate as any);
    const domain = domainOf(candidate.kind);
    const key = subject === String(candidate.dedup_key ?? "").toLowerCase() ? `domain:${domain}` : `subject:${subject}`;
    const list = buckets.get(key) ?? [];
    list.push(candidate);
    buckets.set(key, list);
  }
  return [...buckets.entries()].map(([group_key, list]) => {
    const ordered = [...list].sort((a, b) => score(b) - score(a));
    return { group_key, primary: ordered[0], supporting: ordered.slice(1) };
  });
}
