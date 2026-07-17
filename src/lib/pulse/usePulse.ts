import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface PulseFactor { key: string; label: string; weight: number; value: number; missing?: boolean }
export interface PulseData {
  score: number;
  band: string;
  factors: PulseFactor[];
  next_action: { key: string; label: string; hint: string };
  week_delta: number;
  state: "ok" | "insufficient_data";
}

export function usePulse() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["pulse", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PulseData | null> => {
      try {
        const { data, error } = await supabase.functions.invoke("pulse-compute", { body: {} });
        if (error) throw error;
        return data as PulseData;
      } catch (e) {
        console.warn("[pulse] fallback:", (e as Error).message);
        return null;
      }
    },
  });
}

export function useInvalidatePulse() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["pulse"] });
}
