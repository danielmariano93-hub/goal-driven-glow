// TruthValidator (`nino_brain.v2`) — gate factual entre CALCULAR e CONVERSAR.
//
// Regra: nenhum número apresentado ao usuário pode contradizer o que os motores
// determinísticos calcularam. Quando a resposta inventa valor ou período, o
// Core troca a resposta pela headline canônica da própria ferramenta.
// deno-lint-ignore-file no-explicit-any

export type TruthIssue =
  | { type: "value_not_in_evidence"; value: number }
  | { type: "percent_not_in_evidence"; value: number }
  | { type: "period_mismatch"; expected: string; found: string }
  | { type: "direction_mismatch"; expected: "below" | "above" | "equal"; found: string }
  | { type: "no_evidence" };

export type ClaimProvenance = {
  kind: "money" | "percent";
  value: number;
  /** Ferramenta que sustenta o número; `null` quando não há proveniência. */
  tool_name: string | null;
  /** exact = veio do motor; derived = soma/diferença/razão da evidência. */
  origin: "exact" | "derived" | "unbacked";
};

export type TruthVerdict = {
  ok: boolean;
  issues: TruthIssue[];
  /** Headline canônica disponível para substituir a resposta, se preciso. */
  canonical_headline: string | null;
  /** Rastreabilidade claim -> ferramenta (auditoria e telemetria). */
  provenance: ClaimProvenance[];
  /** Claims sem proveniência (subconjunto de `provenance`). */
  unbacked: ClaimProvenance[];
};

const MONEY_RX = /R\$\s*(-?\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|-?\d+(?:[.,]\d{1,2})?)/g;
const PERCENT_RX = /(-?\d{1,3}(?:[.,]\d{1,2})?)\s*%/g;
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

function collectDirections(value: unknown, out: Set<"below" | "above" | "equal">, depth = 0): void {
  if (depth > 8 || value == null) return;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (record.direction === "below" || record.direction === "above" || record.direction === "equal") {
      out.add(record.direction);
    }
    for (const item of Object.values(record)) collectDirections(item, out, depth + 1);
  }
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

  // Índice número -> ferramentas que o produziram (proveniência por claim).
  const byValue = new Map<number, string[]>();
  const indexTool = (tool: string, result: unknown) => {
    const numbers = new Set<number>();
    collectNumbers(result, numbers);
    for (const n of numbers) {
      const list = byValue.get(n) ?? [];
      if (!list.includes(tool)) list.push(tool);
      byValue.set(n, list);
    }
  };
  for (const call of okCalls) indexTool(call.tool_name, call.result);
  const toolFor = (value: number, tolerance = 1): string | null => {
    for (const [n, tools] of byValue) if (Math.abs(n - value) <= tolerance) return tools[0] ?? null;
    return null;
  };
  const provenance: ClaimProvenance[] = [];

  const claimed: number[] = [];
  for (const match of String(reply ?? "").matchAll(MONEY_RX)) {
    const value = parseBrl(match[1]);
    if (Number.isFinite(value) && value > 0) claimed.push(Math.round(value * 100) / 100);
  }

  // V2: percentuais/shares também são fatos. Ninguém "estima" participação.
  const claimedPercents: number[] = [];
  for (const match of String(reply ?? "").matchAll(PERCENT_RX)) {
    const value = Math.abs(Number(String(match[1]).replace(",", ".")));
    if (Number.isFinite(value)) claimedPercents.push(Math.round(value * 10) / 10);
  }

  if (claimed.length === 0 && claimedPercents.length === 0) {
    return { ok: true, issues, canonical_headline, provenance, unbacked: [] };
  }
  if (okCalls.length === 0) {
    const unbacked: ClaimProvenance[] = [
      ...claimed.map((value) => ({ kind: "money" as const, value, tool_name: null, origin: "unbacked" as const })),
      ...claimedPercents.map((value) => ({ kind: "percent" as const, value, tool_name: null, origin: "unbacked" as const })),
    ];
    return { ok: false, issues: [{ type: "no_evidence" }], canonical_headline, provenance: unbacked, unbacked };
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
    if (near(value)) provenance.push({ kind: "money", value, tool_name: toolFor(value), origin: "exact" });
    else if (derived(value)) provenance.push({ kind: "money", value, tool_name: null, origin: "derived" });
    else {
      provenance.push({ kind: "money", value, tool_name: null, origin: "unbacked" });
      issues.push({ type: "value_not_in_evidence", value });
    }
  }

  // Um percentual é aceito quando: (a) o motor já o entregou (0..100 ou 0..1
  // como share/delta_pct/coverage), ou (b) é a razão exata entre dois valores
  // da evidência (tolerância de 1 ponto percentual).
  const percentKnown = (value: number) => {
    if (knownList.some((k) => Math.abs(k - value) <= 1)) return true;
    if (knownList.some((k) => k <= 1.0001 && Math.abs(k * 100 - value) <= 1)) return true;
    return knownList.some((a) =>
      a > 0 && knownList.some((b) => b > 0 && Math.abs((b / a) * 100 - value) <= 1)
    );
  };
  for (const value of claimedPercents) {
    if (value <= 0) continue;
    if (percentKnown(value)) {
      provenance.push({
        kind: "percent", value,
        tool_name: toolFor(value) ?? toolFor(value / 100, 0.01),
        origin: toolFor(value) ? "exact" : "derived",
      });
    } else {
      provenance.push({ kind: "percent", value, tool_name: null, origin: "unbacked" });
      issues.push({ type: "percent_not_in_evidence", value });
    }
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


  // Gate semântico geral: a existência do número não basta. Quando a resposta
  // faz uma afirmação global de direção, ela precisa existir estruturalmente na
  // evidência canônica, sem inferência livre do modelo.
  const replyText = String(reply ?? "").toLocaleLowerCase("pt-BR");
  const claimedDirection = /\b(gastou|gasto|ficou|total|conjunto)[^.\n]{0,100}\b(menos|abaixo)\b/.test(replyText)
    ? "below"
    : /\b(gastou|gasto|ficou|total|conjunto)[^.\n]{0,100}\b(mais|acima)\b/.test(replyText)
      ? "above"
      : null;
  if (claimedDirection) {
    const directions = new Set<"below" | "above" | "equal">();
    for (const call of okCalls) collectDirections(call.result, directions);
    if (directions.size > 0 && !directions.has(claimedDirection)) {
      issues.push({
        type: "direction_mismatch",
        expected: directions.has("below") ? "below" : directions.has("above") ? "above" : "equal",
        found: claimedDirection,
      });
    }
  }


  const unbacked = provenance.filter((c) => c.origin === "unbacked");
  return { ok: issues.length === 0, issues, canonical_headline, provenance, unbacked };
}
