// Adaptador insights_catalog.v1 → destaques do relatório (reports_catalog.v1).
// ============================================================================
// Reaproveita os MESMOS detectores determinísticos da dica do dia, sem duplicar
// regra nem criar número novo: cada candidato já vem com `evidence` calculada
// pelo finance-core. Aqui só traduzimos o contrato de dica para o contrato de
// destaque (família, prioridade, tipo e CTA).
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  computeActiveDebtsTotal,
  type TransactionRow,
} from "../_shared/finance-core/facts.ts";
import { computeCommitmentAgenda } from "../_shared/finance-core/commitmentAgenda.ts";
import {
  computeCardExposure,
  totalCardDebtOf,
  totalFutureInstallmentsOf,
  type CardInstallmentRow,
  type CardStatementRow,
} from "../_shared/finance-core/cardExposure.ts";
import { deterministicCandidates, type DeterministicCandidate } from "../_shared/insights/detectors.ts";
import type { ReportHighlight, ReportPayload } from "../_shared/reports-core/types.ts";

/** Família + prioridade de cada detector do catálogo dentro do relatório. */
const CATALOG_META: Record<string, { family: string; priority: number }> = {
  card_statement_due_7d: { family: "cartao_vencimento", priority: 96 },
  card_debt_vs_income: { family: "cartao", priority: 94 },
  future_installments_pressure: { family: "parcelas_futuras", priority: 68 },
  card_statement_missing_document: { family: "documentos", priority: 58 },
  debt_above_income: { family: "dividas", priority: 93 },
  commitments_next_7d: { family: "caixa_7d", priority: 88 },
  financial_risk: { family: "resultado", priority: 90 },
  cashflow_forecast: { family: "caixa_30d", priority: 89 },
  amount_anomaly: { family: "anomalia", priority: 54 },
  category_growth: { family: "categoria", priority: 84 },
  subscriptions_load: { family: "assinaturas", priority: 62 },
  recurring_merchant: { family: "comerciante", priority: 52 },
  spending_rhythm: { family: "ritmo", priority: 66 },
  data_quality_uncategorized: { family: "categorizacao", priority: 74 },
  days_without_entry: { family: "engajamento", priority: 48 },
};

const TYPE_MAP: Record<string, ReportHighlight["type"]> = {
  alert: "risk",
  celebration: "win",
  opportunity: "opportunity",
  onboarding: "opportunity",
  habit: "info",
  categorize_transaction: "info",
};

function toHighlight(c: DeterministicCandidate, prefix: string): ReportHighlight | null {
  const meta = CATALOG_META[c.detector];
  if (!meta) return null;
  return {
    detectorKey: c.detector,
    family: meta.family,
    source: "catalog",
    type: TYPE_MAP[c.type] ?? "info",
    title: c.title,
    body: c.body,
    priority: meta.priority,
    confidence: "medium",
    category: null,
    evidence: { ...c.evidence, insight_family: meta.family, insight_source: "insights_catalog.v1" },
    ctaLabel: c.cta_label ?? null,
    ctaRoute: c.cta_route ?? null,
    dedupKey: `${prefix}:catalog:${c.detector}`,
    selectionReason: `detector determinístico ${c.detector} (insights_catalog.v1)`,
  };
}

const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/**
 * Roda o catálogo determinístico com os dados de hoje e devolve destaques
 * prontos para o merge do relatório. Nunca lança: falha volta lista vazia.
 */
export async function buildCatalogHighlights(
  sb: SupabaseClient,
  userId: string,
  payload: ReportPayload,
  transactions: TransactionRow[],
  now: Date = new Date(),
): Promise<ReportHighlight[]> {
  try {
    const todayISO = now.toISOString().slice(0, 10);
    const in7 = new Date(now.getTime() + 7 * 86400_000).toISOString().slice(0, 10);
    const currentYM = ymOf(now);

    const [cards, statements, installments, debts, rules, accounts] = await Promise.all([
      sb.from("credit_cards").select("id,closing_day,due_day").eq("user_id", userId).eq("active", true),
      sb.from("credit_card_statements")
        .select("id,credit_card_id,competence_month,status,total_amount,outstanding_amount,paid_amount,due_date")
        .eq("user_id", userId),
      sb.from("credit_card_installments")
        .select("id,credit_card_id,competence_month,amount,absorbed_by_statement_id")
        .eq("user_id", userId),
      sb.from("debts").select("id,name,outstanding_balance,status,installment_amount,due_day").eq("user_id", userId).eq("status", "active"),
      sb.from("recurring_rules")
        .select("id,status,amount,frequency,day_of_month,weekday,start_date,end_date,kind,name")
        .eq("user_id", userId).eq("status", "active"),
      sb.from("accounts").select("current_balance,active").eq("user_id", userId),
    ]);

    const cardRows = (cards.data ?? []) as Array<{ id: string; closing_day?: number | null; due_day?: number | null }>;
    const statementRows = (statements.data ?? []) as unknown as CardStatementRow[];
    const exposures = computeCardExposure({
      cardIds: cardRows.map((c) => c.id),
      statements: statementRows,
      installments: (installments.data ?? []) as unknown as CardInstallmentRow[],
      txs: transactions,
      currentYM,
      cards: cardRows.map((c) => ({ id: c.id, closing_day: c.closing_day ?? null, due_day: c.due_day ?? null })),
      todayISO,
    });

    const statementsDueIn7d = statementRows
      .filter((st) => {
        const due = (st as unknown as { due_date?: string | null }).due_date ?? "";
        const outstanding = Number((st as unknown as { outstanding_amount?: number | string }).outstanding_amount ?? 0);
        return !!due && due >= todayISO && due <= in7 && outstanding > 0;
      })
      .map((st) => ({
        cardId: st.credit_card_id,
        dueDate: String((st as unknown as { due_date?: string }).due_date),
        amount: Number((st as unknown as { outstanding_amount?: number | string }).outstanding_amount ?? 0),
      }));

    const ruleRows = (rules.data ?? []) as Array<{ kind?: string; frequency?: string; amount?: number | string }>;
    const normalizedRules = ((rules.data ?? []) as Array<Record<string, unknown>>).map((rule) => ({
      id: String(rule.id),
      name: String(rule.name ?? "Compromisso"),
      type: rule.kind === "income" ? "income" : "expense",
      amount: Number(rule.amount ?? 0),
      frequency: String(rule.frequency ?? "monthly"),
      next_due_date: String(rule.start_date ?? todayISO),
      active: rule.status === "active",
    }));
    // Agenda canônica (commitment_agenda.v1) — mesma fonte da Home.
    const agendaBase = {
      recurring: normalizedRules as never,
      txs: transactions,
      statements: statementRows as never,
      installments: (installments.data ?? []) as never,
      cards: cardRows as never,
      debts: (debts.data ?? []) as never,
    };
    const commitments7d = computeCommitmentAgenda({ ...agendaBase, horizonDays: 7 });
    const commitments30d = computeCommitmentAgenda({ ...agendaBase, horizonDays: 30 });

    const availableToday = Number(
      ((accounts.data ?? []) as Array<{ current_balance?: number | string; active?: boolean }>)
        .filter((a) => a?.active !== false)
        .reduce((acc, a) => acc + Number(a.current_balance ?? 0), 0)
        .toFixed(2),
    );

    const subscriptionRules = ruleRows.filter((r) => r?.kind === "expense" && (r.frequency ?? "monthly") === "monthly");
    const subscriptions = subscriptionRules.length > 0
      ? {
        count: subscriptionRules.length,
        total: Number(subscriptionRules.reduce((a, r) => a + Math.abs(Number(r.amount ?? 0)), 0).toFixed(2)),
      }
      : null;

    const candidates = deterministicCandidates({
      cardDebtToday: totalCardDebtOf(exposures),
      cardFutureInstallments: totalFutureInstallmentsOf(exposures),
      cardDebtIsEstimated: Object.values(exposures).some((e) => e.currentStatement.source !== "official"),
      statementsDueIn7d,
      activeDebtTotal: computeActiveDebtsTotal((debts.data ?? []) as never),
      expenseMonth: payload.totals.expense,
      incomeMonth: payload.totals.income,
      upcomingCommitments7d: Number(commitments7d.totalExpense ?? 0),
      upcomingCommitments30d: Number(commitments30d.totalExpense ?? 0),
      availableToday,
      subscriptions,
    });

    const prefix = `${payload.reportType}:${payload.period.start}`;
    return candidates
      .map((c) => toHighlight(c, prefix))
      .filter((h): h is ReportHighlight => h !== null);
  } catch (_e) {
    return [];
  }
}
