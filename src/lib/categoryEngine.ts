import { supabase } from "@/integrations/supabase/client";
import { invokeEdge } from "@/lib/edge/invoke";

export type CategoryEngineDecision = {
  category_id: string | null;
  category_source: string;
  category_confidence: number;
  category_reason: string;
  action: "auto_apply" | "suggest_review" | "leave_unresolved" | "exclude" | "preserve";
  engine_version: string;
};

export async function classifyTransaction(input: {
  transaction_id?: string;
  type: "income" | "expense" | "transfer";
  description?: string | null;
  explicit_category?: string | null;
  movement_kind?: string | null;
}) {
  const data = await invokeEdge<{ decision: CategoryEngineDecision }>("category-engine", {
    operation: "classify",
    input,
  });
  return data.decision;
}

export async function processCategoryQueue() {
  return invokeEdge<{ decisions: CategoryEngineDecision[]; processed: number }>("category-engine", {
    operation: "process_queue",
  });
}

export async function learnCategory(transactionId: string, categoryId: string) {
  const { error } = await supabase.functions.invoke("category-engine", {
    body: { operation: "learn", transaction_id: transactionId, category_id: categoryId },
  });
  if (error) throw error;
}