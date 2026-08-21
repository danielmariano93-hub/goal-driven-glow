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
    let pending: "transactions" | "goals" | null = null;
    // Escopo granular: um lançamento novo não recarrega metas conjuntas,
    // documentos e recorrências — só o que depende de transações.
    const refresh = (scope: "transactions" | "goals") => () => {
      pending = pending && pending !== scope ? "transactions" : scope;
      if (invalidation) clearTimeout(invalidation);
      invalidation = setTimeout(() => {
        const s = pending ?? "transactions";
        pending = null;
        void invalidateFinancialQueries(queryClient, s);
      }, 150);
    };
    const channel = supabase
      .channel(`financial-sync:${user.id}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "transactions",
        filter: `user_id=eq.${user.id}`,
      }, refresh("transactions"))
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "category_spending_goals",
        filter: `user_id=eq.${user.id}`,
      }, refresh("goals"))
      .subscribe();


    return () => {
      if (invalidation) clearTimeout(invalidation);
      void supabase.removeChannel(channel);
    };
  }, [queryClient, user?.id]);

  return null;
}