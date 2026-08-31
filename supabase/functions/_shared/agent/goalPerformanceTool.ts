// assess_goal_performance — ferramenta do motor canônico
// `goal_performance_assessment.v1`.
//
// Ela só CARREGA dados (metas ativas, categorias, ledger dos dois recortes) e
// delega 100% do cálculo ao motor espelhado em `finance-core`. Nenhuma fórmula
// nasce aqui: divergência App x Edge é bug P0.

// deno-lint-ignore-file no-explicit-any
type SupabaseClient = any;

import {
  computeGoalPerformanceAssessment,
  samePeriodPreviousMonth,
  type GoalPerformanceAssessment,
} from "../finance-core/goalPerformanceAssessment.ts";
import { TX_COLUMNS } from "../derived/txColumns.ts";
import { todaySaoPaulo } from "./parser.ts";

// Contrato único de colunas de lançamento (`TX_COLUMNS`). Nunca montar SELECT
// artesanal: campo inexistente derruba a leitura e o motor cai no fluxo antigo.
const TX_SELECT = TX_COLUMNS;

const PAGE = 1000;
const MAX_ROWS = 20000;

/** Recuo extra na carga: compra de 30/07 pode ter competência em agosto. */
const COMPETENCE_LOOKBACK_DAYS = 62;

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadTransactions(sb: SupabaseClient, userId: string, from: string, to: string) {
  const rows: any[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += PAGE) {
    const { data, error } = await sb.from("transactions")
      .select(TX_SELECT)
      .eq("user_id", userId)
      .gte("occurred_at", from)
      .lte("occurred_at", `${to}T23:59:59`)
      .order("occurred_at", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`transactions_query_failed:${error.message}`);
    const page = (data ?? []) as any[];
    rows.push(...page.map((r) => ({ ...r, amount: Number(r.amount) })));
    if (page.length < PAGE) return rows;
  }
  throw new Error(`transactions_query_exceeded_${MAX_ROWS}_rows`);
}


export type GoalPerformanceArgs = {
  current_from?: string | null;
  current_to?: string | null;
  comparison_from?: string | null;
  comparison_to?: string | null;
  category_ids?: string[] | null;
  comparison_basis?: "calendar_previous_month" | "preceding_window" | null;
};

export async function computeGoalPerformance(
  sb: SupabaseClient,
  userId: string,
  args: GoalPerformanceArgs = {},
): Promise<GoalPerformanceAssessment> {
  const today = args.current_to ? String(args.current_to) : todaySaoPaulo();
  const todayDate = new Date(`${today}T12:00:00`);

  const [goalsRes, categoriesRes, versionRes] = await Promise.all([
    sb.from("category_spending_goals")
      .select("id,user_id,category_id,mode,reduction_pct,fixed_limit,baseline_kind,baseline_value,computed_limit,frequency,start_date,end_date,status,period_type,recurrence_end_date,timezone")
      .eq("user_id", userId).eq("status", "active"),
    // Categorias pessoais E globais (`user_id IS NULL`): sem isso a meta fica
    // sem nome e o gate de identidade derruba a análise.
    sb.from("categories").select("id,name")
      .or(`user_id.eq.${userId},user_id.is.null`)
      .is("archived_at", null),

    sb.from("financial_ledger_versions").select("version").eq("user_id", userId).maybeSingle(),
  ]);
  if (goalsRes.error) throw new Error(`goals_query_failed:${goalsRes.error.message}`);
  if (categoriesRes.error) throw new Error(`categories_query_failed:${categoriesRes.error.message}`);

  const goals = (goalsRes.data ?? []) as any[];
  const categoryNameById: Record<string, string> = {};
  for (const c of (categoriesRes.data ?? []) as any[]) categoryNameById[String(c.id)] = String(c.name);

  // Recorte atual = mês da meta; a comparação define o início da carga.
  const currentFrom = args.current_from ? String(args.current_from) : `${today.slice(0, 7)}-01`;
  const comparison = args.comparison_from && args.comparison_to
    ? { from: String(args.comparison_from), to: String(args.comparison_to) }
    : samePeriodPreviousMonth({ from: currentFrom, to: today });

  const loadFrom = comparison.from < currentFrom ? comparison.from : currentFrom;
  const txs = await loadTransactions(sb, userId, shiftDays(loadFrom, -COMPETENCE_LOOKBACK_DAYS), today);


  return computeGoalPerformanceAssessment({
    goals: goals as any,
    txs: txs as any,
    categoryNameById,
    today: todayDate,
    current: { from: currentFrom, to: today },
    comparison,
    comparison_basis: args.comparison_basis ?? "calendar_previous_month",
    entity_ids: args.category_ids?.length ? args.category_ids.map(String) : undefined,
    freshness: {
      ledger_version: versionRes?.data?.version ?? null,
      source: "ledger",
      stale: false,
    },
  });
}
