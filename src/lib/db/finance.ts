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
        .order("type", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data as CategoryRow[];
    },
  });
}

export function useSaveCategory() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CategoryInput & { id?: string }) => {
      if (!user) throw new Error("not authenticated");
      const slug =
        input.name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") + "-" + user.id.slice(0, 6);
      const payload = {
        user_id: user.id,
        slug: input.id ? undefined : slug,
        name: input.name,
        type: input.type,
        color: input.color || null,
        icon: input.icon || null,
      };
      if (input.id) {
        const { error } = await supabase
          .from("categories")
          .update({ name: payload.name, type: payload.type, color: payload.color, icon: payload.icon })
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("categories").insert(payload as never);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
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
};

export function useTransactions(filters: TxFilters = {}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["transactions", user?.id, filters],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase.from("transactions").select("*").order("occurred_at", { ascending: false }).order("created_at", { ascending: false });
      if (filters.from) q = q.gte("occurred_at", filters.from);
      if (filters.to) q = q.lte("occurred_at", filters.to);
      if (filters.type && filters.type !== "all") q = q.eq("type", filters.type);
      if (filters.accountId) q = q.eq("account_id", filters.accountId);
      if (filters.categoryId) q = q.eq("category_id", filters.categoryId);
      const { data, error } = await q;
      if (error) throw error;
      return data as TransactionRow[];
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
        account_id: input.account_id,
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
