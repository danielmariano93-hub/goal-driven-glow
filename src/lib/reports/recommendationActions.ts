/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { Recommendation } from "@/lib/engine/reportV2";

// Aceitar ou dispensar uma recomendação fica gravado (uma linha por mês e ação): é o que permite medir depois
// a economia realizada contra o ponto de partida. A tabela é do próprio usuário (RLS).
export function useRecommendationAction(month: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useCallback(async (rec: Recommendation, action: "accepted" | "dismissed") => {
    if (!user) return;
    try {
      await (supabase as any).from("report_recommendation_actions").upsert({
        user_id: user.id, month, rec_key: rec.key, kind: rec.kind, title: rec.title, action,
        merchant_key: rec.merchantKey ?? null, category: rec.category ?? null,
        baseline_amount: rec.baselineAmount ?? null, monthly_impact: rec.monthlyImpact || null, updated_at: new Date().toISOString(),
      }, { onConflict: "user_id,month,rec_key" });
      await qc.invalidateQueries({ queryKey: ["report-v2"] });
    } catch { /* sem rede: a ação segue valendo na tela, só não fica gravada */ }
  }, [user, month, qc]);
}
