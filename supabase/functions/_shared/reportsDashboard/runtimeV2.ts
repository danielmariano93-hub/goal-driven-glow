// Relatórios v2 no servidor (`report_v2`): carrega o livro canônico, a separação principal/juros das dívidas,
// o retrato do dia (Home), perfil, a receber, padrões e situações, e entrega o relatório pronto.
// deno-lint-ignore-file no-explicit-any
import { fetchAllPages } from "../derived/pagedSelect.ts";
import { loadExecutiveInput } from "../insights/executive/load.ts";
import { classifyFlexibility } from "../finance-core/costStructure.ts";
import { buildReportV2, type CompareKind, type ReportV2, type V2Inputs } from "../finance-core/reportV2.ts";
import { loadSavingsGoalIds } from "./runtime.ts";

const EXTRA_STRUCTURAL = /assinatura|mensalidade|iptu|ipva|presta/i;
export const isStructuralCategoryName = (name: string) => classifyFlexibility(name) === "estrutural" || EXTRA_STRUCTURAL.test(name);

export type ReportV2Params = { month: string; compare: CompareKind };

export function parseReportV2Params(raw: Record<string, any>, today: string): ReportV2Params | string {
  const month = typeof raw.month === "string" && /^\d{4}-\d{2}$/.test(raw.month) ? raw.month : today.slice(0, 7);
  if (month > today.slice(0, 7)) return "month_in_future";
  if (month < "2020-01") return "month_too_old";
  const compare = raw.compare === "year" || raw.compare === "none" ? raw.compare : "previous";
  return { month, compare };
}

const n = (v: unknown, d = 0) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const safe = async <T>(fallback: T, fn: () => Promise<T>): Promise<T> => { try { return await fn(); } catch { return fallback; } };

export async function loadReportV2(sb: any, userId: string, today: string, params: ReportV2Params): Promise<ReportV2> {
  const monthStart = `${params.month}-01`;
  const monthEndDate = (() => { const d = new Date(Date.UTC(Number(params.month.slice(0, 4)), Number(params.month.slice(5, 7)), 0)); return d.toISOString().slice(0, 10); })();
  const [cashRows, projRows, actionRows] = await Promise.all([
    params.month === today.slice(0, 7)
      ? safe<any[]>([], async () => fetchAllPages<any>((a, b) => sb.from("transactions").select("id,type,movement_kind,amount,transfer_group_id,settles_card_id").eq("user_id", userId).eq("status", "confirmed")
        .not("account_id", "is", null).is("credit_card_id", null).neq("payment_method", "credit_card").gte("occurred_at", `${params.month}-01`).lte("occurred_at", today > monthEndDate ? monthEndDate : today)
        .order("occurred_at", { ascending: true }).order("id", { ascending: true }).range(a, b), { source: "report_v2_cash" }))
      : Promise.resolve([] as any[]),
    safe<any[]>([], async () => (await sb.from("report_projection_snapshots").select("month,as_of,projected_consumption,projected_end_balance").eq("user_id", userId).order("as_of", { ascending: false }).limit(200)).data ?? []),
    safe<any[]>([], async () => (await sb.from("report_recommendation_actions").select("month,rec_key,kind,title,action,merchant_key,category,baseline_amount,monthly_impact").eq("user_id", userId).limit(200)).data ?? []),
  ]);
  const [debtsRows, recurringRows] = await Promise.all([
    safe<any[]>([], async () => (await sb.from("debts").select("installment_amount,installments_total,installments_paid,next_installment_due,next_installment_amount,status,kind").eq("user_id", userId).eq("status", "active")).data ?? []),
    safe<any[]>([], async () => (await sb.from("recurring_rules").select("amount,frequency,start_date,end_date,kind,status").eq("user_id", userId).eq("status", "active").eq("kind", "expense")).data ?? []),
  ]);
  const [ledger, snapshotRow, profileRow, monthlyRow, receivables, installments, patterns, situations, savingsGoalIds, nwRows, debtRows] = await Promise.all([
    loadExecutiveInput(sb, userId, `${params.month}-28`, 24, { includeDebtPayments: true }),
    safe<any>(null, async () => (await sb.from("financial_current_snapshots").select("payload,as_of_date").eq("user_id", userId).maybeSingle()).data),
    safe<any>(null, async () => (await sb.from("financial_profile_snapshots").select("as_of,closed_months_analyzed,income_baseline,savings_rate_median,sustainable_monthly_saving,recoverable_monthly,net_worth,confidence,flexible_sources").eq("user_id", userId).order("as_of", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle()).data),
    safe<any>(null, async () => (await sb.from("financial_monthly_facts").select("account_in,account_out,external_transfers_in,external_transfers_out").eq("user_id", userId).eq("competence_month", monthStart).maybeSingle()).data),
    safe<any[]>([], async () => fetchAllPages<any>((a, b) => sb.from("split_receivables_v1").select("balance_due,due_date,state,paid_amount,paid_at").eq("owner_user_id", userId).eq("split_status", "active").is("deleted_at", null).order("due_date", { ascending: true }).range(a, b), { source: "report_v2_receivables" })),
    safe<any[]>([], async () => (await sb.from("credit_card_installments").select("competence_month,amount,status,absorbed_by_statement_id").eq("user_id", userId).gte("competence_month", monthStart).limit(2000)).data ?? []),
    safe<any[]>([], async () => (await sb.from("behavioral_patterns").select("label,status,uplift_pct,absolute_delta,sample_size,confidence,data_coverage").eq("user_id", userId).in("status", ["validated", "candidate"]).order("confidence", { ascending: false }).limit(20)).data ?? []),
    safe<any[]>([], async () => (await sb.from("financial_situations").select("situation_key,confidence,status,financial_situation_actions(action_key,title,explanation,estimated_impact,route,status)").eq("user_id", userId).in("status", ["active", "confirmed", "observed"]).limit(20)).data ?? []),
    loadSavingsGoalIds(sb, userId),
    safe<any[]>([], async () => (await sb.from("financial_profile_snapshots").select("as_of,net_worth,closed_months_analyzed").eq("user_id", userId).gt("closed_months_analyzed", 0).order("as_of", { ascending: false }).limit(400)).data ?? []),
    safe<any[]>([], async () => (await sb.from("debt_payments").select("transaction_id,amount,amount_applied,interest_amount,fee_amount").eq("user_id", userId).not("transaction_id", "is", null).limit(5000)).data ?? []),
  ]);

  const debtSplits: V2Inputs["debtSplits"] = {};
  for (const r of debtRows) {
    const interest = n(r.interest_amount) + n(r.fee_amount);
    const total = n(r.amount);
    const principal = r.amount_applied != null ? n(r.amount_applied) : Math.max(0, total - interest);
    if (total > 0 && principal + interest > 0) debtSplits[String(r.transaction_id)] = { principal, interest };
  }

  const snapshot = snapshotRow?.as_of_date === today ? (snapshotRow.payload as any)?.snapshot ?? null : null;

  const byMonth = new Map<string, number>();
  for (const r of installments) {
    if (String(r.status ?? "") === "paid" || r.absorbed_by_statement_id) continue;
    const m = String(r.competence_month ?? "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m)) byMonth.set(m, (byMonth.get(m) ?? 0) + n(r.amount));
  }
  // Seis meses à frente do mês atual: cartões (parcelas já contratadas), dívidas (parcelas restantes) e recorrências mensais.
  const monthIdx = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
  const monthStr = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
  const baseIdx = monthIdx(today.slice(0, 7));
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const commitmentMonths = Array.from({ length: 6 }, (_, k) => {
    const idx = baseIdx + 1 + k;
    const month = monthStr(idx);
    let debts = 0;
    for (const d of debtsRows) {
      const total = n(d.installments_total); const paid = n(d.installments_paid);
      const remaining = total > 0 ? total - paid : 0;
      const nd = typeof d.next_installment_due === "string" ? d.next_installment_due.slice(0, 7) : null;
      if (!nd || remaining <= 0) continue;
      const offset = idx - monthIdx(nd);
      if (offset >= 0 && offset < remaining) debts += n(offset === 0 ? d.next_installment_amount ?? d.installment_amount : d.installment_amount);
    }
    let recurring = 0;
    for (const r of recurringRows) {
      if (r.frequency !== "monthly") continue;
      const start = typeof r.start_date === "string" ? r.start_date.slice(0, 7) : "0000-00";
      const end = typeof r.end_date === "string" ? r.end_date.slice(0, 7) : "9999-99";
      if (month >= start && month <= end) recurring += n(r.amount);
    }
    return { month, cards: r2(byMonth.get(month) ?? 0), debts: r2(debts), recurring: r2(recurring) };
  });

  const nwByMonth = new Map<string, number>();
  for (const r of nwRows) { const m = String(r.as_of).slice(0, 7); if (!nwByMonth.has(m)) nwByMonth.set(m, n(r.net_worth)); }
  const netWorthSeries = [...nwByMonth.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([month, value]) => ({ month, value }));

  const situationActions: V2Inputs["situationActions"] = [];
  for (const s of situations) {
    for (const a of (s.financial_situation_actions ?? []) as any[]) {
      if (String(a.status) !== "proposed") continue;
      situationActions.push({ key: String(a.action_key), title: String(a.title ?? ""), explanation: a.explanation ?? null, impact: a.estimated_impact == null ? null : n(a.estimated_impact), route: a.route ?? null, confidence: s.confidence == null ? null : n(s.confidence) });
    }
  }

  // Entradas e saídas de caixa do mês por tipo (transferência entre contas próprias não entra).
  const cashMovements: NonNullable<V2Inputs["cashMovements"]> = [];
  for (const r of cashRows) {
    if (r.transfer_group_id) continue;
    const amount = n(r.amount);
    if (amount <= 0) continue;
    const mk = String(r.movement_kind ?? "transaction");
    if (r.type === "income") {
      cashMovements.push({ dir: "in", amount, key: mk === "external_transfer_in" ? "in_external" : mk === "loan_proceeds" ? "in_loan" : mk === "refund" ? "in_refund" : mk === "investment_redemption" || mk === "investment_yield" ? "in_invest" : mk === "transaction" ? "in_income" : "in_other" });
    } else if (r.type === "expense") {
      cashMovements.push({ dir: "out", amount, key: r.settles_card_id || mk === "card_payment" ? "out_card" : mk === "debt_payment" || mk === "loan_payment" ? "out_debt" : mk === "external_transfer_out" ? "out_external" : mk === "investment_application" ? "out_invest" : mk === "transaction" ? "out_spend" : "out_other" });
    }
  }
  // Uma previsão por mês: a mais recente.
  const projectionHistory: NonNullable<V2Inputs["projectionHistory"]> = [];
  const seenMonth = new Set<string>();
  for (const r of projRows) { const m = String(r.month); if (seenMonth.has(m)) continue; seenMonth.add(m); projectionHistory.push({ month: m, asOf: String(r.as_of), projectedConsumption: r.projected_consumption == null ? null : n(r.projected_consumption), projectedEnd: r.projected_end_balance == null ? null : n(r.projected_end_balance) }); }
  const recommendationActions: NonNullable<V2Inputs["recommendationActions"]> = actionRows.map((r) => ({ month: String(r.month), recKey: String(r.rec_key), kind: String(r.kind), title: String(r.title ?? ""), action: r.action === "accepted" ? "accepted" : "dismissed", merchantKey: r.merchant_key ?? null, category: r.category ?? null, baselineAmount: r.baseline_amount == null ? null : n(r.baseline_amount), monthlyImpact: r.monthly_impact == null ? null : n(r.monthly_impact) }));

  const input: V2Inputs = {
    today, month: params.month, compare: params.compare,
    entries: ledger.entries as any,
    debtSplits,
    isStructuralCategory: isStructuralCategoryName,
    profile: profileRow ? {
      asOf: String(profileRow.as_of), closedMonths: n(profileRow.closed_months_analyzed),
      incomeBaseline: profileRow.income_baseline == null ? null : n(profileRow.income_baseline),
      savingsRateMedian: profileRow.savings_rate_median == null ? null : n(profileRow.savings_rate_median),
      sustainableMonthlySaving: profileRow.sustainable_monthly_saving == null ? null : n(profileRow.sustainable_monthly_saving),
      recoverableMonthly: profileRow.recoverable_monthly == null ? null : n(profileRow.recoverable_monthly),
      netWorth: profileRow.net_worth == null ? null : n(profileRow.net_worth),
      confidence: profileRow.confidence ?? null,
      flexibleSources: Array.isArray(profileRow.flexible_sources) ? profileRow.flexible_sources : [],
    } : null,
    snapshot,
    monthlyFact: monthlyRow ? { accountIn: n(monthlyRow.account_in), accountOut: n(monthlyRow.account_out), externalIn: n(monthlyRow.external_transfers_in), externalOut: n(monthlyRow.external_transfers_out) } : null,
    receivables: receivables.map((r) => ({ balance: n(r.balance_due), dueDate: String(r.due_date ?? "").slice(0, 10), state: String(r.state), paidAmount: n(r.paid_amount), paidAt: r.paid_at ? String(r.paid_at).slice(0, 10) : null })),
    commitmentMonths,
    patterns: patterns.map((p) => ({ label: String(p.label), status: String(p.status), upliftPct: p.uplift_pct == null ? null : n(p.uplift_pct), absoluteDelta: p.absolute_delta == null ? null : n(p.absolute_delta), sampleSize: n(p.sample_size), confidence: p.confidence == null ? null : n(p.confidence), coverage: p.data_coverage == null ? null : n(p.data_coverage) })),
    situationActions,
    savingsGoalIds,
    netWorthSeries, cashMovements, projectionHistory, recommendationActions,
  };
  const report = buildReportV2(input);
  // Memória da previsão: uma por dia do mês corrente, para comparar previsto x realizado quando o mês fechar.
  if (report.isCurrentMonth && (report.projections.consumption || report.projections.cash)) {
    try {
      await sb.from("report_projection_snapshots").upsert({
        user_id: userId, month: report.month, as_of: today,
        projected_consumption: report.projections.consumption?.total ?? null,
        projected_end_balance: report.projections.cash?.projectedEnd ?? null,
        conservative_end_balance: report.projections.cash?.conservativeEnd ?? null,
        formula_version: report.version,
        payload: { consumption: report.projections.consumption, cash: report.projections.cash?.steps ?? null },
      }, { onConflict: "user_id,month,as_of" });
    } catch { /* a previsão gravada é memória auxiliar: não derruba o relatório */ }
  }
  return report;
}
