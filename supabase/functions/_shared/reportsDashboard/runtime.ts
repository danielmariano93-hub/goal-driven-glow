// Painel de Relatórios no servidor (`report_dashboard.v1`): carrega o livro
// canônico (competência, estornos, sem transferência/fatura/investimento) e
// entrega o painel pronto. O app só desenha.
// deno-lint-ignore-file no-explicit-any
import { fetchAllPages } from "../derived/pagedSelect.ts";
import { loadExecutiveInput } from "../insights/executive/load.ts";
import { buildReportDashboard, summarizeOtherInflows, type CompareMode, type ReportDashboard } from "../finance-core/reportDashboard.ts";

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

export async function loadReportDashboard(sb: any, userId: string, today: string, params: DashboardParams): Promise<ReportDashboard> {
  // 24 meses: o período escolhido (até 12 meses) e o período de comparação.
  const input = await loadExecutiveInput(sb, userId, today, 24, { includeDebtPayments: true });
  const dash = buildReportDashboard(input.entries, {
    today,
    start: params.start,
    end: params.end,
    compare: params.compare,
    categoryIds: params.categoryIds,
    merchant: params.merchant,
  });
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
  // Só mostra o que entrou fora da renda quando não há filtro (filtro = só despesa).
  if (!dash.filtered) dash.otherInflows = await loadOtherInflows(sb, userId, params.start, params.end);
  return dash;
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
