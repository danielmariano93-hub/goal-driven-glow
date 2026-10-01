import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import type { ObservedBehaviorProfile } from "@/lib/behavioral/mapCycle";
import { snapshotFromProfile, weekStartOf, type ObservedSnapshot } from "@/lib/behavioral/behaviorEvolution";
import { OBSERVED_SNAPSHOT_MIN_COVERAGE } from "@/lib/engine/behaviorObserved";

// Histórico semanal da leitura "Nino observa". A leitura de agora é gravada
// (uma linha por semana, atualizada no dia) sempre que a página carrega com
// dados canônicos; a tabela tem RLS por usuário.

const table = () => supabase.from("behavior_observed_snapshots");
export const OBSERVED_SNAPSHOTS_KEY = "behavior-observed-snapshots";

export function useObservedSnapshots() {
  const { user } = useAuth();
  return useQuery<ObservedSnapshot[]>({
    queryKey: [OBSERVED_SNAPSHOTS_KEY, user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await table()
        .select("week_start,overall_score,coverage,confidence,methodology_version,dimensions")
        .eq("user_id", user!.id)
        .order("week_start", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        confidence: row.confidence as ObservedSnapshot["confidence"],
        dimensions: (row.dimensions ?? {}) as ObservedSnapshot["dimensions"],
        overall_score: row.overall_score == null ? null : Number(row.overall_score),
      }));
    },
  });
}

/** Guarda a leitura desta semana. Não grava leitura vazia nem em modo degradado. */
export function useSaveObservedSnapshot(profile: ObservedBehaviorProfile | null, enabled: boolean) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (p: ObservedBehaviorProfile) => {
      const snap = snapshotFromProfile(p);
      const { error } = await table().upsert(
        { user_id: user!.id, week_start: weekStartOf(), ...snap, dimensions: snap.dimensions as never, updated_at: new Date().toISOString() },
        { onConflict: "user_id,week_start" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [OBSERVED_SNAPSHOTS_KEY] }),
  });
  const { mutate } = mutation;
  const asOf = profile?.asOf ?? null;
  const overall = profile?.overallScore ?? null;
  useEffect(() => {
    if (!user || !profile || !enabled || profile.coverage < OBSERVED_SNAPSHOT_MIN_COVERAGE) return;
    mutate(profile);
    // uma gravação por carga de leitura (asOf/nota mudam quando o dado muda)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, enabled, asOf, overall]);
}
