// TruthValidator (`nino_brain.v2`) — gate factual entre CALCULAR e CONVERSAR.
//
// Regra: nenhum número apresentado ao usuário pode contradizer o que os motores
// determinísticos calcularam. Quando a resposta inventa valor ou período, o
// Core troca a resposta pela headline canônica da própria ferramenta.
// deno-lint-ignore-file no-explicit-any

export type TruthIssue =
  | { type: "value_not_in_evidence"; value: number }
  | { type: "period_mismatch"; expected: string; found: string }
  | { type: "no_evidence" };

export type TruthVerdict = {
  ok: boolean;
  issues: TruthIssue[];
  /** Headline canônica disponível para substituir a resposta, se preciso. */
  canonical_headline: string | null;
};

const MONEY_RX = /R\$\s*(-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|-?\d+(?:[.,]\d{1,2})?)/g;
const YMD_RX = /\b(20\d{2})-(\d{2})-(\d{2})\b/g;

function parseBrl(raw: string): number {
  const cleaned = raw.replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.abs(n) : NaN;
}

/** Todos os números presentes no resultado das ferramentas (recursivo). */
function collectNumbers(value: unknown, out: Set<number>, depth = 0): void {
  if (depth > 8 || value == null) return;
  if (typeof value === "number" && Number.isFinite(value)) {
    out.add(Math.abs(Math.round(value * 100) / 100));
    return;
  }
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) out.add(Math.abs(Math.round(n * 100) / 100));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectNumbers(item, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectNumbers(item, out, depth + 1);
  }
}

function extractHeadline(result: any): string | null {
  const headline = result?.answer_format?.headline ?? result?.headline;
  return typeof headline === "string" && headline.trim().length > 12 ? headline.trim() : null;
}

/**
 * Reconcilia a resposta com a evidência das ferramentas.
 * Tolerância de R$ 1,00 (arredondamentos de apresentação) e derivações
 * simples (soma/diferença de dois valores da evidência) são aceitas.
 */
export function validateAgainstEvidence(
  reply: string,
  toolCalls: Array<{ tool_name: string; ok: boolean; result?: unknown }>,
  expectedPeriod?: { from: string; to: string } | null,
): TruthVerdict {
  const issues: TruthIssue[] = [];
  const okCalls = (toolCalls ?? []).filter((c) => c.ok && c.result != null);
  const canonical_headline = okCalls.map((c) => extractHeadline(c.result)).find(Boolean) ?? null;

  const claimed: number[] = [];
  for (const match of String(reply ?? "").matchAll(MONEY_RX)) {
    const value = parseBrl(match[1]);
    if (Number.isFinite(value) && value > 0) claimed.push(Math.round(value * 100) / 100);
  }

  if (claimed.length === 0) {
    return { ok: true, issues, canonical_headline };
  }
  if (okCalls.length === 0) {
    return { ok: false, issues: [{ type: "no_evidence" }], canonical_headline };
  }

  const known = new Set<number>();
  for (const call of okCalls) collectNumbers(call.result, known);
  const knownList = [...known];
  const near = (value: number) => knownList.some((k) => Math.abs(k - value) <= 1);
  const derived = (value: number) =>
    knownList.some((a, i) => knownList.slice(i + 1).some((b) =>
      Math.abs(a + b - value) <= 1 || Math.abs(Math.abs(a - b) - value) <= 1
    ));

  for (const value of claimed) {
    if (!near(value) && !derived(value)) issues.push({ type: "value_not_in_evidence", value });
  }

  if (expectedPeriod?.from) {
    for (const match of String(reply ?? "").matchAll(YMD_RX)) {
      const found = match[0];
      if (found < expectedPeriod.from || found > expectedPeriod.to) {
        issues.push({ type: "period_mismatch", expected: `${expectedPeriod.from}..${expectedPeriod.to}`, found });
        break;
      }
    }
  }

  return { ok: issues.length === 0, issues, canonical_headline };
}
