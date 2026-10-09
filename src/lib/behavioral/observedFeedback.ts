import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  activeFeedback,
  FEEDBACK_NOTE_MAX,
  type BehaviorFeedback,
  type FeedbackReason,
} from "@/lib/behavioral/behaviorEvolution";
import type { BehaviorDimensionKey } from "@/lib/behavioral/client";

// "Isso não representa minha realidade" (tabela `behavior_observed_feedback`).
// A tabela nasceu depois da geração dos tipos; leitura e escrita só do próprio usuário (RLS).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = () => (supabase.from as unknown as (n: string) => any)("behavior_observed_feedback");

export const OBSERVED_FEEDBACK_KEY = "behavior-observed-feedback";

/** Texto livre limpo: sem quebras de linha/controle e no limite da coluna. */
export function cleanFeedbackNote(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, FEEDBACK_NOTE_MAX);
  return text || null;
}

export function useObservedFeedback(userId: string | undefined, today: string) {
  return useQuery({
    queryKey: [OBSERVED_FEEDBACK_KEY, userId],
    enabled: !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await table()
        .select("dimension,week_start,reason,note,observed_score")
        .eq("user_id", userId)
        .order("week_start", { ascending: false })
        .limit(20);
      if (error) throw error;
      return ((data ?? []) as BehaviorFeedback[]).map((row) => ({ ...row, observed_score: row.observed_score == null ? null : Number(row.observed_score) }));
    },
    select: (rows) => activeFeedback(rows, today),
  });
}

export function useContestDimension(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      dimension: BehaviorDimensionKey;
      weekStart: string;
      observedScore: number | null;
      observedConfidence: "low" | "medium" | "high" | null;
      reason: FeedbackReason;
      note: string | null;
    }) => {
      if (!userId) throw new Error("not_authenticated");
      const { error } = await table().upsert({
        user_id: userId,
        dimension: args.dimension,
        week_start: args.weekStart,
        observed_score: args.observedScore,
        observed_confidence: args.observedConfidence,
        reason: args.reason,
        note: cleanFeedbackNote(args.note),
      }, { onConflict: "user_id,dimension" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [OBSERVED_FEEDBACK_KEY] }),
  });
}

export function useRemoveFeedback(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (dimension: BehaviorDimensionKey) => {
      if (!userId) throw new Error("not_authenticated");
      const { error } = await table().delete().eq("user_id", userId).eq("dimension", dimension);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [OBSERVED_FEEDBACK_KEY] }),
  });
}
