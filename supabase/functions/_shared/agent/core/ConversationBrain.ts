// ConversationBrain — tipos do contrato de interpretação de um turno.
//
// O significado de linguagem natural é do Runtime V3 (`ConversationAuthority`
// → `SemanticAuthorityV3`). O antigo "Conversation Brain" (prompt próprio e
// chamada de IA paralela) foi removido: ele só rodava fora do rollout V3 ou por
// falha de leitura de flag, e nessa falha ressuscitava comportamento antigo.
// Este módulo permanece apenas com os tipos compartilhados.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { AiProviderConfig, AiProviderName } from "../../ai-runtime.ts";
import type { ConversationMemory } from "./ConversationMemory.ts";
import type { WriteWorkflow } from "./WriteWorkflowManager.ts";
import type { CanonicalConversationTurnContract } from "./ConversationTurnContract.ts";

export { dialogueActsFromContract } from "./ConversationTurnContract.ts";
export type { ConversationTurnContract } from "./ConversationTurnContract.ts";

export const CONVERSATION_BRAIN_DEADLINE_MS = 12_000;

export type ConversationBrainTelemetry = {
  model: string;
  provider: AiProviderName | null;
  llm_calls: number;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  ok: boolean;
  error: string | null;
};

export type ConversationBrainOutcome = {
  contract: CanonicalConversationTurnContract | null;
  telemetry: ConversationBrainTelemetry;
  /**
   * Remaining steps of a compound turn, already bridged from the same single
   * semantic interpretation. Executed in order after `contract`.
   */
  additional_contracts?: CanonicalConversationTurnContract[];
};

type HistoryTurn = { role: "user" | "assistant"; content: string; created_at?: string };

export type ConversationBrainInput = {
  text: string;
  history: HistoryTurn[];
  memory: ConversationMemory | null;
  workflow: WriteWorkflow | null;
  user_context?: string | null;
  model: string;
  sb?: SupabaseClient;
  user_id?: string | null;
  run_id?: string | null;
  conversation_id?: string | null;
  /** Used only by controlled evaluation paths; product routing picks the provider centrally. */
  provider_override?: AiProviderConfig | null;
};
