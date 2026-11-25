// Painel de Relatórios no servidor (`report_dashboard.v1`): carrega o livro
// canônico (competência, estornos, sem transferência/fatura/investimento) e
// entrega o painel pronto. O app só desenha.
// deno-lint-ignore-file no-explicit-any
import { fetchAllPages } from "../derived/pagedSelect.ts";
import { loadExecutiveInput } from "../insights/executive/load.ts";
import { applyHomeProjection, buildReportDashboard, summarizeOtherInflows, type CompareMode, type ReportDashboard } from "../finance-core/reportDashboard.ts";
import { buildFutureView, buildReportStory } from "../finance-core/reportStory.ts";

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 400;

export type DashboardParams = {
  start: string;
  end: string;
  compare: CompareMode;
  categoryIds: string[];
  merchant: string;
};

const fmtBRL = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Antecipações cobradas em faturas cujo mês cai no período pedido. */
export function summarizeAnticipation(
  rows: Array<{ billed_month: string; economic_month: string; amount: number; group: string }>,
  start: string,
  end: string,
): ReportDashboard["anticipation"] {
  const from = start.slice(0, 7);
  const to = end.slice(0, 7);
  const inPeriod = rows.filter((r) => r.billed_month >= from && r.billed_month <= to);
  if (inPeriod.length === 0) return null;
  const byMonth = new Map<string, number>();
  let amount = 0;
  for (const r of inPeriod) {
    amount += r.amount;
    byMonth.set(r.economic_month, (byMonth.get(r.economic_month) ?? 0) + r.amount);
  }
  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  return {
    amount: round2(amount),
    count: inPeriod.length,
    purchases: new Set(inPeriod.map((r) => r.group)).size,
    months: [...byMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, v]) => ({ month, amount: round2(v) })),
  };
}

const ms = (iso: string) => Date.parse(`${iso}T12:00:00Z`);

/** Valida e normaliza o pedido. Devolve texto de erro quando inválido. */
export function parseDashboardParams(raw: Record<string, any>, today: string): DashboardParams | string {
  const start = String(raw.start ?? "");
  let end = String(raw.end ?? "");
  if (!DATE_RX.test(start) || !DATE_RX.test(end) || Number.isNaN(ms(start)) || Number.isNaN(ms(end))) return "invalid_period";
  if (end > today) end = today;
  if (start > end) return "invalid_period";
  if ((ms(end) - ms(start)) / 86_400_000 + 1 > MAX_SPAN_DAYS) return "period_too_long";
  const earliest = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  earliest.setUTCMonth(earliest.getUTCMonth() - 23);
  if (start < earliest.toISOString().slice(0, 10)) return "period_too_old";
  const compare = ["previous", "year", "none"].includes(String(raw.compare)) ? (raw.compare as CompareMode) : "previous";
  const categoryIds = Array.isArray(raw.category_ids)
    ? raw.category_ids.filter((id: unknown): id is string => typeof id === "string" && id.length <= 64).slice(0, 30)
    : [];
  const merchant = typeof raw.merchant === "string" ? raw.merchant.trim().slice(0, 60) : "";
  return { start, end, compare, categoryIds, merchant };
}

/**
 * Previsão de fechamento da Home (`financial_current_snapshots`), só quando está fresca: mesma versão do livro, de hoje e
 * sem recálculo pendente. Relatórios e Home têm de mostrar o MESMO número para "quanto vou gastar este mês".
 */
export async function loadHomeProjection(sb: any, userId: string, today: string) {
  try {
    const { data } = await sb.from("financial_current_snapshots")
      .select("payload,as_of_date").eq("user_id", userId).maybeSingle();
    const payload = data?.payload as any;
    const p = payload?.snapshot?.projection;
    if (!p || data?.as_of_date !== today || String(payload?.freshness ?? "fresh") !== "fresh") return null;
    const { getLedgerVersion } = await import("../derived/cache.ts");
    if (Number(payload?.ledger_version ?? -1) !== await getLedgerVersion(sb, userId)) return null;
    const total = Number(p.projectedTotalSpending);
    if (!Number.isFinite(total) || total <= 0 || p.confidence === "insufficient") return null;
    return {
      total: Math.round(total * 100) / 100,
      composition: {
        realized: Number(p.realizedConsumption ?? 0),
        variable: Number(p.projectedVariableSpending ?? 0),
        commitments: Number(p.upcomingConfirmedCommitments ?? 0),
        cardDue: Number(p.cardDueThisMonth ?? 0),
        confidence: String(p.confidence ?? ""),
      },
    };
  } catch {
    return null;
  }
}

export async function loadReportDashboard(sb: any, userId: string, today: string, params: DashboardParams): Promise<ReportDashboard> {
  // 24 meses: o período escolhido (até 12 meses) e o período de comparação.
  const input = await loadExecutiveInput(sb, userId, today, 24, { includeDebtPayments: true });
  let dash = buildReportDashboard(input.entries, {
    today,
    start: params.start,
    end: params.end,
    compare: params.compare,
    categoryIds: params.categoryIds,
    merchant: params.merchant,
  });
  // Mês em andamento sem filtro: o número é o da Home (mesma fonte), não uma conta paralela.
  if (dash.projection && !dash.filtered) {
    const home = await loadHomeProjection(sb, userId, today);
    if (home) dash = applyHomeProjection(dash, home);
  }
  dash.anticipation = summarizeAnticipation(input.anticipations ?? [], params.start, params.end);
  if (dash.anticipation && !dash.filtered) {
    const a = dash.anticipation;
    dash.highlights = [{
      id: "installment_anticipation",
      tone: "positive",
      title: `Você antecipou ${fmtBRL(a.amount)} em parcelas`,
      body: `Antecipar é pagar dívida antes do prazo, não gasto novo: o consumo continua nos meses em que as parcelas venceriam, e sua dívida a vencer caiu ${fmtBRL(a.amount)}.`,
      action: { label: "Ver cartões e parcelas", route: "/app/cartoes" },
    }, ...dash.highlights];
  }
  // A história do período (contra o habitual) e o futuro (compromissos, a receber, meta). Sem filtro: filtro = só despesa.
  if (!dash.filtered) {
    const [essentialIds, future] = await Promise.all([loadEssentialCategoryIds(sb, userId), loadFutureView(sb, userId, today)]);
    dash.story = buildReportStory({ entries: input.entries, today, start: params.start, end: params.end, essentialCategoryIds: essentialIds });
    dash.future = future;
  }
  // Só mostra o que entrou fora da renda quando não há filtro (filtro = só despesa).
  if (!dash.filtered) dash.otherInflows = await loadOtherInflows(sb, userId, params.start, params.end);
  return dash;
}

/** Categorias que a pessoa marcou como essenciais (a mesma marcação do Mapa Financeiro). */
export async function loadEssentialCategoryIds(sb: any, userId: string): Promise<string[]> {
  try {
    const { data } = await sb.from("category_essential_flags").select("category_id").eq("user_id", userId).eq("essential", true);
    return ((data ?? []) as Array<{ category_id: string }>).map((r) => r.category_id);
  } catch { return []; }
}

/** Metas de poupança ativas (exclui doação/dízimo). */
export async function loadSavingsGoalIds(sb: any, userId: string): Promise<string[]> {
  try {
    const { data } = await sb.from("goals").select("id").eq("user_id", userId).eq("kind", "savings").eq("status", "active");
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  } catch { return []; }
}

/** O que outras pessoas ainda devem ao usuário (Divisão do Rolê), o mesmo número do menu Mais. */
export async function loadReceivableFromPeople(sb: any, userId: string): Promise<number> {
  try {
    const { data: expenses } = await sb.from("shared_expenses").select("id").eq("owner_user_id", userId).is("deleted_at", null).in("status", ["active", "draft"]);
    const ids = ((expenses ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (ids.length === 0) return 0;
    const { data } = await sb.from("shared_expense_participants").select("amount_due,amount_paid,status").in("shared_expense_id", ids)
      .not("status", "in", "(paid,waived,opted_out)");
    return ((data ?? []) as Array<{ amount_due: number | null; amount_paid: number | null }>)
      .reduce((a, r) => a + Math.max(0, Number(r.amount_due ?? 0) - Number(r.amount_paid ?? 0)), 0);
  } catch { return 0; }
}

/** Compromissos de 30 dias, saldo e meta: lidos do snapshot da Home, só quando ele é de hoje. */
export async function loadFutureView(sb: any, userId: string, today: string) {
  try {
    const { data } = await sb.from("financial_current_snapshots").select("payload,as_of_date").eq("user_id", userId).maybeSingle();
    if (!data || data.as_of_date !== today) return null;
    const [people, savingsIds] = await Promise.all([loadReceivableFromPeople(sb, userId), loadSavingsGoalIds(sb, userId)]);
    return buildFutureView((data.payload as any)?.snapshot, today, people, savingsIds);
  } catch { return null; }
}

/** Entradas confirmadas do período que não contam como renda, para o "Entrou" não parecer o total. */
async function loadOtherInflows(sb: any, userId: string, start: string, end: string) {
  try {
    const data = await fetchAllPages<any>((from, to) =>
      sb.from("transactions")
        .select("id,movement_kind,amount,categories(name)")
        .eq("user_id", userId).eq("status", "confirmed").eq("type", "income")
        .in("movement_kind", ["investment_redemption", "investment_yield", "loan_proceeds", "external_transfer_in", "refund"])
        .gte("occurred_at", `${start}T00:00:00`).lte("occurred_at", `${end}T23:59:59`)
        .order("occurred_at", { ascending: true }).order("id", { ascending: true })
        .range(from, to),
      { source: "report_other_inflows" });
    return summarizeOtherInflows((data as any[]).map((r) => ({ movement_kind: r.movement_kind, amount: r.amount, category: r.categories?.name ?? null })));
  } catch { return []; }
}
