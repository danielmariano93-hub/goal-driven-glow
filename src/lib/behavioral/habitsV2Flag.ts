import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

// Liberação controlada da experiência de hábitos v2: `habits_v2_enabled()` é true só
// para quem está em `habits_v2_access`. Falha fechada (qualquer erro = experiência atual).
export function useHabitsV2Enabled() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["habits-v2-enabled", user?.id],
    enabled: !!user,
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as unknown as (n: string) => Promise<{ data: unknown; error: unknown }>)("habits_v2_enabled");
      if (error) return false;
      return data === true;
    },
  });
}
