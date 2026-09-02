// SemanticQueryExecutor (`nino_semantic_ir.v3`)
//
// AUTORIDADE DE EXECUÇÃO do caminho semântico. Com `semantic_status=executable`,
// é este módulo — e não o ActionPlanner/LLM — que chama os motores canônicos.
// A LLM não vê catálogo de tools para executar um IR já validado.
// WRITE nunca passa por aqui.
import { topologicalQueryOrder, type FinancialQueryIRv2 } from "./FinancialQueryIR.ts";
import type { PlanValidation } from "./FinancialPlanValidator.ts";

export type SemanticEngineRunner = (
  tool: string,
  args: Record<string, unknown>,
  query_id: string,
) => Promise<{ ok: boolean; result?: unknown; error?: string | null; duration_ms?: number }>;

export type SemanticQueryOutcome = {
  query_id: string;
  status: "ok" | "failed" | "unsupported";
  engine: string | null;
  args: Record<string, unknown>;
  result: unknown;
  error: string | null;
  duration_ms: number;
};

export type SemanticExecutionResult = {
  version: "nino_semantic_ir.v3";
  complete: boolean;
  outcomes: SemanticQueryOutcome[];
  failed_queries: string[];
  unsupported_queries: string[];
  engines: string[];
  duration_ms: number;
};

const CONCURRENCY = 3;

export async function executeSemanticPlan(args: {
  ir: FinancialQueryIRv2;
  validation: PlanValidation;
  runner: SemanticEngineRunner;
}): Promise<SemanticExecutionResult> {
  const started = Date.now();
  const byQuery = new Map(args.validation.mapped.map((m) => [m.query_id, m]));
  const waves = topologicalQueryOrder(args.ir.queries);
  const outcomes: SemanticQueryOutcome[] = [];

  if (!waves) {
    return {
      version: "nino_semantic_ir.v3",
      complete: false,
      outcomes: [],
      failed_queries: args.ir.queries.map((q) => q.id),
      unsupported_queries: [],
      engines: [],
      duration_ms: 0,
    };
  }

  for (const wave of waves) {
    // Paralelismo só entre leituras independentes (mesma onda topológica).
    for (let i = 0; i < wave.length; i += CONCURRENCY) {
      const slice = wave.slice(i, i + CONCURRENCY);
      const executed = await Promise.all(slice.map(async (q): Promise<SemanticQueryOutcome> => {
        const mapping = byQuery.get(q.id);
        if (!mapping) {
          return {
            query_id: q.id, status: "unsupported", engine: null, args: {},
            result: null, error: "no_engine_mapping", duration_ms: 0,
          };
        }
        const at = Date.now();
        try {
          const run = await args.runner(mapping.tool, mapping.args, q.id);
          return {
            query_id: q.id,
            status: run.ok ? "ok" : "failed",
            engine: mapping.tool,
            args: mapping.args,
            result: run.ok ? (run.result ?? null) : null,
            error: run.ok ? null : String(run.error ?? "engine_error").slice(0, 200),
            duration_ms: run.duration_ms ?? Date.now() - at,
          };
        } catch (error) {
          return {
            query_id: q.id, status: "failed", engine: mapping.tool, args: mapping.args,
            result: null, error: String((error as Error)?.message ?? "engine_error").slice(0, 200),
            duration_ms: Date.now() - at,
          };
        }
      }));
      outcomes.push(...executed);
    }
  }

  const failed = outcomes.filter((o) => o.status === "failed").map((o) => o.query_id);
  const unsupported = outcomes.filter((o) => o.status === "unsupported").map((o) => o.query_id);
  return {
    version: "nino_semantic_ir.v3",
    complete: failed.length === 0 && unsupported.length === 0 && outcomes.length === args.ir.queries.length,
    outcomes,
    failed_queries: failed,
    unsupported_queries: unsupported,
    engines: [...new Set(outcomes.map((o) => o.engine).filter(Boolean) as string[])],
    duration_ms: Date.now() - started,
  };
}
