import { interpretSemanticTurnV3 } from "../supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts";
import { bridgeTurnSpecV3ToRuntime } from "../supabase/functions/_shared/agent/v3/V3RuntimeBridge.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type Scenario = { id: string; text: string; history?: string; context?: unknown };

const debtHistory = "Usuário: Quais dívidas eu tenho?\nNino: Você tem uma dívida com Lucas, saldo de R$ 1.200, próxima parcela em 15/10.";
const debtContext = { conversation_state: { current_topic: "dívida com Lucas", active_references: [{ target: "dívida com Lucas", entity_labels: ["Lucas"], source_tool: "debt_status" }] } };

const scenarios: Scenario[] = [
  { id: "list_debts", text: "Nino, quais dívidas eu tenho hoje? Me mostra saldo, parcelas e vencimentos." },
  { id: "debt_detail_reference", text: "Quanto falta pagar dessa dívida e quando vence a próxima parcela?", history: debtHistory, context: debtContext },
  { id: "debt_payment_partial", text: "Registra um pagamento de R$ 300 na dívida do Lucas hoje.", history: debtHistory, context: debtContext },
  { id: "debt_payment_full", text: "Quita a dívida do Lucas hoje.", history: debtHistory, context: debtContext },
  { id: "debt_payment_pronoun", text: "Paga R$ 200 nessa hoje.", history: debtHistory, context: debtContext },
  { id: "debt_due_soon", text: "Quais dívidas estão vencidas ou vencem nos próximos 30 dias?" },
  { id: "list_goals", text: "Quais metas eu tenho e quanto falta para cada uma?" },
  { id: "recurring_expense", text: "Registra Netflix de R$ 39,90 todo dia 10 como assinatura recorrente." },
  { id: "installment_expense", text: "Comprei um notebook por R$ 3.600 em 12 vezes no cartão Itaú hoje, categoria Trabalho." },
  { id: "update_transaction", text: "Aquele Uber de R$ 89,90 não era Transporte, muda para Lazer.", history: "Usuário: Registra R$ 89,90 de Uber hoje em Transporte.\nNino: Lançamento registrado.", context: { conversation_state: { current_topic: "lançamento Uber R$ 89,90", active_merchant: "Uber", active_category: "Transporte" } } },
  { id: "undo_last", text: "Desfaz o último lançamento que eu fiz.", history: "Usuário: Registra R$ 45 de farmácia hoje.\nNino: Lançamento registrado.", context: { conversation_state: { current_topic: "lançamento de farmácia R$ 45" } } },
  { id: "compound_goal_create_contribute", text: "Cria uma meta Reserva de Emergência de R$ 20 mil e já coloca R$ 500 nela." },
  { id: "split_receivable_paid", text: "O Lucas já me pagou os R$ 120 do jantar, marca como recebido.", history: "Nino: No rolê Jantar, Lucas te deve R$ 120.", context: { conversation_state: { current_topic: "Divisão do Rolê Jantar", active_references: [{ target: "Lucas deve R$ 120", entity_labels: ["Lucas"], source_tool: "list_split_receivables" }] } } },
  { id: "duplicate_explicit", text: "Registra de novo o mesmo gasto de R$ 45 da farmácia de ontem.", history: "Usuário: Registra R$ 45 de farmácia ontem.\nNino: Lançamento registrado.", context: { conversation_state: { current_topic: "lançamento farmácia R$ 45" } } },
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
    telemetry: { model: out.telemetry.model, provider: out.telemetry.provider, error: out.telemetry.error ?? null, llm_calls: out.telemetry.llm_calls, latency_ms: out.telemetry.latency_ms },
    turn: out.turn ?? null,
    bridge: bridge ? { ok: bridge.ok, errors: bridge.errors ?? [], contract: bridge.ok ? bridge.contract : null } : null,
  });
  await sleep(8000);
}
await Deno.writeTextFile("adversarial-sim-results.json", JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
