import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";

export type BankConnection = {
  id: string; item_id: string; label: string | null; status: string;
  last_synced_at: string | null; last_error: string | null;
};
export type BankLink = {
  id: string; connection_id: string; external_account_id: string; external_type: string;
  external_name: string | null; account_id: string | null; credit_card_id: string | null;
};
export type SyncCounters = {
  total: number; new: number; repeated_legitimate: number; exact_duplicate: number;
  probable_duplicate: number; needs_review: number; invalid: number;
};
export type SyncResult = {
  mode: "preview" | "stage"; from: string; to: string; totals: SyncCounters;
  skipped_pending: number; skipped_invalid: number;
  accounts: Array<{ name: string | null; fetched: number } & SyncCounters>;
  sample: Array<{ ordinal: number; verdict: string; movement_kind: string; type: string; amount: number; date: string; description: string }>;
  document_ids: string[];
};

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("openfinance-sync", { body });
  if (error) {
    let message = "Não foi possível concluir. Tente novamente.";
    try {
      const parsed = await (error as { context?: Response }).context?.json();
      if (parsed?.message) message = String(parsed.message);
    } catch { /* corpo ilegível: mantém a mensagem padrão */ }
    throw new Error(message);
  }
  return data as T;
}

/** Acesso beta: só quem foi liberado enxerga o recurso. */
export function useOpenFinanceEnabled() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["open_finance_enabled", user?.id],
    enabled: !!user,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("open_finance_enabled" as never);
      if (error) return false;
      return data === true;
    },
  });
}

export function useOpenFinanceStatus(enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["open_finance_status", user?.id],
    enabled: !!user && enabled,
    queryFn: () => invoke<{ configured: boolean; missing_secrets?: string[]; connections: BankConnection[]; links: BankLink[] }>({ action: "status" }),
  });
}

export function useOpenFinanceActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["open_finance_status"] });
  return {
    save: useMutation({
      mutationFn: async (v: { itemId: string; label: string }) => {
        const { error } = await supabase.rpc("bank_connection_save" as never, { p_item_id: v.itemId, p_label: v.label || null } as never);
        if (error) throw new Error(error.message.includes("invalid_item_id") ? "O ID da conexão precisa ser um UUID válido." : "Não consegui salvar a conexão.");
      },
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        const { error } = await supabase.rpc("bank_connection_remove" as never, { p_id: id } as never);
        if (error) throw new Error("Não consegui desconectar.");
      },
      onSuccess: refresh,
    }),
    link: useMutation({
      mutationFn: async (v: { connectionId: string; externalAccountId: string; accountId: string | null; cardId: string | null }) => {
        const { error } = await supabase.rpc("bank_account_link_set" as never, {
          p_connection_id: v.connectionId, p_external_account_id: v.externalAccountId,
          p_account_id: v.accountId, p_credit_card_id: v.cardId,
        } as never);
        if (error) throw new Error("Não consegui salvar o vínculo.");
      },
      onSuccess: refresh,
    }),
    connectToken: useMutation({
      mutationFn: async (connectionId?: string) =>
        (await invoke<{ connect_token: string }>({ action: "connect_token", connection_id: connectionId })).connect_token,
    }),
    discover: useMutation({
      mutationFn: (connectionId: string) => invoke<{ accounts: Array<{ id: string; name: string }> }>({ action: "discover", connection_id: connectionId }),
      onSuccess: refresh,
    }),
    run: useMutation({
      mutationFn: (v: { connectionId: string; mode: "preview" | "stage"; days: number }) =>
        invoke<SyncResult>({ action: v.mode, connection_id: v.connectionId, days: v.days }),
      onSuccess: refresh,
    }),
  };
}
