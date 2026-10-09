import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import type { BuildPatternsResult, HabitPattern, LimitSuggestion } from "../../../supabase/functions/_shared/proactive/habitPatterns";

export type { HabitPattern, LimitSuggestion };
export type CommitmentState = { status: string; target_amount: number | null; friday: string };
export type HabitPatternsPayload = BuildPatternsResult & { as_of: string; commitments: Record<string, CommitmentState> };

export const HABIT_PATTERNS_KEY = "habit-patterns";

// Padrões da tela de hábitos (nino_habit_patterns.v1): o servidor usa os mesmos motores e números das mensagens.
export function useHabitPatterns() {
  const { user } = useAuth();
  return useQuery<HabitPatternsPayload>({
    queryKey: [HABIT_PATTERNS_KEY, user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("nino-insights", { body: { action: "habit_patterns" } });
      if (error || !data?.ok) throw new Error(error?.message ?? data?.error ?? "habit_patterns_failed");
      return data as HabitPatternsPayload;
    },
  });
}

// O compromisso só nasce com o aceite explícito (RPC `habit_limit_accept`); recusar é registrado e respeitado.
export function useLimitDecision() {
  const qc = useQueryClient();
  const rpc = supabase.rpc as unknown as (n: string, a: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
  const accept = useMutation({
    mutationFn: async (a: { suggestion: LimitSuggestion; target: number }) => {
      const s = a.suggestion;
      // O efeito no mês é recalculado para o valor editado: troca o esperado do fim de semana pelo limite.
      const projectedIfMet = Math.round((s.projected_before - s.expected + a.target) * 100) / 100;
      const { error } = await rpc("habit_limit_accept", {
        p_category: s.category, p_friday: s.friday, p_target: a.target, p_expected: s.expected,
        p_projected_before: s.projected_before, p_projected_if_met: projectedIfMet, p_anchor_kind: s.anchor.kind, p_anchor_amount: s.anchor.amount,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [HABIT_PATTERNS_KEY] }),
  });
  const decline = useMutation({
    mutationFn: async (a: { category: string; friday: string }) => {
      const { error } = await rpc("habit_limit_decline", { p_category: a.category, p_friday: a.friday });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [HABIT_PATTERNS_KEY] }),
  });
  return { accept, decline };
}

/** Efeito no mês de um limite editado (mesma conta da sugestão). */
export function projectedForTarget(s: Pick<LimitSuggestion, "projected_before" | "expected">, target: number): number {
  return Math.round((s.projected_before - s.expected + target) * 100) / 100;
}
