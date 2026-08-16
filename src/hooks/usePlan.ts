import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

export type PlanFeature =
  | "nino_whatsapp"
  | "nino_audio"
  | "nino_documents"
  | "relatorios_inteligentes"
  | "investimentos"
  | "divisao_do_role"
  | "metas_conjuntas";

export type PlanStatus = {
  plan_code: string;
  plan_name: string;
  status: "active" | "trialing" | "past_due" | "canceled" | "expired" | "none";
  source: "free" | "app_store" | "play_store" | "web" | "manual";
  current_period_end: string | null;
  trial_ends_at: string | null;
  features: Partial<Record<PlanFeature, boolean>>;
  is_paid: boolean;
};

const FREE_FALLBACK: PlanStatus = {
  plan_code: "free",
  plan_name: "Gratuito",
  status: "none",
  source: "free",
  current_period_end: null,
  trial_ends_at: null,
  features: {},
  is_paid: false,
};

export function usePlan() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ["my-plan", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<PlanStatus> => {
      const { data, error } = await supabase.rpc("get_my_plan" as any);
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as PlanStatus | null;
      return row ?? FREE_FALLBACK;
    },
  });

  const plan = query.data ?? FREE_FALLBACK;

  return {
    plan,
    loading: query.isLoading,
    refetch: query.refetch,
    /** Enquanto a cobrança não estiver ativa, nada é bloqueado por padrão. */
    hasFeature: (feature: PlanFeature) => plan.features?.[feature] !== false,
    isPaid: plan.is_paid,
  };
}
