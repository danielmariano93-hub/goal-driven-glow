// Próximo passo do Nino (nino_change_agent.v1) na Home.
// A leitura em si faz parte do bundle `ninoHomeIntelligence`; este módulo
// mantém apenas o contrato de tipo e as decisões accept/dismiss.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
      void queryClient.invalidateQueries({ queryKey: qk.ninoHomeIntelligence });
      void queryClient.invalidateQueries({ queryKey: ["nino-diagnosis"] });
    },
  });
}
