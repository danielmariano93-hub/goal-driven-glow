import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { CheckinRow } from "./history";

/** Check-ins dos últimos N dias (compartilha cache entre o cartão, a Home e as telas de hábitos). */
export function useEmotionHistory(days: number) {
  const { user } = useAuth();
  return useQuery<CheckinRow[]>({
    queryKey: ["emotional_checkins", "history", user?.id, days],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - (days + 1) * 86_400_000).toISOString();
      const { data, error } = await (supabase.from("emotional_checkins") as any)
        .select("mood,emotion_key,declared_emotion_key,trigger_label,occurred_at")
        .gte("occurred_at", since).order("occurred_at", { ascending: true }).limit(500);
      if (error) throw error;
      return (data ?? []) as CheckinRow[];
    },
  });
}
