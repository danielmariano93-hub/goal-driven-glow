// Próximo passo do Nino (nino_change_agent.v1) na Home.
// A orientação é recalculada no servidor contra a verdade financeira vigente;
// a Home nunca inventa nem reaproveita silenciosamente uma recomendação velha.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { qk } from "@/lib/db/queryKeys";

export type NinoNextStep = {
  id: string;
  stage: string | null;
  title: string;
  detail: string | null;
  route: string | null;
  amount: number | null;
  amountRole: string | null;
  /** Valor necessário para cumprir o prazo vigente (transporte do motor). */
  requiredAmount: number | null;
  goalId: string | null;
  goalName: string | null;
};

function safeRoute(route: unknown): string | null {
  const value = typeof route === "string" ? route.trim() : "";
  if (!value.startsWith("/app/") || value.startsWith("//")) return null;
  return value;
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

type RefreshPayload = {
  ok?: boolean;
  error?: string;
  recommendation?: {
    id?: unknown;
    stage?: unknown;
    title?: unknown;
    detail?: unknown;
    route?: unknown;
    amount?: unknown;
    amount_role?: unknown;
    required_amount?: unknown;
    goal_id?: unknown;
    goal_name?: unknown;
  } | null;
};

export function useNinoNextStep() {
  const { user } = useAuth();
  return useQuery<NinoNextStep | null>({
    queryKey: [...qk.ninoNextStep, user?.id ?? "anon"],
    enabled: !!user?.id,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("nino-next-step", {
        body: { action: "refresh" },
      });
      if (error) throw error;
      const payload = data as RefreshPayload | null;
      if (!payload?.ok) throw new Error(payload?.error ?? "next_step_unavailable");
      const row = payload.recommendation;
      if (!row || typeof row.title !== "string" || !row.title.trim()) return null;
      return {
        id: typeof row.id === "string" ? row.id : "current",
        stage: typeof row.stage === "string" ? row.stage : null,
        title: row.title.trim(),
        detail: typeof row.detail === "string" && row.detail.trim() ? row.detail.trim() : null,
        route: safeRoute(row.route),
        amount: numberOrNull(row.amount),
        amountRole: typeof row.amount_role === "string" ? row.amount_role : null,
        requiredAmount: numberOrNull(row.required_amount),
        goalId: typeof row.goal_id === "string" ? row.goal_id : null,
        goalName: typeof row.goal_name === "string" && row.goal_name.trim() ? row.goal_name.trim() : null,
      };
    },
  });
}

/**
 * Aceite/dispensa do próximo passo. Toda a regra (revalidação material,
 * compromisso único, aprendizado) vive no motor — aqui é só a ponte.
 */
export function useNinoNextStepDecision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (action: "accept" | "dismiss") => {
      const { data, error } = await supabase.functions.invoke("nino-next-step", { body: { action } });
      if (error) throw error;
      const payload = data as { ok?: boolean; message?: string; error?: string } | null;
      if (!payload?.ok) throw new Error(payload?.error ?? "Não consegui registrar sua decisão agora.");
      return payload;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.ninoNextStep });
      void queryClient.invalidateQueries({ queryKey: ["nino-diagnosis"] });
    },
  });
}
