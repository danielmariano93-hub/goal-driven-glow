// Próximo passo do Nino (nino_change_agent.v1) na Home.
// Lê a recomendação canônica já persistida pelo motor — a Home NUNCA calcula
// nem inventa um próximo passo. Sem recomendação vigente, nada é exibido.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

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

export function useNinoNextStep() {
  const { user } = useAuth();
  return useQuery<NinoNextStep | null>({
    queryKey: ["nino", "next-step", user?.id ?? "anon"],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("nino_change_recommendations")
        .select("id,title,detail,route,amount,amount_role,required_amount,goal_id,goal_name,stage,expires_at,status")
        .eq("status", "proposed")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data || !String(data.title ?? "").trim()) return null;
      return {
        id: String(data.id),
        stage: typeof data.stage === "string" ? data.stage : null,
        title: String(data.title).trim(),
        detail: typeof data.detail === "string" && data.detail.trim() ? data.detail.trim() : null,
        route: safeRoute(data.route),
        amount: numberOrNull(data.amount),
        amountRole: typeof data.amount_role === "string" ? data.amount_role : null,
        requiredAmount: numberOrNull((data as { required_amount?: unknown }).required_amount),
        goalId: typeof data.goal_id === "string" ? data.goal_id : null,
        goalName: typeof data.goal_name === "string" && data.goal_name.trim() ? data.goal_name.trim() : null,
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
      void queryClient.invalidateQueries({ queryKey: ["nino", "next-step"] });
      void queryClient.invalidateQueries({ queryKey: ["nino-diagnosis"] });
    },
  });
}
