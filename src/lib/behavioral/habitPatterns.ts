import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import type { BuildPatternsResult, HabitPattern, LimitSuggestion, PatternAction } from "../../../supabase/functions/_shared/proactive/habitPatterns";
import { validAnswers, type ContextAnswerRow } from "../../../supabase/functions/_shared/proactive/habitContext";

export type { HabitPattern, LimitSuggestion, PatternAction };
export type CommitmentState = { status: string; target_amount: number | null; friday: string; accepted_at: string | null; source: "whatsapp" | "app" | null };
export type HabitPatternsPayload = BuildPatternsResult & { as_of: string; commitments: Record<string, CommitmentState> };

export const HABIT_PATTERNS_KEY = "habit-patterns";
export const HABIT_CONTEXT_KEY = "habit-context-answers";

type Rpc = (n: string, a: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
const rpc = (): Rpc => supabase.rpc as unknown as Rpc;

// Padrões da tela de hábitos (nino_habit_patterns.v2): o servidor usa os mesmos motores e números das mensagens.
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

// O compromisso só nasce com o aceite explícito (RPC `habit_limit_accept`); recusar/desfazer é registrado e respeitado.
export function useLimitDecision() {
  const qc = useQueryClient();
  const accept = useMutation({
    mutationFn: async (a: { suggestion: LimitSuggestion; target: number }) => {
      const s = a.suggestion;
      // O efeito no mês é recalculado para o valor editado: troca o esperado do fim de semana pelo limite.
      const projectedIfMet = projectedForTarget(s, a.target);
      const { error } = await rpc()("habit_limit_accept", {
        p_category: s.category, p_friday: s.friday, p_target: a.target, p_expected: s.expected,
        p_projected_before: s.projected_before, p_projected_if_met: projectedIfMet, p_anchor_kind: s.anchor.kind, p_anchor_amount: s.anchor.amount,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [HABIT_PATTERNS_KEY] }),
  });
  const decline = useMutation({
    mutationFn: async (a: { category: string; friday: string }) => {
      const { error } = await rpc()("habit_limit_decline", { p_category: a.category, p_friday: a.friday });
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

// Respostas de contexto (tabela habit_context_answers; leitura direta, RLS por usuário).
export function useContextAnswers(today: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [HABIT_CONTEXT_KEY, user?.id],
    enabled: !!user,
    staleTime: 30_000,
    retry: 0,
    queryFn: async () => {
      // A tabela nasceu depois da geração dos tipos.
      const from = supabase.from as unknown as (n: string) => { select: (c: string) => { eq: (k: string, v: string) => { limit: (n: number) => Promise<{ data: ContextAnswerRow[] | null; error: unknown }> } } };
      const { data, error } = await from("habit_context_answers").select("subject,question,answer_keys,updated_at").eq("user_id", user!.id).limit(100);
      if (error) throw error;
      return data ?? [];
    },
    select: (rows) => validAnswers(rows, today),
  });
}

export function useContextAnswerMutations() {
  const qc = useQueryClient();
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: [HABIT_CONTEXT_KEY] }), qc.invalidateQueries({ queryKey: [HABIT_PATTERNS_KEY] }), qc.invalidateQueries({ queryKey: ["behavioral-dashboard"] })]);
  const answer = useMutation({
    mutationFn: async (a: { subjects: string[]; question: "planned_vs_spontaneous" | "what_weighs"; answers: string[] }) => {
      const { error } = await rpc()("habit_context_answer", { p_subjects: a.subjects, p_question: a.question, p_answers: a.answers });
      if (error) throw new Error(error.message);
    },
    onSuccess: refresh,
  });
  const clear = useMutation({
    mutationFn: async (a: { subjects: string[]; question: "planned_vs_spontaneous" | "what_weighs" }) => {
      const { error } = await rpc()("habit_context_clear", { p_subjects: a.subjects, p_question: a.question });
      if (error) throw new Error(error.message);
    },
    onSuccess: refresh,
  });
  return { answer, clear };
}

export type InsightEvent = "shown" | "answered" | "skipped" | "limit_opened" | "accepted" | "declined" | "undone" | "useful" | "not_useful" | "dimension_opened" | "dimension_answered";

/** Instrumentação de uso (exibido / respondido / aceito / dispensado). Nunca bloqueia nem quebra a tela. */
export function logInsightEvent(insightId: string, event: InsightEvent, meta: Record<string, unknown> = {}): void {
  try {
    void Promise.resolve(rpc()("habit_insight_event", { p_insight: insightId, p_event: event, p_meta: meta })).catch(() => undefined);
  } catch { /* instrumentação é opcional */ }
}
