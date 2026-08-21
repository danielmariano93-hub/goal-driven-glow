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
  useGoals,
  useContributions,
} from "@/lib/db/finance";
import { computeFinancialSnapshot, type FinancialSnapshot } from "@/lib/engine/metrics";
import type { CardInstallmentRow, CardStatementRow } from "@/lib/engine/cardExposure";
import { todayISO, type RecurringRow } from "@/lib/engine/facts";
import type { DateRange } from "@/lib/engine/dailyAverage";
import { nextOccurrences, type RecurringRule } from "@/lib/recurring/schedule";
import { qk } from "@/lib/db/queryKeys";
import type { FinancialIncomeSettings } from "@/lib/engine/incomeProjection";

export type SnapshotSource = "accounts" | "accountSnapshots" | "transactions" | "recurringRules" | "financialSettings" | "creditCards" | "cardStatements" | "cardInstallments" | "categories" | "investments" | "investmentMovements" | "debts" | "categoryGoals" | "goals" | "goalContributions";
export type SnapshotErrorKind = "permission" | "schema" | "network" | "timeout" | "unknown";
export type SnapshotSourceError = { source: SnapshotSource; critical: boolean; kind: SnapshotErrorKind };
export type SnapshotAvailability = {
  balance: "available" | "unavailable";
  rhythm: "available" | "unavailable";
  rhythmComparison: "available" | "unavailable";
  projection: "available" | "partial" | "unavailable";
  cardExposure: "available" | "unavailable";
  netWorth: "available" | "partial" | "unavailable";
  goals: "available" | "unavailable";
};

type RecurringRuleRow = RecurringRule & {
  id: string;
  name: string;
  kind: string;
  amount: number;
  status: string;
};

function errorKind(error: unknown): SnapshotErrorKind {
  const value = error as { code?: string; message?: string } | null;
  const message = value?.message?.toLowerCase() ?? "";
  if (value?.code === "42501" || message.includes("permission")) return "permission";
  if (value?.code === "42703" || message.includes("column")) return "schema";
  if (message.includes("timeout")) return "timeout";
  if (message.includes("fetch") || message.includes("network")) return "network";
  return "unknown";
}

/**
 * Fonte única de verdade para os componentes da Home / Metas / Assessor.
 * Cache por [user, period, today] via React Query, invalidado por
 * `invalidateFinancialQueries` (que já invalida a chave "financial-snapshot").
 */
export function useFinancialSnapshot(period: DateRange): {
  data: FinancialSnapshot | null;
  loading: boolean;
  error: unknown;
  partial: boolean;
  criticalError: unknown;
  partialErrors: SnapshotSourceError[];
  completeness: "complete" | "partial" | "unavailable";
  missingSources: SnapshotSource[];
  availability: SnapshotAvailability;
  refetch: () => Promise<void>;
  refetchCritical: () => Promise<void>;
  refetchMissing: () => Promise<void>;
  refetchAll: () => Promise<void>;
} {
  const { user } = useAuth();

  // ---- Snapshot materializado no servidor (`home_snapshot.v1`) -----------
  // Enquanto o servidor responde, o dispositivo NÃO baixa o histórico inteiro.
  // Só se o servidor falhar o cálculo local entra como rede de segurança.
  const serverQuery = useQuery({
    queryKey: ["home-snapshot", user?.id, period.start, period.end, todayISO()],
    enabled: !!user,
    staleTime: 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("home-snapshot", {
        body: { start: period.start, end: period.end, today: todayISO() },
      });
      if (error) throw error;
      const payload = data as { ok?: boolean; snapshot?: FinancialSnapshot; missing_sources?: string[] } | null;
      if (!payload?.ok || !payload.snapshot) throw new Error("snapshot_unavailable");
      return { snapshot: payload.snapshot, missing: payload.missing_sources ?? [] };
    },
  });
  const serverSnapshot = serverQuery.data?.snapshot ?? null;
  // Fallback local só quando o servidor realmente falhou.
  const useLocalFallback = serverQuery.isError;

  const accountsQuery = useAccounts();
  const snapshotsQuery = useAccountBalanceSnapshots();
  const txsQuery = useAllTransactions({ enabled: useLocalFallback });
  const investmentsQuery = useInvestments();
  const debtsQuery = useDebts();
  const categoriesQuery = useCategories();
  const categoryGoalsQuery = useCategorySpendingGoals();
  const goalsQuery = useGoals();
  const contributionsQuery = useContributions();
  const { data: accounts } = accountsQuery;
  const { data: snapshots } = snapshotsQuery;
  const { data: txs } = txsQuery;
  const { data: investments } = investmentsQuery;
  const { data: debts } = debtsQuery;
  const { data: categories } = categoriesQuery;
  const { data: categoryGoals } = categoryGoalsQuery;
  const { data: goals } = goalsQuery;
  const { data: goalContributions } = contributionsQuery;

  const recurringQuery = useQuery({
    queryKey: [...qk.recurringRules, "active", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_rules" as never)
        .select("id,name,kind,amount,frequency,start_date,end_date,day_of_month,weekday,status");
      if (error) throw error;
      return (data as unknown as RecurringRuleRow[] | null) ?? [];
    },
  });
  const { data: recurring } = recurringQuery;

  const financialSettingsQuery = useQuery({
    queryKey: [...qk.financialSettings, user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_financial_settings")
        .select("approximate_monthly_income,income_frequency,income_day")
        .eq("user_id", user?.id ?? "")
        .maybeSingle();
      if (error) throw error;
      return data as FinancialIncomeSettings | null;
    },
  });
  const { data: financialSettings } = financialSettingsQuery;

  const cardStatementsQuery = useQuery({
    queryKey: ["credit_card_statements", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_card_statements" as never)
        .select("id,credit_card_id,competence_month,due_date,stated_total,paid_amount,outstanding_amount,reconciliation_difference,status");
      if (error) throw error;
      return (data as unknown as CardStatementRow[] | null) ?? [];
    },
  });
  const { data: cardStatements } = cardStatementsQuery;

  const cardInstallmentsQuery = useQuery({
    queryKey: ["credit_card_installments", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("credit_card_installments" as never)
        .select("id,credit_card_id,competence_month,amount,status,absorbed_by_statement_id,legacy_transaction_id");
      if (error) throw error;
      return (data as unknown as CardInstallmentRow[] | null) ?? [];
    },
  });
  const { data: cardInstallments } = cardInstallmentsQuery;

  const cardsQuery = useQuery({
    queryKey: ["credit_cards", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("credit_cards" as never).select("id,name,closing_day,due_day");
      if (error) throw error;
      return (data as unknown as Array<{ id: string; name: string | null; closing_day: number | null; due_day: number | null }> | null) ?? [];
    },
  });
  const { data: cards } = cardsQuery;

  // Movimentos de investimento — habilitam a ponte patrimonial precisa (v4).
  const investmentMovementsQuery = useQuery({
    queryKey: [...qk.investmentMovements, "all", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("investment_movements" as never)
        .select("kind,amount,occurred_at");
      if (error) throw error;
      // A coluna canônica é `kind`; o contrato da ponte usa `type`.
      return ((data as unknown as Array<{ kind: string; amount: number; occurred_at: string }> | null) ?? [])
        .map((m) => ({ type: m.kind, amount: Number(m.amount || 0), occurred_at: m.occurred_at }));
    },
  });
  const { data: investmentMovements } = investmentMovementsQuery;

  const sources = [
    { source: "accounts" as const, critical: true, query: accountsQuery },
    { source: "accountSnapshots" as const, critical: true, query: snapshotsQuery },
    { source: "transactions" as const, critical: true, query: txsQuery },
    { source: "investments" as const, critical: false, query: investmentsQuery },
    { source: "debts" as const, critical: false, query: debtsQuery },
    { source: "categories" as const, critical: false, query: categoriesQuery },
    { source: "categoryGoals" as const, critical: false, query: categoryGoalsQuery },
    { source: "goals" as const, critical: false, query: goalsQuery },
    { source: "goalContributions" as const, critical: false, query: contributionsQuery },
    { source: "recurringRules" as const, critical: false, query: recurringQuery },
    { source: "financialSettings" as const, critical: false, query: financialSettingsQuery },
    { source: "cardStatements" as const, critical: false, query: cardStatementsQuery },
    { source: "cardInstallments" as const, critical: false, query: cardInstallmentsQuery },
    { source: "creditCards" as const, critical: false, query: cardsQuery },
    { source: "investmentMovements" as const, critical: false, query: investmentMovementsQuery },
  ];
  const criticalSources = sources.filter((item) => item.critical);
  const loading = criticalSources.some((item) => item.query.isLoading);
  const criticalError = criticalSources.find((item) => item.query.isError)?.query.error ?? null;
  const missingSources = sources.filter((item) => item.query.isError).map((item) => item.source);
  const partialErrors = sources.filter((item) => item.query.isError && !item.critical).map((item) => ({ source: item.source, critical: false, kind: errorKind(item.query.error) }));
  const partial = !criticalError && (partialErrors.length > 0 || sources.some((item) => !item.critical && item.query.isLoading));
  const completeness = criticalError ? "unavailable" as const : partial ? "partial" as const : "complete" as const;
  const failed = (source: SnapshotSource) => missingSources.includes(source);
  const availability: SnapshotAvailability = {
    balance: criticalError ? "unavailable" : "available",
    rhythm: criticalError ? "unavailable" : "available",
    rhythmComparison: criticalError ? "unavailable" : "available",
    projection: criticalError ? "unavailable" : failed("recurringRules") || failed("financialSettings") || failed("creditCards") || failed("cardStatements") || failed("cardInstallments") ? "partial" : "available",
    cardExposure: failed("creditCards") || failed("cardStatements") || failed("cardInstallments") ? "unavailable" : "available",
    netWorth: criticalError ? "unavailable" : failed("investments") || failed("investmentMovements") || failed("debts") ? "partial" : "available",
    goals: failed("goals") || failed("goalContributions") || failed("categoryGoals") ? "unavailable" : "available",
  };
  const todayKey = todayISO();

  const snapshot = useMemo<FinancialSnapshot | null>(() => {
    // O servidor é a fonte preferencial: nada é recalculado no cliente quando
    // o snapshot canônico chegou pronto.
    if (serverSnapshot) return serverSnapshot;
    if (!useLocalFallback) return null;
    if (loading || criticalError) return null;
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
        next_due_date: nextOccurrences(r, todayKey, 1)[0] ?? r.start_date,
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
      debts: (debts ?? []).map((d) => ({
        id: d.id, name: d.name,
        outstanding_balance: Number(d.outstanding_balance),
        original_amount: Number(d.original_amount),
        status: d.status,
        // Campos exigidos pela agenda canônica (parcela e dia de vencimento).
        installment_amount: (d as { installment_amount?: number | null }).installment_amount == null ? null : Number((d as { installment_amount?: number | null }).installment_amount),
        due_day: (d as { due_day?: number | null }).due_day == null ? null : Number((d as { due_day?: number | null }).due_day),
      })),
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
      categories: (categories ?? []).map((c) => ({ id: c.id, name: c.name, type: c.type as "income" | "expense" })),
      goals: (goals ?? []).map((g) => ({
        id: g.id, name: g.name, target_amount: Number(g.target_amount),
        target_date: g.target_date, status: g.status,
        kind: (g as { kind?: string | null }).kind ?? "savings",
        donation_mode: (g as { donation_mode?: "fixed" | "income_percent" | null }).donation_mode ?? null,
        donation_percent: (g as { donation_percent?: number | null }).donation_percent == null ? null : Number((g as { donation_percent?: number | null }).donation_percent),
        monthly_target: (g as { monthly_target?: number | null }).monthly_target == null ? null : Number((g as { monthly_target?: number | null }).monthly_target),
        donation_income_scope: (g as { donation_income_scope?: string | null }).donation_income_scope ?? "all",
        donation_income_category_ids: (g as { donation_income_category_ids?: string[] | null }).donation_income_category_ids ?? [],
        donation_due_day: Number((g as { donation_due_day?: number | null }).donation_due_day ?? 25),
        donation_end_date: (g as { donation_end_date?: string | null }).donation_end_date ?? null,
      })),
      goalContributions: (goalContributions ?? []).map((c) => ({
        goal_id: c.goal_id, amount: Number(c.amount), occurred_at: c.occurred_at,
      })),
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
      cards: (cards ?? []).map((c) => ({ id: c.id, name: c.name, closing_day: c.closing_day, due_day: c.due_day })),
      investmentMovements: (investmentMovements ?? []).map((m) => ({
        type: String(m.type), amount: Number(m.amount || 0), occurred_at: m.occurred_at,
      })),
      incomeSettings: financialSettings ? {
        ...financialSettings,
        approximate_monthly_income: financialSettings.approximate_monthly_income == null ? null : Number(financialSettings.approximate_monthly_income),
      } : null,
      audit: {
        completeness,
        missingSources,
        sourceFreshness: Object.fromEntries(sources.map((item) => [item.source, {
          status: item.query.isError ? "missing" : item.query.isFetching ? "stale" : "fresh",
          checkedAt: new Date().toISOString(),
        }])),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSnapshot, useLocalFallback, accounts, snapshots, txs, investments, debts, categories, categoryGoals, goals, goalContributions, recurring, financialSettings, cardStatements, cardInstallments, cards, investmentMovements, period.start, period.end, todayKey, loading, criticalError, completeness, missingSources.join("|")]);

  const refetchSources = async (selected: typeof sources) => {
    await Promise.all(selected.map((item) => item.query.refetch()));
  };
  const refetchAll = async () => refetchSources(sources);
  const refetchCritical = async () => refetchSources(criticalSources);
  const refetchMissing = async () => refetchSources(sources.filter((item) => item.query.isError));

  return {
    data: snapshot,
    loading,
    error: criticalError,
    partial,
    criticalError,
    partialErrors,
    completeness,
    missingSources,
    availability,
    refetch: refetchAll,
    refetchCritical,
    refetchMissing,
    refetchAll,
  };
}
