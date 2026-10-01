// Painel de Relatórios no servidor (`report_dashboard.v1`): carrega o livro
// canônico (competência, estornos, sem transferência/fatura/investimento) e
// entrega o painel pronto. O app só desenha.
// deno-lint-ignore-file no-explicit-any
import { loadExecutiveInput } from "../insights/executive/load.ts";
import { buildReportDashboard, type CompareMode, type ReportDashboard } from "../finance-core/reportDashboard.ts";

const DATE_RX = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SPAN_DAYS = 400;

export type DashboardParams = {
  start: string;
  end: string;
  compare: CompareMode;
  categoryIds: string[];
  merchant: string;
};

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
  return buildReportDashboard(input.entries, {
    today,
    start: params.start,
    end: params.end,
    compare: params.compare,
    categoryIds: params.categoryIds,
    merchant: params.merchant,
  });
}
