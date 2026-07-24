import { supabase } from "@/integrations/supabase/client";

export type SplitDispatchResult = {
  claimed: number;
  enqueued: number;
  skipped: number;
  failed: number;
  outbound_processed: number;
  outbound_kicked: boolean;
  outbound_sent?: number;
  outbound_pending?: number;
  outbound_failed?: number;
};

export type BoundedDispatchResult =
  | { status: "completed"; data: SplitDispatchResult }
  | { status: "timeout" }
  | { status: "error"; message: string };

/**
 * O backend continua processando mesmo que a resposta demore. A UI espera no
 * máximo alguns segundos e passa a acompanhar a fila, sem transformar demora
 * de rede em falsa falha de criação da divisão.
 */
export async function dispatchSplitReminders(
  timeoutMs = 12_000,
): Promise<BoundedDispatchResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<BoundedDispatchResult>((resolve) => {
    timer = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
  });
  const invoke = supabase.functions
    .invoke<SplitDispatchResult>("split-reminders-dispatch", {
      body: { owner_only: true },
    })
    .then(({ data, error }): BoundedDispatchResult => {
      if (error || !data) {
        return { status: "error", message: error?.message ?? "empty_dispatch" };
      }
      return { status: "completed", data };
    })
    .catch((error): BoundedDispatchResult => ({
      status: "error",
      message: error instanceof Error ? error.message : "dispatch_failed",
    }));

  const result = await Promise.race([invoke, timeout]);
  if (timer) clearTimeout(timer);
  return result;
}
