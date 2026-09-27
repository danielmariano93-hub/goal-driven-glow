import { interpretSemanticTurnV3 } from "../supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts";
import { bridgeTurnSpecV3ToRuntime } from "../supabase/functions/_shared/agent/v3/V3RuntimeBridge.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const baseHistory = "Usuário: Quanto eu gastei com lazer este mês?\nNino: Você gastou R$ X em Lazer neste mês.";
const baseContext = { conversation_state: { current_topic: "gastos em Lazer", active_category: "Lazer", active_period: { from: "2026-09-01", to: "2026-09-26" }, active_references: [{ target: "gasto em Lazer deste mês", entity_labels: ["Lazer"], source_tool: "analyze_spending" }] } };
const scenarios = [
  { id: "followup_previous_month_a", text: "E no mês passado?", history: baseHistory, context: baseContext },
  { id: "followup_previous_month_b", text: "E no mês anterior?", history: baseHistory, context: baseContext },
  {
    id: "chart_followup_isolated",
    text: "Mostra isso em gráfico.",
    history: "Usuário: Quanto gastei com Alimentação no Thales mês a mês nos últimos 7 meses?\nNino: Aqui está a série mensal solicitada.",
    context: { conversation_state: { current_topic: "série mensal de Alimentação no Thales", active_category: "Alimentação", active_merchant: "Thales", active_period: { from: "2026-03-01", to: "2026-09-26" }, active_references: [{ target: "resultado mensal anterior", entity_labels: ["Alimentação", "Thales"], source_tool: "spending_timeseries_monthly" }] } },
  },
];

const results: unknown[] = [];
for (const scenario of scenarios) {
  const out = await interpretSemanticTurnV3({
    text: scenario.text,
    history_text: scenario.history,
    context_text: JSON.stringify(scenario.context),
    model: Deno.env.get("NINO_AI_MODEL") || "openai/gpt-oss-120b",
  });
  const bridge = out.turn ? bridgeTurnSpecV3ToRuntime(out.turn) : null;
  results.push({
    id: scenario.id,
    text: scenario.text,
    ok: Boolean(out.turn),
    violations: out.violations,
    telemetry: { model: out.telemetry.model, provider: out.telemetry.provider, error: out.telemetry.error ?? null, llm_calls: out.telemetry.llm_calls },
    turn: out.turn ?? null,
    bridge: bridge ? { ok: bridge.ok, errors: bridge.errors ?? [], contract: bridge.ok ? bridge.contract : null } : null,
  });
  await sleep(25000);
}
await Deno.writeTextFile("human-sim-results.json", JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
