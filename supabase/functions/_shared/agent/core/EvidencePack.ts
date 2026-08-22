// EvidencePack (`nino_efficiency.v1`) — compressão SEMÂNTICA do resultado de
// ferramenta antes de entrar no prompt.
//
// Contrato: toda tool continua devolvendo o resultado completo (`full`), que é
// persistido em `agent_tool_calls` e alimenta artifacts/auditoria. O modelo
// recebe apenas o `evidence`: fatos, comparação, top drivers, confiança,
// qualidade de dado e versão de fórmula.
//
// Princípio inviolável: nada é RECALCULADO aqui. A compressão só SELECIONA e
// ORDENA campos já calculados pelos motores determinísticos. Truncar JSON no
// meio é proibido — a serialização final passa pelo ContextBudget, que devolve
// sempre JSON válido.
// deno-lint-ignore-file no-explicit-any
import { serializeWithinBudget } from "./ContextBudget.ts";
import { budgetForTool } from "./ToolBudget.ts";

export type EvidencePack = {
  tool: string;
  ok: boolean;
  error: string | null;
  /** JSON já dentro do orçamento — é isto que vai no prompt. */
  json: string;
  full_chars: number;
  llm_chars: number;
  compression_ratio: number;
  compressed: boolean;
};

/**
 * Chaves sempre preservadas quando existem, em ordem de prioridade. São os
 * campos que sustentam uma resposta factual: fato, período, comparação,
 * evidência, confiança e proveniência.
 */
const UNIVERSAL_KEYS = [
  "ok", "status", "kind", "message", "reply", "receipt", "draft_id", "confirmation",
  "facts", "result", "summary", "answer", "verdict", "decision", "recommendation",
  "totals", "total", "amount", "value", "balance", "available_today", "net_worth",
  "period", "as_of", "today", "month_start", "month_end", "days_remaining",
  "comparison", "delta", "delta_pct", "previous", "trend",
  "top", "drivers", "breakdown", "items", "categories", "merchants", "goals",
  "cards", "commitments", "debts", "alerts", "signals", "opportunities",
  "confidence", "sample_size", "data_quality", "limitations", "exclusions",
  "evidence", "formula_version", "formula_versions", "reconciliation_id", "version",
] as const;

/** Listas em que só a cabeça importa para a explicação (o resto é ruído no prompt). */
const HEAD_LIMIT: Readonly<Record<string, number>> = {
  items: 8,
  breakdown: 8,
  categories: 8,
  merchants: 8,
  drivers: 5,
  top: 5,
  alerts: 5,
  signals: 5,
  opportunities: 5,
  goals: 6,
  cards: 6,
  commitments: 8,
  debts: 6,
  transactions: 8,
  series: 31,
  points: 31,
  days: 7,
  weekdays: 7,
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Seleciona campos relevantes e limita a cabeça das listas. Não calcula nada. */
function select(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, HEAD_LIMIT.items).map((item) => select(item, depth + 1));
  }
  if (!isPlainObject(value)) return value;

  const entries = Object.entries(value);
  // Objetos pequenos passam inteiros: comprimir aqui só perderia informação.
  if (depth > 0 && entries.length <= 8) {
    return Object.fromEntries(entries.map(([k, v]) => [k, limitList(k, v, depth)]));
  }

  const out: Record<string, unknown> = {};
  const rank = (key: string) => {
    const i = (UNIVERSAL_KEYS as readonly string[]).indexOf(key);
    return i === -1 ? UNIVERSAL_KEYS.length : i;
  };
  for (const [k, v] of [...entries].sort((a, b) => rank(a[0]) - rank(b[0]))) {
    if (v === null || v === undefined || v === "") continue;
    out[k] = limitList(k, v, depth);
  }
  return out;
}

function limitList(key: string, value: unknown, depth: number): unknown {
  if (Array.isArray(value)) {
    const limit = HEAD_LIMIT[key] ?? HEAD_LIMIT.items;
    const head = value.slice(0, limit).map((item) => select(item, depth + 1));
    if (value.length > limit) head.push(`+${value.length - limit} itens no resultado completo`);
    return head;
  }
  return select(value, depth + 1);
}

/**
 * Constrói o pacote de evidência de uma execução de ferramenta.
 * `toolResult` é o `ToolResult` cru ({ ok, result } | { ok:false, error }).
 */
export function buildEvidencePack(toolName: string, toolResult: unknown): EvidencePack {
  const fullJson = safeStringify(toolResult);
  const ok = isPlainObject(toolResult) ? toolResult.ok !== false : true;
  const error = isPlainObject(toolResult) && typeof toolResult.error === "string"
    ? toolResult.error
    : null;

  if (!ok) {
    const json = safeStringify({ ok: false, error: (error ?? "tool_error").slice(0, 200) });
    return {
      tool: toolName, ok: false, error, json,
      full_chars: fullJson.length, llm_chars: json.length,
      compression_ratio: ratio(fullJson.length, json.length), compressed: false,
    };
  }

  const payload = isPlainObject(toolResult) && "result" in toolResult
    ? (toolResult as any).result
    : toolResult;

  const budget = budgetForTool(toolName);
  // Resultado já pequeno segue íntegro: comprimir sem necessidade só piora a
  // resposta e não economiza nada relevante.
  if (fullJson.length <= budget) {
    return {
      tool: toolName, ok: true, error: null, json: fullJson,
      full_chars: fullJson.length, llm_chars: fullJson.length,
      compression_ratio: 1, compressed: false,
    };
  }

  const selected = select(payload, 0);
  const { json } = serializeWithinBudget({ ok: true, tool: toolName, evidence: selected }, {
    maxChars: budget,
    maxArray: 8,
    maxDepth: 5,
  });
  return {
    tool: toolName, ok: true, error: null, json,
    full_chars: fullJson.length, llm_chars: json.length,
    compression_ratio: ratio(fullJson.length, json.length), compressed: true,
  };
}

function ratio(full: number, llm: number): number {
  if (full <= 0) return 1;
  return Math.round((llm / full) * 1000) / 1000;
}

function safeStringify(value: unknown): string {
  try { return JSON.stringify(value) ?? "null"; }
  catch { return JSON.stringify({ ok: false, error: "unserializable_tool_result" }); }
}
