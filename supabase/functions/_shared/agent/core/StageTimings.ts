// Tempo por etapa do turno (agent_runs.llm_ms / stage_ms). Puro, para teste.
/** Divide o tempo total do turno entre IA e o resto (ferramentas, memória, gravação). Puro, para teste. */
export function stageTimings(totalMs: number, llmMs?: number): { llm_ms: number | null; stage_ms: Record<string, number> } {
  const total = Math.max(0, Math.round(Number(totalMs) || 0));
  const llm = Math.min(total, Math.max(0, Math.round(Number(llmMs) || 0)));
  return { llm_ms: llm > 0 ? llm : null, stage_ms: { total, llm, other: total - llm } };
}
