import { interpretSemanticTurnV3 } from "../supabase/functions/_shared/agent/v3/SemanticInterpreterV3.ts";
import { bridgeTurnSpecV3ToRuntime } from "../supabase/functions/_shared/agent/v3/V3RuntimeBridge.ts";

const model = Deno.env.get("NINO_AI_MODEL") ?? "openai/gpt-oss-120b";
const outcome = await interpretSemanticTurnV3({
  text: "Quais dívidas eu tenho? Mostra saldo, parcelas e vencimentos.",
  history_text: "",
  context_text: "",
  model,
});
let bridge: unknown = null;
if (outcome.turn?.kind === "task") bridge = bridgeTurnSpecV3ToRuntime(outcome.turn);
console.log(JSON.stringify({ scenario: "T1.1_dividas_saldo_parcelas_vencimentos", turn: outcome.turn, telemetry: outcome.telemetry, bridge }));
if (!outcome.turn || !outcome.telemetry.ok) Deno.exit(1);
