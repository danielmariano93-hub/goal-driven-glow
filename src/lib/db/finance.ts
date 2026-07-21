import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/context/AuthContext";
import type {
  AccountInput,
  CategoryInput,
  TransactionInput,
  TransferInput,
  GoalInput,
  ContributionInput,
  InvestmentInput,
  DebtInput,
} from "@/lib/validation/finance";

export type AccountRow = Database["public"]["Tables"]["accounts"]["Row"];
export type CategoryRow = Database["public"]["Tables"]["categories"]["Row"];
export type TransactionRow = Database["public"]["Tables"]["transactions"]["Row"];
export type GoalRow = Database["public"]["Tables"]["goals"]["Row"];
export type ContributionRow = Database["public"]["Tables"]["goal_contributions"]["Row"];
export type InvestmentRow = Database["public"]["Tables"]["investments"]["Row"];
export type DebtRow = Database["public"]["Tables"]["debts"]["Row"];

// ================ ACCOUNTS ================
export function useAccounts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["accounts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as AccountRow[];
    },
  });
}

export function useAccountBalanceSnapshots() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["account_balance_snapshots", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_balance_snapshots" as never)
        .select("account_id,balance_date,balance,status")
        .eq("status", "confirmed")
        .order("balance_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Array<{ account_id: string; balance_date: string; balance: number; status: string }>;
    },
  });
}

export function useSaveAccount() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AccountInput & { id?: string }) => {
      if (!user) throw new Error("not authenticated");
      const payload = {
        user_id: user.id,
        name: input.name,
        type: input.type,
        institution: input.institution || null,
        opening_balance: input.opening_balance,
        active: input.active,
      };
      if (input.id) {
        const { error } = await supabase.from("accounts").update(payload).eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("accounts").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ================ CATEGORIES ================
export function useCategories() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["categories", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .is("archived_at", null)
        .order("type", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data as CategoryRow[];
    },
  });
}

/**
 * Retorna categorias ativas + arquivadas. Útil para renderizar lançamentos
 * históricos sem perder o rótulo de categorias já arquivadas pelo usuário.
 */
export function useAllCategories() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["categories", user?.id, "all"],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("*")
        .order("type", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data as CategoryRow[];
    },
  });
}

/**
 * Regra "override pessoal de padrão": ao editar uma categoria global
 * (user_id === null), a UI passa `sourceSlug` para criar um clone pessoal
 * herdando o mesmo slug. Isso permite que `resolveVisibleCategories` oculte a
 * global para esse usuário sem tocar em outros.
 */
export function useSaveCategory() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: CategoryInput & { id?: string; sourceSlug?: string }
    ): Promise<CategoryRow> => {
      if (!user) throw new Error("not authenticated");
      const autoSlug =
        input.name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") + "-" + user.id.slice(0, 6);
      const insertSlug = input.sourceSlug?.trim() || autoSlug;
      const payload = {
        user_id: user.id,
        slug: input.id ? undefined : insertSlug,
        name: input.name,
        type: input.type,
        color: input.color || null,
        icon: input.icon || null,
      };
      if (input.id) {
        const { data, error } = await supabase
          .from("categories")
          .update({ name: payload.name, type: payload.type, color: payload.color, icon: payload.icon })
          .eq("id", input.id)
          .select("*")
          .single();
        if (error) throw error;
        return data as CategoryRow;
      }
      const { data, error } = await supabase
        .from("categories")
        .insert(payload as never)
        .select("*")
        .single();
      if (error) throw error;
      return data as CategoryRow;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

/**
 * Aplica a regra de override pessoal: quando existe uma categoria pessoal ativa
 * do usuário com o mesmo slug de uma global, a global é ocultada apenas para
 * esse usuário. Pura, testável, não muda dados no banco.
 */
export function resolveVisibleCategories(rows: CategoryRow[], userId: string | null | undefined): CategoryRow[] {
  if (!userId) return rows;
  const overriddenSlugs = new Set(
    rows
      .filter((c) => c.user_id === userId && c.archived_at == null && c.slug)
      .map((c) => c.slug as string)
  );
  return rows.filter((c) => {
    if (c.user_id === null && overriddenSlugs.has(c.slug as string)) return false;
    return true;
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Global (user_id NULL) não pode ser removida.
      const { data: cat, error: catErr } = await supabase
        .from("categories")
        .select("id,user_id")
        .eq("id", id)
        .maybeSingle();
      if (catErr) throw catErr;
      if (!cat) throw new Error("Categoria não encontrada");
      if (cat.user_id === null) throw new Error("Categoria padrão não pode ser removida");

      // Se há transações vinculadas, arquiva (preserva histórico); caso contrário, apaga.
      const { count } = await supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("category_id", id);
      if ((count ?? 0) > 0) {
        const { error } = await supabase
          .from("categories")
          .update({ archived_at: new Date().toISOString() })
          .eq("id", id);
        if (error) throw error;
        return { archived: true, count: count ?? 0 };
      }
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;
      return { archived: false, count: 0 };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ================ TRANSACTIONS ================
export type TxFilters = {
  from?: string;
  to?: string;
  type?: "all" | "income" | "expense" | "transfer";
  accountId?: string;
  categoryId?: string;
  uncategorized?: boolean;
  search?: string;
};

export function useTransactions(filters: TxFilters = {}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["transactions", user?.id, filters],
    enabled: !!user,
    queryFn: async () => {
      // Paginação obrigatória: o PostgREST corta em 1000 linhas silenciosamente,
      // e os KPIs brutos da Home (computeAccountStatementTotals) exigem a amostra
      // completa do período. Iteramos em páginas de 1000 até esgotar o resultado.
      const PAGE = 1000;
      const rows: TransactionRow[] = [];
      let offset = 0;
      // Guarda de segurança: até 100k linhas por conta (100 páginas).
      for (let i = 0; i < 100; i++) {
        let q = supabase.from("transactions").select("*")
          .order("occurred_at", { ascending: false })
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (filters.from) q = q.gte("occurred_at", filters.from);
        if (filters.to) q = q.lte("occurred_at", filters.to);
        if (filters.type && filters.type !== "all") q = q.eq("type", filters.type);
        if (filters.accountId) q = q.eq("account_id", filters.accountId);
        if (filters.categoryId) q = q.eq("category_id", filters.categoryId);
        if (filters.uncategorized) q = q.is("category_id", null);
        if (filters.search?.trim()) {
          // Remove os caracteres que alteram a gramática do filtro `or` do
          // PostgREST; a busca continua livre para nomes com espaços/acentos.
          const term = filters.search.trim().replace(/[%_,()'\"]/g, " ").replace(/\s+/g, " ").slice(0, 80);
          q = q.or(`description.ilike.%${term}%,friendly_description.ilike.%${term}%,raw_description.ilike.%${term}%`);
        }
        const { data, error } = await q;
        if (error) throw error;
        const chunk = (data ?? []) as TransactionRow[];
        rows.push(...chunk);
        if (chunk.length < PAGE) break;
        offset += PAGE;
      }
      return rows;
    },
  });
}

export function useAllTransactions() {
  return useTransactions({});
}

export function useSaveTransaction() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TransactionInput & { id?: string }) => {
      if (!user) throw new Error("not authenticated");
      const payload = {
        user_id: user.id,
        account_id: input.payment_method === "credit_card" ? null : input.account_id,
        credit_card_id: input.payment_method === "credit_card" ? input.credit_card_id : null,
        payment_method: input.payment_method,
        category_id: input.category_id || null,
        type: input.type,
        status: input.status,
        amount: input.amount,
        occurred_at: input.occurred_at,
        description: input.description || null,
        notes: input.notes || null,
      };
      if (input.id) {
        const { error } = await supabase.from("transactions").update(payload).eq("id", input.id);
        if (error) throw error;
        if (input.category_id) {
          const { error: learnError } = await (supabase.rpc as any)("learn_transaction_category", {
            p_transaction_id: input.id,
            p_category_id: input.category_id,
          });
          if (learnError) console.warn("[category-learning]", learnError.message);
        }
      } else {
        const { error } = await supabase.from("transactions").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: TransactionRow) => {
      if (row.type === "transfer" && row.transfer_group_id) {
        const { error } = await supabase
          .from("transactions")
          .delete()
          .eq("transfer_group_id", row.transfer_group_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("transactions").delete().eq("id", row.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useCreateTransfer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: TransferInput) => {
      const { error } = await supabase.rpc("create_transfer", {
        p_from_account: input.from_account_id,
        p_to_account: input.to_account_id,
        p_amount: input.amount,
        p_occurred_at: input.occurred_at,
        p_description: input.description || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ================ GOALS ================
export function useGoals() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["goals", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("goals").select("*").order("priority", { ascending: true });
      if (error) throw error;
      return data as GoalRow[];
    },
  });
}

export function useSaveGoal() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: GoalInput & { id?: string; status?: string }) => {
      if (!user) throw new Error("not authenticated");
      const payload = {
        user_id: user.id,
        name: input.name,
        target_amount: input.target_amount,
        target_date: input.target_date || null,
        priority: input.priority,
        notes: input.notes || null,
      };
      if (input.id) {
        const { error } = await supabase
          .from("goals")
          .update({ ...payload, status: (input.status as "active" | "paused" | "completed") ?? "active" })
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("goals").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
}

export function useDeleteGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("goals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["contributions"] });
    },
  });
}

export function useContributions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["contributions", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("goal_contributions").select("*").order("occurred_at", { ascending: false });
      if (error) throw error;
      return data as ContributionRow[];
    },
  });
}

export function useAddContribution() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ContributionInput) => {
      if (!user) throw new Error("not authenticated");
      const { error } = await supabase.from("goal_contributions").insert({
        user_id: user.id,
        goal_id: input.goal_id,
        amount: input.amount,
        occurred_at: input.occurred_at,
        account_id: input.account_id || null,
        notes: input.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contributions"] }),
  });
}

export function useDeleteContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("goal_contributions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contributions"] }),
  });
}

// ================ INVESTMENTS ================
export function useInvestments() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["investments", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("investments").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as InvestmentRow[];
    },
  });
}

export function useSaveInvestment() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: InvestmentInput & { id?: string }) => {
      if (!user) throw new Error("not authenticated");
      const payload = {
        user_id: user.id,
        name: input.name,
        category: input.category,
        institution: input.institution || null,
        invested_amount: input.invested_amount,
        current_value: input.current_value,
        reference_date: input.reference_date,
        goal_id: input.goal_id || null,
        notes: input.notes || null,
      };
      if (input.id) {
        const { error } = await supabase.from("investments").update(payload).eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("investments").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investments"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteInvestment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("investments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investments"] }),
  });
}

// ================ DEBTS ================
export function useDebts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["debts", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("debts").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as DebtRow[];
    },
  });
}

export function useSaveDebt() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DebtInput & { id?: string; status?: string }) => {
      if (!user) throw new Error("not authenticated");
      const payload = {
        user_id: user.id,
        name: input.name,
        creditor: input.creditor || null,
        original_amount: input.original_amount,
        outstanding_balance: input.outstanding_balance,
        installment_amount: input.installment_amount ?? null,
        due_day: input.due_day ?? null,
        interest_rate_pct: input.interest_rate_pct ?? null,
        notes: input.notes || null,
      };
      if (input.id) {
        const { error } = await supabase
          .from("debts")
          .update({ ...payload, status: (input.status as "active" | "settled" | "defaulted") ?? "active" })
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("debts").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["debts"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDeleteDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("debts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["debts"] }),
  });
}
