import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import type { GuideStateMap, GuideStatus, SetupStatus } from "@/lib/guide/catalog";

/** O que a pessoa já fez de verdade (derivado dos dados no servidor). */
export function useSetupStatus() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["guide_setup_status", user?.id],
    enabled: !!user,
    staleTime: 30_000,
    queryFn: async (): Promise<SetupStatus> => {
      const { data, error } = await supabase.rpc("guide_setup_status" as never);
      if (error) throw error;
      return data as unknown as SetupStatus;
    },
  });
}

/** O que já foi visto/concluído/dispensado, sincronizado entre dispositivos. */
export function useGuideState() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["guide_state", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<GuideStateMap> => {
      const { data, error } = await supabase.from("user_guide_state" as never).select("item_key,status");
      if (error) throw error;
      const map: GuideStateMap = {};
      for (const row of (data ?? []) as unknown as Array<{ item_key: string; status: GuideStatus }>) map[row.item_key] = row.status;
      return map;
    },
  });
}

export function useMarkGuide() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["guide_state", user?.id];
  return useMutation({
    mutationFn: async ({ itemKey, status }: { itemKey: string; status: GuideStatus }) => {
      if (!user) return;
      const { error } = await supabase
        .from("user_guide_state" as never)
        .upsert({ user_id: user.id, item_key: itemKey, status, updated_at: new Date().toISOString() } as never, { onConflict: "user_id,item_key" });
      if (error) throw error;
    },
    onMutate: async ({ itemKey, status }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<GuideStateMap>(key);
      qc.setQueryData<GuideStateMap>(key, { ...(prev ?? {}), [itemKey]: status });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(key, ctx.prev); },
    onSettled: () => { void qc.invalidateQueries({ queryKey: key }); },
  });
}
