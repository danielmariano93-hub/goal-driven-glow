import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import type { MapaReading } from "@/lib/engine/mapaContracts";
import type { MapaEvidencePack } from "@/lib/engine/mapaEvidencePack";

type Rpc = (n: string) => Promise<{ data: unknown; error: unknown }>;

/** Flag do Mapa Financeiro (`mapa_enabled()`). Falha fechada: qualquer erro = experiência atual. */
export function useMapaEnabled() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["mapa-enabled", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as unknown as Rpc)("mapa_enabled");
      return !error && data === true;
    },
  });
}

export const MAPA_QUERY_KEY = "mapa-reading";

/** Leitura do Mapa (`mapa_financeiro.v1`), calculada no servidor. Só roda com a flag ligada. */
export interface MapaPayload { mapa: MapaReading; evidence: MapaEvidencePack | null }

export function useMapaReading(enabled: boolean) {
  const { user } = useAuth();
  return useQuery<MapaPayload>({
    queryKey: [MAPA_QUERY_KEY, user?.id],
    enabled: !!user && enabled,
    staleTime: 2 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("nino-insights", { body: { action: "map" } });
      if (error) throw error;
      const res = data as { ok?: boolean; mapa?: MapaReading; evidence?: MapaEvidencePack } | null;
      if (!res || res.ok !== true || !res.mapa) throw new Error("Resposta inesperada do servidor.");
      return { mapa: res.mapa, evidence: res.evidence ?? null };
    },
  });
}

export interface MapaNarrativeOut { title: string; body: string; question: string | null; source: "llm" | "template" }

/** Texto redigido pela IA (com guarda e reserva determinística no servidor). Só roda depois que a leitura chegou. */
export function useMapaNarrative(enabled: boolean, hash: string | null) {
  const { user } = useAuth();
  return useQuery<MapaNarrativeOut | null>({
    queryKey: ["mapa-narrative", user?.id, hash],
    enabled: !!user && enabled && !!hash,
    staleTime: 10 * 60_000,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("nino-insights", { body: { action: "map_explain" } });
      if (error) return null; // a tela já mostra o texto determinístico
      const res = data as { ok?: boolean; narrative?: MapaNarrativeOut; hash?: string } | null;
      return res?.ok === true && res.narrative && res.hash === hash ? res.narrative : null;
    },
  });
}

type Db = { from: (t: string) => any };

/** Registra a resposta da pessoa a uma recomendação (alimenta a supressão do E11). */
export function useRecommendationEvent() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { rec_id: string; event: "accepted" | "dismissed" | "useful" | "not_useful" }) => {
      const { error } = await (supabase as unknown as Db).from("map_recommendation_events").insert({ user_id: user!.id, rec_id: v.rec_id, event: v.event });
      if (error) throw error;
    },
    onSuccess: (_d, v) => { if (v.event === "dismissed" || v.event === "not_useful") void qc.invalidateQueries({ queryKey: [MAPA_QUERY_KEY] }); },
  });
}
