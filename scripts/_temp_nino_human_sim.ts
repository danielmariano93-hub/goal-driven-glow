import { interpretSemanticTurnV3 } from "../supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts";
import { bridgeTurnSpecV3ToRuntime } from "../supabase/functions/_shared/agent/v3/V3RuntimeBridge.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Scenario = { id: string; text: string; history?: string; context?: unknown };
const scenarios: Scenario[] = [
  { id: "create_goal", text: "Nino, cria uma meta chamada Viagem Japão de R$ 25 mil para dezembro de 2027." },
  { id: "goal_contribute", text: "Coloca R$ 500 na meta Viagem Japão hoje." },
  { id: "create_split", text: "Dividi um jantar de R$ 480 com Ana, Lucas e Pedro. Divide igualmente entre os quatro e cria a divisão do rolê." },
  { id: "create_transaction", text: "Registra R$ 89,90 de Uber hoje no cartão Itaú e coloca em Transporte." },
  { id: "create_transfer", text: "Transfere R$ 300 da conta Nubank para a conta Itaú hoje." },
  { id: "create_debt", text: "Registra uma dívida de R$ 1.200 que eu tenho com o Lucas, vencendo em 15 de outubro." },
  { id: "pay_card_bill", text: "Registra o pagamento de R$ 2.350 da fatura do cartão Itaú hoje." },
  {
    id: "delete_transaction",
    text: "Apaga o lançamento de R$ 89,90 da Uber que eu acabei de registrar.",
    history: "Usuário: Registra R$ 89,90 de Uber hoje no cartão Itaú e coloca em Transporte.\nNino: Criei o lançamento de R$ 89,90 da Uber.",
    context: { conversation_state: { current_topic: "lançamento Uber R$ 89,90", active_merchant: "Uber" } },
  },
  {
    id: "edit_goal",
    text: "Muda a meta Viagem Japão para R$ 30 mil e prazo junho de 2028.",
    history: "Usuário: cria uma meta chamada Viagem Japão de R$ 25 mil para dezembro de 2027.\nNino: Meta criada.",
    context: { conversation_state: { current_topic: "meta Viagem Japão", active_goal: "Viagem Japão" } },
  },
  {
    id: "delete_goal",
    text: "Exclui a meta Viagem Japão.",
    history: "Nino: Sua meta Viagem Japão está ativa.",
    context: { conversation_state: { current_topic: "meta Viagem Japão", active_goal: "Viagem Japão" } },
  },
  { id: "create_category", text: "Cria uma categoria chamada Pets com o emoji de cachorro." },
  { id: "edit_category", text: "Renomeia a categoria Pets para Pet e troca o emoji para um coração." },
  { id: "delete_category", text: "Exclui a categoria Pet." },
  {
    id: "ambiguous_delete",
    text: "Apaga aquilo de ontem.",
    history: "Usuário: Registra R$ 45 de farmácia ontem.\nNino: Lançamento criado.\nUsuário: Cria uma meta Remédio de R$ 300.\nNino: Meta criada.",
    context: { conversation_state: { current_topic: "meta Remédio" } },
  },
];

const results: unknown[] = [];
for (const scenario of scenarios) {
  const out = await interpretSemanticTurnV3({
    text: scenario.text,
    history_text: scenario.history ?? "",
    context_text: JSON.stringify(scenario.context ?? { conversation_state: {} }),
    model: Deno.env.get("NINO_AI_MODEL") || "openai/gpt-oss-120b",
  });
  const bridge = out.turn ? bridgeTurnSpecV3ToRuntime(out.turn) : null;
  results.push({
    id: scenario.id,
    text: scenario.text,
    ok: Boolean(out.turn),
    violations: out.violations,
    telemetry: {
      model: out.telemetry.model,
      provider: out.telemetry.provider,
      error: out.telemetry.error ?? null,
      llm_calls: out.telemetry.llm_calls,
      latency_ms: out.telemetry.latency_ms,
    },
    turn: out.turn ?? null,
    bridge: bridge ? { ok: bridge.ok, errors: bridge.errors ?? [], contract: bridge.ok ? bridge.contract : null } : null,
  });
  await sleep(9000);
}
await Deno.writeTextFile("human-sim-results.json", JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
