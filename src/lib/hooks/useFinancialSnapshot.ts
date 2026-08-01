import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import {
  useAccounts,
  useAccountBalanceSnapshots,
  useAllTransactions,
  useCategories,
  useInvestments,
  useDebts,
  useCategorySpendingGoals,
} from "@/lib/db/finance";
import { computeFinancialSnapshot, type FinancialSnapshot } from "@/lib/engine/metrics";
import type { CardInstallmentRow, CardStatementRow } from "@/lib/engine/cardExposure";
import { todayISO, type RecurringRow } from "@/lib/engine/facts";
import type { DateRange } from "@/lib/engine/dailyAverage";

/**
 * Fonte única de verdade para os componentes da Home / Metas / Assessor.
 * Cache por [user, period, today] via React Query, invalidado por
 * `invalidateFinancialQueries` (que já invalida a chave "financial-snapshot").
 */
export function useFinancialSnapshot(period: DateRange): {
  data: FinancialSnapshot | null;
  loading: boolean;
} {
  const { user } = useAuth();
  const { data: accounts, isLoading: la } = useAccounts();
  const { data: snapshots, isLoading: ls } = useAccountBalanceSnapshots();
  const { data: txs, isLoading: lt } = useAllTransactions();
  const { data: investments } = useInvestments();
  const { data: debts } = useDebts();
  const { data: categories } = useCategories();
  const { data: categoryGoals } = useCategorySpendingGoals();

  const { data: recurring } = useQuery({
    queryKey: ["recurring_rules_active", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_rules" as never)
        .select("id,name,kind,amount,frequency,next_due_date,status");
      if (error) throw error;
      return (data as Array<{ id: string; name: string; kind: string; amount: number; frequency: string; next_due_date: string; status: string }> | null) ?? [];
    },
  });

  const { data: cardStatements } = useQuery({
    queryKey: ["credit_card_statements", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_card_statements" as never)
        .select("credit_card_id,competence_month,stated_total,paid_amount,outstanding_amount,reconciliation_difference,status");
      if (error) throw error;
      return (data as unknown as CardStatementRow[] | null) ?? [];
    },
  });

  const { data: cardInstallments } = useQuery({
    queryKey: ["credit_card_installments", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_card_installments" as never)
        .select("credit_card_id,competence_month,amount,status");
      if (error) throw error;
      return (data as unknown as CardInstallmentRow[] | null) ?? [];
    },
  });

  const { data: cards } = useQuery({
    queryKey: ["credit_cards", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("credit_cards" as never).select("id");
      if (error) throw error;
      return (data as unknown as Array<{ id: string }> | null) ?? [];
    },
  });

  const loading = la || ls || lt;
  const todayKey = todayISO();

  const snapshot = useMemo<FinancialSnapshot | null>(() => {
    if (loading) return null;
    const numericAccounts = (accounts ?? []).map((a) => ({
      id: a.id, name: a.name, type: a.type, opening_balance: Number(a.opening_balance), active: a.active,
    }));
    const numericTxs = (txs ?? []).map((t) => ({ ...t, amount: Number(t.amount) })) as never;
    const numericSnapshots = (snapshots ?? []).map((s) => ({ ...s, balance: Number(s.balance) })) as never;
    const recRows: RecurringRow[] = (recurring ?? [])
      .filter((r) => r.status === "active")
      .map((r) => ({
        id: r.id, name: r.name,
        type: (r.kind === "income" ? "income" : "expense") as "income" | "expense",
        amount: Number(r.amount || 0),
        frequency: (["daily","weekly","monthly","yearly"].includes(r.frequency) ? r.frequency : "monthly") as RecurringRow["frequency"],
        next_due_date: r.next_due_date,
        active: true,
      }));
    const categoryNameById: Record<string, string> = {};
    for (const c of categories ?? []) categoryNameById[c.id] = c.name;
    return computeFinancialSnapshot({
      accounts: numericAccounts,
      txs: numericTxs,
      recurring: recRows,
      snapshots: numericSnapshots,
      investments: (investments ?? []).map((i) => ({ id: i.id, name: i.name, invested_amount: Number(i.invested_amount), current_value: Number(i.current_value), goal_id: i.goal_id })),
      debts: (debts ?? []).map((d) => ({ id: d.id, name: d.name, outstanding_balance: Number(d.outstanding_balance), original_amount: Number(d.original_amount), status: d.status })),
      categoryGoals: (categoryGoals ?? []).map((g) => ({
        id: g.id, user_id: g.user_id, category_id: g.category_id,
        mode: g.mode as "percent_reduction" | "fixed_limit",
        reduction_pct: g.reduction_pct == null ? null : Number(g.reduction_pct),
        fixed_limit: g.fixed_limit == null ? null : Number(g.fixed_limit),
        baseline_kind: g.baseline_kind as "prev_month" | "avg_3m" | "custom",
        baseline_value: g.baseline_value == null ? null : Number(g.baseline_value),
        computed_limit: Number(g.computed_limit),
        frequency: g.frequency as "once" | "monthly" | "custom",
        start_date: g.start_date,
        end_date: g.end_date,
        status: g.status as "active" | "paused" | "cancelled",
        period_type: g.period_type as "this_month" | "next_month" | "next_30_days" | "custom" | "monthly_recurring" | undefined,
      })),
      categoryNameById,
      period,
      cardStatements: (cardStatements ?? []).map((s) => ({
        ...s,
        stated_total: Number(s.stated_total ?? 0),
        paid_amount: Number(s.paid_amount ?? 0),
        outstanding_amount: s.outstanding_amount == null ? null : Number(s.outstanding_amount),
        reconciliation_difference: s.reconciliation_difference == null ? null : Number(s.reconciliation_difference),
      })),
      cardInstallments: (cardInstallments ?? []).map((i) => ({ ...i, amount: Number(i.amount ?? 0) })),
      cardIds: (cards ?? []).map((c) => c.id),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, snapshots, txs, investments, debts, categories, categoryGoals, recurring, cardStatements, cardInstallments, cards, period.start, period.end, todayKey, loading]);

  return { data: snapshot, loading };
}
