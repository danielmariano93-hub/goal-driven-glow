import type { ChannelEnvelope, ConfidenceLevel, EvidencePackage } from "./contracts.ts";

export function buildChannelEnvelope(args: {
  text: string;
  reply_kind: string;
  evidence?: EvidencePackage | null;
  artifact_id?: string | null;
  artifact_status?: "none" | "generated" | "ready" | "delivered" | "failed";
  actions?: ChannelEnvelope["actions"];
}): ChannelEnvelope {
  const evidence = args.evidence ?? null;
  const confidence: ConfidenceLevel | null = evidence?.confidence ?? null;
  const artifact = args.artifact_id
    ? { id: args.artifact_id, type: "chart" as const, status: args.artifact_status ?? "generated" }
    : null;
  return {
    text: args.text,
    reply_kind: args.reply_kind,
    confidence,
    evidence,
    artifact,
    actions: args.actions ?? [],
  };
}
