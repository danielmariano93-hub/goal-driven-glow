import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ExperimentEvent } from "@/lib/behavioral/experimentCopy";

// Evidências dos experimentos: o que contou, candidatos para vincular e as
// ações (vincular, desfazer, concluir o roteiro guiado). A regra de contagem
// fica no banco; aqui só lemos e chamamos os RPCs.

export type LinkCandidate = {
  id: string;
  occurred_at: string;
  amount: number;
  type: string;
  description: string;
};

type RpcResult = { data: unknown; error: { message: string } | null };
const rpc = (name: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<RpcResult>)(name, args);

// A tabela ganhou colunas (source, ref_*, label) depois da geração dos tipos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const events = () => (supabase.from as unknown as (n: string) => any)("behavior_experiment_events");

export const EXPERIMENT_EVENTS_KEY = "behavior-experiment-events";

export function useExperimentEvents(experimentIds: string[]) {
  const key = [...experimentIds].sort().join(",");
  return useQuery<ExperimentEvent[]>({
    queryKey: [EXPERIMENT_EVENTS_KEY, key],
    enabled: experimentIds.length > 0,
    staleTime: 15_000,
    queryFn: async () => {
      const { data, error } = await events()
        .select("id,experiment_id,value,source,ref_type,ref_key,label,note,created_at")
        .in("experiment_id", experimentIds)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return ((data ?? []) as ExperimentEvent[]).map((row) => ({ ...row, value: Number(row.value) }));
    },
  });
}

export function useLinkCandidates(experimentId: string | null) {
  return useQuery<LinkCandidate[]>({
    queryKey: ["behavior-experiment-candidates", experimentId],
    enabled: !!experimentId,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await rpc("behavior_experiment_candidates", { p_experiment_id: experimentId });
      if (error) throw new Error(error.message);
      return ((data ?? []) as LinkCandidate[]).map((row) => ({ ...row, amount: Number(row.amount) }));
    },
  });
}

function useExperimentAction<TArgs>(call: (args: TArgs) => Promise<RpcResult>, onDone?: () => Promise<void> | void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => {
      const { error } = await call(args);
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [EXPERIMENT_EVENTS_KEY] }),
        qc.invalidateQueries({ queryKey: ["behavior-experiment-candidates"] }),
        qc.invalidateQueries({ queryKey: ["behavioral-dashboard"] }),
      ]);
      await onDone?.();
    },
  });
}

export const useLinkTransaction = (onDone?: () => Promise<void> | void) =>
  useExperimentAction((a: { experimentId: string; transactionId: string; note?: string }) =>
    rpc("behavior_experiment_link", { p_experiment_id: a.experimentId, p_transaction_id: a.transactionId, p_note: a.note ?? null }), onDone);

export const useUnlinkEvent = (onDone?: () => Promise<void> | void) =>
  useExperimentAction((a: { eventId: string }) => rpc("behavior_experiment_unlink", { p_event_id: a.eventId }), onDone);

export const useCompleteReview = (onDone?: () => Promise<void> | void) =>
  useExperimentAction((a: { experimentId: string }) => rpc("behavior_experiment_complete_review", { p_experiment_id: a.experimentId }), onDone);
