import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { invalidateFinancialQueries } from "@/lib/db/invalidation";

/**
 * Sincroniza escritas feitas fora desta sessão do app (Nino, WhatsApp e
 * importações). O filtro por user_id preserva o isolamento entre usuários;
 * as políticas do backend continuam sendo a barreira de autorização.
 */
export function FinancialRealtimeSync() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user?.id) return;
    let invalidation: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (invalidation) clearTimeout(invalidation);
      invalidation = setTimeout(() => {
        void invalidateFinancialQueries(queryClient);
      }, 150);
    };
    const channel = supabase
      .channel(`financial-sync:${user.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "transactions",
        filter: `user_id=eq.${user.id}`,
      }, refresh)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "category_spending_goals",
        filter: `user_id=eq.${user.id}`,
      }, refresh)
      .subscribe();

    return () => {
      if (invalidation) clearTimeout(invalidation);
      void supabase.removeChannel(channel);
    };
  }, [queryClient, user?.id]);

  return null;
}