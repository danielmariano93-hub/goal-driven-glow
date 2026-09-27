import { interpretSemanticTurnV3 } from "../supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts";
import { bridgeTurnSpecV3ToRuntime } from "../supabase/functions/_shared/agent/v3/V3RuntimeBridge.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const scenarios = [
  {
    id: "compound_social_financial",
    text: "Oi Nino, tudo bem? Antes de qualquer coisa, quanto eu gastei com lazer este mês?",
    history: "",
    context: { conversation_state: {} },
  },
  {
    id: "followup_previous_month",
    text: "E no mês passado?",
    history: "Usuário: Quanto eu gastei com lazer este mês?\nNino: Você gastou R$ X em Lazer neste mês.",
    context: { conversation_state: { current_topic: "gastos em Lazer", active_category: "Lazer", active_period: { from: "2026-09-01", to: "2026-09-26" } } },
  },
  {
    id: "explicit_category_switch",
    text: "Nino, e em lazer? Quanto eu gastei esse mês?",
    history: "Usuário: Quanto gastei em alimentação neste mês?\nNino: Você gastou R$ X em Alimentação.",
    context: { conversation_state: { current_topic: "gastos em Alimentação", active_category: "Alimentação", active_period: { from: "2026-09-01", to: "2026-09-26" } } },
  },
  {
    id: "implicit_merchant_distribution",
    text: "Em quais estabelecimentos?",
    history: "Usuário: Nino, quanto gastei em lazer este mês?\nNino: Você gastou R$ X em Lazer.",
    context: { conversation_state: { current_topic: "gastos em Lazer", active_category: "Lazer", active_period: { from: "2026-09-01", to: "2026-09-26" }, active_references: [{ target: "gasto em Lazer deste mês", entity_labels: ["Lazer"], source_tool: "analyze_spending" }] } },
  },
  {
    id: "typical_to_monthly_series",
    text: "Tá, mas me mostra mês a mês os últimos 5 meses.",
    history: "Usuário: Quanto gasto por mês com assinaturas normalmente?\nNino: Seu gasto típico com Assinaturas é de R$ X por mês.",
    context: { conversation_state: { current_topic: "gasto típico com Assinaturas", active_category: "Assinaturas" } },
  },
  {
    id: "merchant_category_order_words",
    text: "Agora olha no Thales com Alimentação nos últimos sete meses, mês por mês.",
    history: "",
    context: { conversation_state: {} },
  },
  {
    id: "chart_followup",
    text: "Mostra isso em gráfico.",
    history: "Usuário: Quanto gastei com Alimentação no Thales mês a mês nos últimos 7 meses?\nNino: Aqui está a série mensal solicitada.",
    context: { conversation_state: { current_topic: "série mensal de Alimentação no Thales", active_category: "Alimentação", active_merchant: "Thales", active_period: { from: "2026-03-01", to: "2026-09-26" }, active_references: [{ target: "resultado mensal anterior", entity_labels: ["Alimentação", "Thales"], source_tool: "spending_timeseries_monthly" }] } },
  },
  {
    id: "pronoun_reference",
    text: "E dela, quanto eu gastei no mês anterior?",
    history: "Usuário: Qual foi minha maior categoria de gasto neste mês?\nNino: A maior categoria foi Moradia.",
    context: { conversation_state: { current_topic: "maior categoria de gasto", active_category: "Moradia", active_references: [{ target: "Moradia", entity_labels: ["Moradia"], source_tool: "category_ranking" }] } },
  },
  {
    id: "explicit_interval_total",
    text: "Quanto eu gastei entre abril e setembro com lazer? Não quero média, quero o total do período.",
    history: "",
    context: { conversation_state: {} },
  },
  {
    id: "emotional_nonfinancial",
    text: "Estou me sentindo atento hoje.",
    history: "",
    context: { conversation_state: {} },
  },
  {
    id: "financial_write_complete",
    text: "Registre um gasto de R$ 50 no mercado hoje.",
    history: "",
    context: { conversation_state: {} },
  },
  {
    id: "human_summary_followup",
    text: "Resume o que descobrimos até aqui em 5 linhas, sem repetir números desnecessários.",
    history: "Usuário: Quanto gastei com Lazer este mês?\nNino: R$ X.\nUsuário: E no mês passado?\nNino: R$ Y.\nUsuário: Quanto gasto por mês com Assinaturas normalmente?\nNino: R$ Z.",
    context: { conversation_state: { current_topic: "resumo da conversa" } },
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
    turn: out.turn ? {
      kind: out.turn.kind,
      dialogue_act: out.turn.dialogue_act,
      tasks: out.turn.tasks,
      references: out.turn.references,
      clarification: out.turn.clarification,
      direct_reply: out.turn.direct_reply,
    } : null,
    bridge: bridge ? { ok: bridge.ok, errors: bridge.errors ?? [], contract: bridge.ok ? bridge.contract : null } : null,
  });
  await sleep(18000);
}

await Deno.writeTextFile("human-sim-results.json", JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
