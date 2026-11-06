import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import type { MapaReading } from "@/lib/engine/mapaContracts";
import type { MapaEvidencePack } from "@/lib/engine/mapaEvidencePack";

type Rpc = (n: string) => Promise<{ data: unknown; error: unknown }>;

/** Flag do Mapa Financeiro (`mapa_enabled()`). Falha fechada: qualquer erro = experiência atual. */
export const mapaEnabledOptions = (userId: string | undefined) => ({
  queryKey: ["mapa-enabled", userId] as const,
  staleTime: 5 * 60_000,
  retry: 0,
  queryFn: async () => {
    const { data, error } = await (supabase.rpc as unknown as Rpc)("mapa_enabled");
    return !error && data === true;
  },
});

export function useMapaEnabled() {
  const { user } = useAuth();
  return useQuery({ ...mapaEnabledOptions(user?.id), enabled: !!user });
}

export const MAPA_QUERY_KEY = "mapa-reading";

/** Leitura do Mapa (`mapa_financeiro.v1`), calculada no servidor. Só roda com a flag ligada. */
export interface MapaPayload { mapa: MapaReading; evidence: MapaEvidencePack | null }

export const mapaReadingOptions = (userId: string | undefined) => ({
  queryKey: [MAPA_QUERY_KEY, userId] as const,
  staleTime: 2 * 60_000,
  retry: 1,
  queryFn: async (): Promise<MapaPayload> => {
    const { data, error } = await supabase.functions.invoke("nino-insights", { body: { action: "map" } });
    if (error) throw error;
    const res = data as { ok?: boolean; mapa?: MapaReading; evidence?: MapaEvidencePack } | null;
    if (!res || res.ok !== true || !res.mapa) throw new Error("Resposta inesperada do servidor.");
    return { mapa: res.mapa, evidence: res.evidence ?? null };
  },
});

export function useMapaReading(enabled: boolean) {
  const { user } = useAuth();
  return useQuery<MapaPayload>({ ...mapaReadingOptions(user?.id), enabled: !!user && enabled });
}

/**
 * Aquece o Mapa antes da pessoa abrir a tela: confere a flag e, se ligada, busca a leitura. Erro nunca aparece (é só cache).
 * Sem isso a tela esperava a flag para só então pedir a leitura (duas esperas em fila).
 */
export async function prefetchMapa(qc: QueryClient, userId: string | undefined): Promise<void> {
  if (!userId) return;
  try {
    const on = await qc.fetchQuery(mapaEnabledOptions(userId));
    if (on) await qc.prefetchQuery(mapaReadingOptions(userId));
  } catch { /* só aquecimento */ }
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
    // Melhoria opcional (a tela já mostra o texto determinístico): não entra na espera do "Tela pronta".
    meta: { nonBlocking: true },
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

/** Última medição de bem-estar (CFPB) só para a legenda da roda; o cartão de bem-estar tem a sua própria leitura. */
export function useLatestWellbeing(enabled: boolean) {
  const { user } = useAuth();
  return useQuery<number | null>({
    queryKey: ["mapa-wellbeing-latest", user?.id],
    enabled: !!user && enabled,
    staleTime: 60_000,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as Db).from("financial_wellbeing_responses").select("score,answered_at").order("answered_at", { ascending: false }).limit(1);
      if (error) return null;
      const row = (data ?? [])[0];
      return row && Number.isFinite(Number(row.score)) ? Number(row.score) : null;
    },
  });
}
