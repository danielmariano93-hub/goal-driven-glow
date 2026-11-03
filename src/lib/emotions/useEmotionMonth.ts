import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { monthBounds, retroOccurredAt, saoPauloDay, shiftDay, type CheckinRow } from "./history";
import type { EmotionOption } from "./catalog";

export interface MonthCheckin extends CheckinRow {
  id: string;
  notes?: string | null;
}

/** Check-ins de um mês (com folga de 1 dia nas pontas por causa do fuso). */
export function useEmotionMonth(month: string) {
  const { user } = useAuth();
  return useQuery<MonthCheckin[]>({
    queryKey: ["emotional_checkins", "month", user?.id, month],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async () => {
      const { first, last } = monthBounds(month);
      const { data, error } = await (supabase.from("emotional_checkins") as any)
        .select("id,mood,emotion_key,declared_emotion_key,trigger_label,occurred_at,notes")
        .gte("occurred_at", `${shiftDay(first, -1)}T00:00:00Z`)
        .lte("occurred_at", `${shiftDay(last, 1)}T23:59:59Z`)
        .order("occurred_at", { ascending: true }).limit(200);
      if (error) throw error;
      return (data ?? []) as MonthCheckin[];
    },
  });
}

/** Registra (ou corrige) o humor de um dia passado. Um registro por dia: se já existe, atualiza. */
export function useSaveRetroCheckin() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { day: string; emotion: EmotionOption; note: string; existingId: string | null }) => {
      if (!user) throw new Error("not_authenticated");
      const payload = {
        mood: input.emotion.mood,
        emotion_key: input.emotion.key,
        declared_emotion_key: input.emotion.key,
        declared_text: input.emotion.label,
        notes: input.note.trim() || null,
      };
      if (input.existingId) {
        const { error } = await (supabase.from("emotional_checkins") as any).update(payload).eq("id", input.existingId);
        if (error) throw error;
        return;
      }
      const { error } = await (supabase.from("emotional_checkins") as any).insert({
        ...payload, id: crypto.randomUUID(), user_id: user.id,
        occurred_at: input.day === saoPauloDay(new Date()) ? new Date().toISOString() : retroOccurredAt(input.day), measurement_version: "money_mood.retro.v1",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const key of ["emotional_checkins", "emotional-today", "pulse", "behavioral-evolution"]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}
