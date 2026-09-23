// Narrow deterministic human-domain gate for AgentCoreV2.
//
// Conversation Brain remains the authority for normal language turns. This gate
// only restores explicit, already-canonical human events that have a dedicated
// deterministic tool and are not represented by Financial ActionIR. Keeping
// the allowlist here prevents the legacy router from becoming a competing
// authority inside the V2 hot path.
import { interpret } from "../parser.ts";
import { classifyCapability, type CapabilityDecision } from "./CapabilityRouter.ts";

const V2_HUMAN_EVENT_ALLOWLIST = new Set([
  "emotional_checkin:log_emotional_checkin",
]);

export function resolveV2DeterministicHumanCapability(text: string): CapabilityDecision | null {
  const capability = classifyCapability(text, interpret(text), null);
  const key = `${capability.name}:${capability.required_tool ?? ""}`;

  if (capability.execution !== "deterministic") return null;
  if (!V2_HUMAN_EVENT_ALLOWLIST.has(key)) return null;
  return capability;
}
