import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { qk } from "@/lib/db/queryKeys";
import type { GoalBreakdown, MerchantTargetKind, SpendingHistoryAdvice } from "@/lib/engine/spendingGoals";
import type { GoalHistory } from "@/lib/engine/goalHistory";

// Metas hierárquicas de gasto (`spending_goals.v1`): a leitura vem do servidor,
// a mesma que alimenta o Nino e a comunicação ativa.

export type GoalReading = {
  goal_id: string;
  category_id: string;
  category_name: string;
  period: { start: string; end: string };
  period_type: string;
  status: string;
  limit: number;
  baseline: number | null;
  actual: number;
  remaining: number;
  projected: number;
  projected_overage: number;
  current_overage: number;
  daily_allowance: number;
  supports_daily_budget: boolean;
  savings_goal_id: string | null;
  breakdown: GoalBreakdown;
};

export type MerchantOption = {
  key: string;
  label: string;
  monthly_average: number;
  total_12m: number;
  months_present: number;
  last_date: string;
};

type GoalsResponse = { ok: boolean; as_of: string; goals: GoalReading[]; history: GoalHistory | null; advice: SpendingHistoryAdvice | null };
type GoalsOverview = { goals: GoalReading[]; history: GoalHistory | null };

const KEY = qk.spendingGoalReadings[0];

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("nino-insights", { body });
  if (error) throw error;
  if (!data || (data as { ok?: boolean }).ok !== true) throw new Error("Resposta inesperada do servidor.");
  return data as T;
}

/** Uma única leitura do servidor: metas do mês (com submetas) + histórico. */
function useGoalsOverview<T>(select: (data: GoalsOverview) => T) {
  const { user } = useAuth();
  return useQuery<GoalsOverview, Error, T>({
    queryKey: [KEY, user?.id],
    enabled: !!user,
    staleTime: 60_000,
    retry: 1,
    queryFn: async () => {
      const res = await invoke<GoalsResponse>({ action: "goals" });
      return { goals: res.goals ?? [], history: res.history ?? null };
    },
    select,
  });
}

/** Leitura das metas de gasto (categoria + submetas + Outros). */
export function useSpendingGoalReadings() {
  return useGoalsOverview((data) => data.goals);
}

/** Histórico mês a mês das metas (série por categoria, placar e highlights). */
export function useGoalHistory() {
  return useGoalsOverview((data) => data.history);
}

/** Análise do histórico: referência, tendência, atípicos, recomendado e impacto. */
export function useSpendingGoalAdvice(enabled = true) {
  const { user } = useAuth();
  return useQuery<SpendingHistoryAdvice | null>({
    queryKey: [KEY, "advice", user?.id],
    enabled: !!user && enabled,
    staleTime: 10 * 60_000,
    retry: 1,
    queryFn: async () => (await invoke<GoalsResponse>({ action: "goals", advice: true })).advice ?? null,
  });
}

export function useGoalMerchants(categoryId: string | null) {
  const { user } = useAuth();
  return useQuery<MerchantOption[]>({
    queryKey: [KEY, "merchants", user?.id, categoryId],
    enabled: !!user && !!categoryId,
    staleTime: 10 * 60_000,
    queryFn: async () => (await invoke<{ ok: boolean; merchants: MerchantOption[] }>({ action: "goal_merchants", category_id: categoryId })).merchants ?? [],
  });
}

export type MerchantTargetInput = {
  id?: string;
  goal_id: string;
  label: string;
  merchant_keys: string[];
  limit_kind: MerchantTargetKind;
  limit_amount: number | null;
  reduction_pct: number | null;
  baseline_amount: number | null;
  computed_limit: number | null;
};

// Tabela nova (fora dos tipos gerados): acesso mínimo e explícito.
type Untyped = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
    update: (row: Record<string, unknown>) => { eq: (col: string, value: string) => PromiseLike<{ error: { message: string } | null }> };
    delete: () => { eq: (col: string, value: string) => PromiseLike<{ error: { message: string } | null }> };
  };
};
const db = supabase as unknown as Untyped;

export function useSaveMerchantTarget() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: MerchantTargetInput) => {
      if (!user) throw new Error("Sessão expirada.");
      const row = {
        goal_id: input.goal_id,
        label: input.label.trim().slice(0, 80),
        merchant_keys: input.merchant_keys,
        limit_kind: input.limit_kind,
        limit_amount: input.limit_kind === "amount" ? input.limit_amount : null,
        reduction_pct: input.limit_kind === "percent_reduction" ? input.reduction_pct : null,
        baseline_amount: input.baseline_amount,
        computed_limit: input.limit_kind === "track" ? null : input.limit_kind === "zero" ? 0 : input.computed_limit,
      };
      const { error } = input.id
        ? await db.from("spending_goal_merchant_targets").update(row).eq("id", input.id)
        : await db.from("spending_goal_merchant_targets").insert({ ...row, user_id: user.id, created_via: "app" });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function useUpdateMerchantTargetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; status: "active" | "paused" | "cancelled" }) => {
      const { error } = args.status === "cancelled"
        ? await db.from("spending_goal_merchant_targets").delete().eq("id", args.id)
        : await db.from("spending_goal_merchant_targets").update({ status: args.status }).eq("id", args.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** Destino opcional da economia (reserva, investimento, dívida). */
export function useSetSavingsDestination() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { goal_id: string; savings_goal_id: string | null }) => {
      const { error } = await db.from("category_spending_goals").update({ savings_goal_id: args.savings_goal_id }).eq("id", args.goal_id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  });
}

/** Quando a categoria muda (meta, estorno, recategorização), a leitura é refeita. */
export function useInvalidateSpendingGoals() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [KEY] });
}
