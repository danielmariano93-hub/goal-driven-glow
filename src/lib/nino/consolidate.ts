import type { FinancialSituation } from "./diagnosis";

function tokens(value: string): Set<string> {
  return new Set(value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 3));
}

function similarity(a: FinancialSituation, b: FinancialSituation): number {
  if (a.situation_type !== b.situation_type) return 0;
  const left = tokens(`${a.headline} ${a.one_line_summary ?? ""}`);
  const right = tokens(`${b.headline} ${b.one_line_summary ?? ""}`);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  return [...left].filter((word) => right.has(word)).length / union.size;
}

/** Une mensagens semanticamente equivalentes e preserva a mais relevante. */
export function consolidateSituations(items: FinancialSituation[]): FinancialSituation[] {
  const ordered = [...items].sort((a, b) => b.relevance_score - a.relevance_score);
  const groups: FinancialSituation[][] = [];
  for (const item of ordered) {
    const group = groups.find((candidate) => similarity(candidate[0], item) >= 0.5);
    if (group) group.push(item); else groups.push([item]);
  }
  return groups.map((group) => ({
    ...group[0],
    evaluation: { ...group[0].evaluation, consolidated_count: group.length },
  }));
}
