// Real-provider smoke for the Nino V3 semantic interpreter.
// Runs in deploy CI with the production Groq model but no user/database data.

import { interpretSemanticTurnV3 } from "../supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts";

const model = Deno.env.get("NINO_AI_MODEL") || "openai/gpt-oss-120b";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function lazerOverride() {
  const outcome = await interpretSemanticTurnV3({
    text: "E em Lazer? Quanto eu gastei esse mês?",
    history_text: [
      "Usuário: Quanto eu gastei em Alimentação?",
      "Nino: Alimentação ficou abaixo da referência.",
    ].join("\n"),
    context_text: JSON.stringify({
      conversation_state: {
        current_topic: "categoria:Alimentação",
        active_category: "Alimentação",
        active_period: { from: "2026-09-01", to: "2026-09-25", label: "este mês" },
      },
    }),
    model,
  });
  assert(outcome.turn?.kind === "task", `Lazer smoke not task: ${outcome.telemetry.error}`);
  const task = outcome.turn.tasks.find((item) => item.kind === "financial_query");
  assert(task?.kind === "financial_query", "Lazer smoke missing financial_query");
  const category = task.filters.find((filter) => filter.field === "category")?.entity;
  assert(category?.value.toLowerCase() === "lazer", `Expected Lazer, got ${category?.value ?? "null"}`);
  assert(category?.source === "current_turn", `Expected current_turn category source, got ${category?.source ?? "null"}`);
  assert(task.periods.some((period) => /m[eê]s/i.test(period.value) && period.source === "current_turn"), "Current-month period not preserved as current_turn");
  assert(outcome.turn.references.length === 0, "Explicit Lazer must not also emit inherited entity/result reference");
}

async function goalsOverview() {
  const outcome = await interpretSemanticTurnV3({
    text: "Quais metas eu tenho?",
    history_text: "",
    context_text: JSON.stringify({ conversation_state: null }),
    model,
  });
  assert(outcome.turn?.kind === "task", `Goals smoke not task: ${outcome.telemetry.error}`);
  const task = outcome.turn.tasks.find((item) => item.kind === "goal_query");
  assert(task?.kind === "goal_query", "Goals smoke missing goal_query");
  assert(task.operation === "overview", `Expected goals overview, got ${task.operation}`);
  assert(task.goal === null, "Goals overview must not invent a single goal");
}

await lazerOverride();
await goalsOverview();
console.log(`Nino V3 semantic provider smoke passed with ${model}.`);
