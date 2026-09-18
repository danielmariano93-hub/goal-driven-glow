// V2EvidencePersistence (`nino_evidence_persistence.v1`)
//
// Conversation Brain V2 used to record only agent_runs.tools_used. That lost the
// actual args/result needed to prove a financial follow-up later. This helper
// persists the same canonical tool evidence shape used by the legacy core.
// deno-lint-ignore-file no-explicit-any

export type V2ToolCall = {
  tool_name: string;
  args?: any;
  result?: any;
  ok: boolean;
  duration_ms?: number | null;
  error?: string | null;
};

export async function persistV2ToolCalls(
  sb: any,
  runId: string | null | undefined,
  calls: V2ToolCall[] | null | undefined,
): Promise<string[]> {
  if (!runId || !(calls?.length)) return [];
  try {
    const payload = calls.map((call, index) => ({
      run_id: runId,
      step_index: index,
      tool_name: String(call.tool_name ?? "v2_tool"),
      args: call.args ?? {},
      result: call.result ?? null,
      ok: call.ok === true,
      duration_ms: Number.isFinite(Number(call.duration_ms)) ? Number(call.duration_ms) : null,
      error: call.error ? String(call.error).slice(0, 500) : null,
    }));
    const { data, error } = await sb.from("agent_tool_calls").insert(payload).select("id,step_index");
    if (error) {
      console.error("[V2EvidencePersistence] tool call insert failed", String(error.message ?? error).slice(0, 200));
      return [];
    }
    return ((data ?? []) as any[])
      .sort((a, b) => Number(a.step_index ?? 0) - Number(b.step_index ?? 0))
      .map((row) => String(row.id ?? ""))
      .filter(Boolean);
  } catch (error) {
    console.error("[V2EvidencePersistence] tool call insert exception", String((error as Error)?.message ?? error).slice(0, 200));
    return [];
  }
}

export function directReplyLooksLikeFinancialFact(text: string): boolean {
  const value = String(text ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, " ");
  const hardNumber = /r\$\s*\d|\b\d+[.,]\d{1,2}\s*%/.test(value);
  const financialClaim = /\b(?:saldo|fatura|patrimonio|gasto|gastei|despesa|receita|divida|categoria|acima da media|abaixo da media|media mensal|valor total)\b/.test(value);
  return hardNumber || financialClaim;
}
