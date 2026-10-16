import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import type { MapaReading } from "@/lib/engine/mapaContracts";

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
export function useMapaReading(enabled: boolean) {
  const { user } = useAuth();
  return useQuery<MapaReading>({
    queryKey: [MAPA_QUERY_KEY, user?.id],
    enabled: !!user && enabled,
    staleTime: 2 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("nino-insights", { body: { action: "map" } });
      if (error) throw error;
      const res = data as { ok?: boolean; mapa?: MapaReading } | null;
      if (!res || res.ok !== true || !res.mapa) throw new Error("Resposta inesperada do servidor.");
      return res.mapa;
    },
  });
}
