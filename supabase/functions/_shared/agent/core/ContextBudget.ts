// ContextBudget (`context_budget.v1`) — compactação determinística do contexto
// que entra no prompt. NÃO calcula nada e NÃO reescreve números: apenas remove
// campos vazios/nulos, arredonda dinheiro para centavos, limita o tamanho de
// listas e corta o JSON por orçamento de caracteres.
//
// Antes: `JSON.stringify(context).slice(0, 14_000)` — o corte cego podia matar
// o campo mais importante e o prompt chegava a 20–27k tokens por turno.
// deno-lint-ignore-file no-explicit-any

export type Budget = {
  /** Orçamento máximo de caracteres do JSON serializado. */
  maxChars: number;
  /** Máximo de itens por lista. */
  maxArray: number;
  /** Profundidade máxima antes de resumir o nó. */
  maxDepth: number;
};

export const DEFAULT_BUDGET: Budget = { maxChars: 4_000, maxArray: 6, maxDepth: 4 };

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function prune(value: unknown, depth: number, budget: Budget): unknown {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  }
  if (typeof value === "string") {
    return value.length > 240 ? value.slice(0, 240) + "…" : value;
  }
  if (Array.isArray(value)) {
    if (depth >= budget.maxDepth) return `[${value.length} itens]`;
    const kept = value.slice(0, budget.maxArray)
      .map((item) => prune(item, depth + 1, budget))
      .filter((item) => !isEmpty(item));
    if (value.length > budget.maxArray) kept.push(`+${value.length - budget.maxArray} itens omitidos`);
    return kept;
  }
  if (value && typeof value === "object") {
    if (depth >= budget.maxDepth) return "{…}";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const pruned = prune(v, depth + 1, budget);
      if (!isEmpty(pruned)) out[k] = pruned;
    }
    return out;
  }
  return value ?? null;
}

/** Chaves mantidas por último quando o orçamento aperta (ordem de prioridade). */
const PRIORITY_KEYS = [
  "snapshot", "net_worth", "available_today", "period", "totals", "today",
  "cards", "goals", "commitments", "categories", "merchants", "history",
];

/** Remove campos de MENOR prioridade do nó raiz até caber — nunca corta o JSON. */
function dropLowPriority(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length <= 1) return value;
  const rank = (k: string) => {
    const i = PRIORITY_KEYS.indexOf(k);
    return i === -1 ? PRIORITY_KEYS.length : i;
  };
  const ordered = [...entries].sort((a, b) => rank(a[0]) - rank(b[0]));
  ordered.pop();
  return Object.fromEntries(ordered);
}

/**
 * Serializa o contexto dentro do orçamento. Se ainda estourar, reduz listas e
 * profundidade progressivamente e, no limite, remove campos inteiros de menor
 * prioridade — o JSON entregue é SEMPRE válido, nunca cortado no meio de uma
 * chave.
 */
export function serializeWithinBudget(
  context: unknown,
  budget: Budget = DEFAULT_BUDGET,
): { json: string; truncated: boolean; chars: number } {
  let current: Budget = { ...budget };
  for (let attempt = 0; attempt < 4; attempt++) {
    const json = JSON.stringify(prune(context, 0, current));
    if (json.length <= budget.maxChars) {
      return { json, truncated: attempt > 0, chars: json.length };
    }
    current = {
      maxChars: current.maxChars,
      maxArray: Math.max(1, Math.floor(current.maxArray / 2)),
      maxDepth: Math.max(2, current.maxDepth - 1),
    };
  }
  // Último recurso: derruba campos inteiros (do menos para o mais importante).
  let reduced: unknown = context;
  for (let attempt = 0; attempt < 32; attempt++) {
    const json = JSON.stringify(prune(reduced, 0, current));
    if (json.length <= budget.maxChars) return { json, truncated: true, chars: json.length };
    const next = dropLowPriority(reduced);
    if (next === reduced) {
      const fallback = JSON.stringify({ context_omitido: "excedeu o orçamento de contexto" });
      return { json: fallback, truncated: true, chars: fallback.length };
    }
    reduced = next;
  }
  const fallback = JSON.stringify({ context_omitido: "excedeu o orçamento de contexto" });
  return { json: fallback, truncated: true, chars: fallback.length };
}

/** Estimativa grosseira de tokens (~4 chars/token em pt-BR). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Decomposição de tokens por bloco do prompt (`context_budget.v1`).
 * Usada pela observabilidade para responder "onde foram os tokens do turno".
 */
export function tokenBreakdown(blocks: Record<string, string | null | undefined>): Record<string, number> {
  const out: Record<string, number> = {};
  let total = 0;
  for (const [key, text] of Object.entries(blocks)) {
    const tokens = text ? estimateTokens(text) : 0;
    out[key] = tokens;
    total += tokens;
  }
  out.total = total;
  return out;
}

// ---------------------------------------------------------------------------
// Context Budget V2 (`context_budget.v2`) — contrato formal POR CAMADA.
//
// O orçamento deixa de ser "um número para o JSON financeiro" e passa a ser um
// contrato por camada do prompt. A camada `user_turn` NUNCA é cortada; as outras
// têm teto próprio em caracteres, medido e reportado na telemetria do turno.
// ---------------------------------------------------------------------------

export type ContextLayer =
  | "system_policy"       // A. system/policy
  | "user_turn"           // B. mensagem atual (integral, nunca cortada)
  | "working_memory"      // C. últimos turnos relevantes
  | "semantic_memory"     // D. preferências/fatos estáveis
  | "episodic_memory"     // E. acontecimentos relevantes da relação
  | "financial_evidence"  // F. contexto financeiro canônico
  | "tool_schemas"        // G. schemas das ferramentas
  | "evidence_pack";      // H. Evidence Packs das tools

/** Teto de caracteres por camada. ~4 chars/token → alvo total ≈ 4–5k tokens. */
export const LAYER_BUDGET_CHARS: Readonly<Record<ContextLayer, number>> = {
  system_policy: 6_000,
  user_turn: Number.POSITIVE_INFINITY,
  working_memory: 3_000,
  semantic_memory: 900,
  episodic_memory: 700,
  financial_evidence: 4_000,
  tool_schemas: 3_000,
  evidence_pack: 2_400,
};

/** Turnos de working memory mantidos por padrão (2–4 interações recentes). */
export const WORKING_MEMORY_TURNS = 4;

export type LayerMeasure = { chars: number; tokens: number; over_budget: boolean };

/** Mede uma camada contra o seu orçamento (não altera o conteúdo). */
export function measureLayer(layer: ContextLayer, text: string | null | undefined): LayerMeasure {
  const chars = text ? text.length : 0;
  const budget = LAYER_BUDGET_CHARS[layer];
  return { chars, tokens: estimateTokens(text ?? ""), over_budget: chars > budget };
}

/**
 * Telemetria por camada do turno: `{ layers: {...}, total_tokens, over_budget[] }`.
 * A camada `user_turn` entra na conta mas nunca é marcada como excedida.
 */
export function measureLayers(
  blocks: Partial<Record<ContextLayer, string | null | undefined>>,
): { layers: Record<string, LayerMeasure>; total_chars: number; total_tokens: number; over_budget: string[] } {
  const layers: Record<string, LayerMeasure> = {};
  const over: string[] = [];
  let total_chars = 0;
  let total_tokens = 0;
  for (const [key, text] of Object.entries(blocks)) {
    const layer = key as ContextLayer;
    const measure = measureLayer(layer, text);
    layers[layer] = measure;
    total_chars += measure.chars;
    total_tokens += measure.tokens;
    if (measure.over_budget && layer !== "user_turn") over.push(layer);
  }
  return { layers, total_chars, total_tokens, over_budget: over };
}

/**
 * Aplica o orçamento de uma camada de TEXTO (não-JSON): corta por parágrafo,
 * nunca no meio de uma palavra, e sinaliza o corte.
 */
export function fitLayer(layer: ContextLayer, text: string): string {
  const budget = LAYER_BUDGET_CHARS[layer];
  if (!Number.isFinite(budget) || text.length <= budget) return text;
  const parts = text.split(/\n{2,}/);
  const kept: string[] = [];
  let used = 0;
  for (const part of parts) {
    if (used + part.length > budget) break;
    kept.push(part);
    used += part.length + 2;
  }
  if (kept.length === 0) {
    const hard = text.slice(0, Math.max(0, budget - 1));
    return hard.slice(0, hard.lastIndexOf(" ") > 0 ? hard.lastIndexOf(" ") : hard.length);
  }
  return kept.join("\n\n");
}

/**
 * Working memory: mantém apenas os últimos turnos relevantes dentro do
 * orçamento da camada. Histórico completo nunca vai ao prompt.
 */
export function fitWorkingMemory<T extends { role?: string; content?: unknown }>(
  history: readonly T[],
  opts: { turns?: number; maxChars?: number } = {},
): T[] {
  const turns = Math.max(1, opts.turns ?? WORKING_MEMORY_TURNS);
  const maxChars = opts.maxChars ?? LAYER_BUDGET_CHARS.working_memory;
  const recent = history.slice(-turns * 2);
  const kept: T[] = [];
  let used = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const size = String(recent[i]?.content ?? "").length;
    if (kept.length > 0 && used + size > maxChars) break;
    kept.unshift(recent[i]);
    used += size;
  }
  return kept;
}


