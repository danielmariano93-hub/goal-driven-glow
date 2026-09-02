// RuntimeContract — versão única do runtime do agente e do contrato analítico.
//
// Causa-raiz que este módulo fecha: um run de produção registrou um gate
// (um gate antigo de consistência da meta) que já não existia no código-fonte. Não havia como
// distinguir "código novo com bug" de "código antigo ainda rodando na Edge
// Function". Agora toda run carrega a versão do runtime que a produziu, gravada
// no JSONB `agent_runs.context_layers.analytical_path` (sem coluna nova).
//
// Regra operacional: ao alterar qualquer arquivo de `_shared/agent`, suba
// `AGENT_RUNTIME_VERSION`. Ao alterar o contrato analítico (planner, gates,
// escopo, períodos, motor de metas), suba também `ANALYTICAL_CONTRACT_VERSION`.

export const AGENT_RUNTIME_VERSION = "nino-agent-p0.2026-09-02.5";

export const ANALYTICAL_CONTRACT_VERSION = "nino_analytical.v2";

export type RuntimeStamp = {
  runtime_version: string;
  analytical_contract_version: string;
};

export function runtimeStamp(): RuntimeStamp {
  return {
    runtime_version: AGENT_RUNTIME_VERSION,
    analytical_contract_version: ANALYTICAL_CONTRACT_VERSION,
  };
}

/** Contexto mínimo gravado desde a abertura do run, antes de qualquer atalho. */
export function runtimeContext(finalPath = "routing") {
  return {
    analytical_path: {
      ...runtimeStamp(),
      composite_plan_matched: false,
      goal_performance_tool_started: false,
      goal_performance_tool_failed: false,
      fallback_reason: null,
      final_path: finalPath,
    },
  };
}
