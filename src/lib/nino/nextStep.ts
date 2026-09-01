// Próximo passo do Nino (nino_change_agent.v1) na Home.
// Lê a recomendação canônica já persistida pelo motor — a Home NUNCA calcula
// nem inventa um próximo passo. Sem recomendação vigente, nada é exibido.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

export type NinoNextStep = {
  id: string;
  title: string;
  detail: string | null;
  route: string | null;
  amount: number | null;
  amountRole: string | null;
  stage: string | null;
  confidence: number | null;
};

function safeRoute(route: unknown): string | null {
  const value = typeof route === "string" ? route.trim() : "";
  if (!value.startsWith("/app/") || value.startsWith("//")) return null;
  return value;
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
        .select("id,title,detail,route,amount,amount_role,stage,confidence,expires_at,status")
        .eq("status", "proposed")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data || !String(data.title ?? "").trim()) return null;
      return {
        id: String(data.id),
        title: String(data.title).trim(),
        detail: typeof data.detail === "string" && data.detail.trim() ? data.detail.trim() : null,
        route: safeRoute(data.route),
        amount: typeof data.amount === "number" ? data.amount : null,
        amountRole: typeof data.amount_role === "string" ? data.amount_role : null,
        stage: typeof data.stage === "string" ? data.stage : null,
        confidence: typeof data.confidence === "number" ? data.confidence : null,
      };
    },
  });
}
