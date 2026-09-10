// TurnEvidenceCache (`nino_turn_cache.v1`)
//
// UMA TOOL EXECUTADA UMA VEZ POR TURNO.
//
// Causa-raiz: o mesmo turno podia executar a mesma ferramenta canônica mais de
// uma vez — compilador semântico executa, um gate falha, o resgate/fallback
// legado executa de novo a MESMA capability com os MESMOS parâmetros. Resultado:
// latência dobrada, tokens dobrados e risco de reexecutar operação de escrita.
//
// Regras:
// - READ: resultado bem-sucedido é memorizado por (tool + args normalizados).
// - WRITE: NUNCA é reexecutada no mesmo turno. Se já teve sucesso, o resultado é
//   reutilizado; se falhou, o erro é reutilizado (nunca "tentar de novo para
//   confirmar a verdade").
// deno-lint-ignore-file no-explicit-any

export type CachedExecution = {
  tool_name: string;
  args: unknown;
  ok: boolean;
  result: unknown;
  error: string | null;
  duration_ms: number;
  retries: number;
  /** true quando o valor veio do cache do turno (não houve nova execução). */
  reused?: boolean;
};

/** Ferramentas que alteram estado. Nunca repetíveis dentro do mesmo turno. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  "confirm_pending_action",
  "cancel_pending_action",
  "log_emotional_checkin",
  "commit_latest_change_action",
  "pause_change_commitment",
  "generate_chart_artifact",
  "generate_report_from_template",
]);

export function isWriteTool(tool: string): boolean {
  return WRITE_TOOLS.has(tool) || /_draft$/.test(tool)
    || /^(create|update|delete|register|add|pay|settle|edit)_/.test(tool);
}

function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as any).sort();
  return "{" + keys
    .filter((k) => (v as any)[k] !== undefined)
    .map((k) => JSON.stringify(k) + ":" + stableStringify((v as any)[k]))
    .join(",") + "}";
}

export function evidenceKey(tool: string, args: unknown): string {
  return `${tool}:${stableStringify(args ?? {})}`;
}

export type TurnEvidenceCache = {
  /** Executa a ferramenta uma única vez por chave; reutiliza nas próximas. */
  run(tool: string, args: unknown, exec: () => Promise<CachedExecution>): Promise<CachedExecution>;
  /** Registra manualmente uma execução já feita fora do cache. */
  remember(tool: string, args: unknown, execution: CachedExecution): void;
  /** true quando essa ferramenta de escrita já rodou neste turno (qualquer args). */
  hasWrite(tool: string): boolean;
  stats(): { executions: number; reuses: number; write_reuses: number; keys: string[] };
};

export function createTurnEvidenceCache(): TurnEvidenceCache {
  const store = new Map<string, CachedExecution>();
  // `nino_language.v1`: escrita é bloqueada por NOME, não por argumentos. O
  // resgate do Truth Gate chamava a mesma capability com args levemente
  // diferentes e gravava duas vezes (check-in emocional duplicado).
  const writes = new Map<string, CachedExecution>();
  const inflight = new Map<string, Promise<CachedExecution>>();
  let executions = 0;
  let reuses = 0;
  let writeReuses = 0;

  const reuse = (tool: string, hit: CachedExecution): CachedExecution => {
    reuses++;
    if (isWriteTool(tool)) writeReuses++;
    return { ...hit, duration_ms: 0, reused: true };
  };

  return {
    async run(tool, args, exec) {
      const key = evidenceKey(tool, args);
      const hit = store.get(key);
      // WRITE: reutiliza qualquer resultado (sucesso OU falha).
      // READ: só reutiliza sucesso — falha transitória pode ser tentada de novo.
      if (hit && (isWriteTool(tool) || hit.ok)) return reuse(tool, hit);
      if (isWriteTool(tool)) {
        const previousWrite = writes.get(tool);
        if (previousWrite) return reuse(tool, previousWrite);
      }

      const running = inflight.get(key);
      if (running) {
        const settled = await running;
        return reuse(tool, settled);
      }

      const promise = (async () => {
        const out = await exec();
        store.set(key, out);
        if (isWriteTool(tool) && !writes.has(tool)) writes.set(tool, out);
        executions++;
        return out;
      })();
      inflight.set(key, promise);
      try {
        return await promise;
      } finally {
        inflight.delete(key);
      }
    },
    remember(tool, args, execution) {
      store.set(evidenceKey(tool, args), execution);
      if (isWriteTool(tool) && !writes.has(tool)) writes.set(tool, execution);
    },
    hasWrite(tool) {
      return isWriteTool(tool) && writes.has(tool);
    },
    stats() {
      return {
        executions,
        reuses,
        write_reuses: writeReuses,
        keys: [...store.keys()].map((k) => k.split(":")[0]),
      };
    },
  };
}
