// anticipation_contract.v1 — política de oportunidade vencida (stale).
// Antecipação atrasada nunca é enviada como se ainda fosse antecipação.

import type { StalePolicy } from "./contracts.ts";

export type StaleDecision =
  | { action: "send"; channel: "app" | "whatsapp" | "both" }
  | { action: "convert_to_in_app" }
  | { action: "summary_later"; summaryAt: string }
  | { action: "recompute" }
  | { action: "expire"; reason: string };

export function decideStale(args: {
  now: Date;
  windowEnd: Date;
  policy: StalePolicy;
  channelTarget: "app" | "whatsapp" | "both";
  stillValid: boolean;
}): StaleDecision {
  const expired = args.now.getTime() > args.windowEnd.getTime();
  if (!expired) {
    if (!args.stillValid) return { action: "expire", reason: "pattern_no_longer_valid" };
    if (args.policy === "recompute_before_send") return { action: "recompute" };
    return { action: "send", channel: args.channelTarget };
  }
  switch (args.policy) {
    case "convert_to_in_app":
      return { action: "convert_to_in_app" };
    case "send_summary_later":
      return {
        action: "summary_later",
        summaryAt: new Date(args.windowEnd.getTime() + 24 * 3_600_000).toISOString(),
      };
    case "recompute_before_send":
    case "drop_after_window":
    default:
      return { action: "expire", reason: "window_closed" };
  }
}
