// MemoryWriter (`nino_memory_writer.v1`)
//
// Single write boundary for durable relationship memory. It never stores live
// financial truth; MemoryStore recursively strips volatile money/state before
// persistence. Callers express the relationship fact, not raw conversation.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  remember,
  stripVolatileFinancialState,
  type MemoryFact,
  type MemoryRecord,
} from "./MemoryStore.ts";

export type MemoryWriteResult = {
  version: "nino_memory_writer.v1";
  fact: MemoryFact | null;
  dropped_financial_fields: string[];
};

export async function writeDurableMemory(
  sb: SupabaseClient,
  record: MemoryRecord,
): Promise<MemoryWriteResult> {
  const sanitized = stripVolatileFinancialState(record.value ?? {});
  const fact = await remember(sb, { ...record, value: sanitized.value });
  return {
    version: "nino_memory_writer.v1",
    fact,
    dropped_financial_fields: sanitized.dropped,
  };
}
