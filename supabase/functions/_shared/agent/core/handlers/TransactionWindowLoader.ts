// TransactionWindowLoader (`competence_window_load.v1`)
// Carrega os lançamentos confirmados que PODEM cair numa janela de competência.
//
// Causa-raiz que este módulo fecha (achada no piloto de 29/10): a leitura
// recortava só por `occurred_at ±45 dias`. Parcela de cartão de compra antiga
// (ex.: compra de abril, parcela que vence na fatura de setembro) tem
// `occurred_at` fora dessa folga, mas competência DENTRO da janela, e ficava de
// fora do total (terça de setembro: R$ 7.522,73 contra R$ 8.190,96 reais).
// Aqui a janela é lida por três caminhos e unida por id:
//   1. `occurred_at` na janela com folga (conta/débito e compras recentes);
//   2. `competence_date` na janela (fatura do cartão);
//   3. `economic_competence_date` na janela (parcela antecipada).
// O filtro final por competência continua sendo `reportingCompetenceDate`.
// deno-lint-ignore-file no-explicit-any
import { fetchAllPages } from "../../../derived/pagedSelect.ts";

export const COMPETENCE_WINDOW_PADDING_DAYS = 45;

function shiftDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function loadTransactionsForCompetenceWindow(
  sb: any,
  userId: string,
  from: string,
  to: string,
  columns: string,
): Promise<any[]> {
  const base = () => sb.from("transactions").select(columns)
    .eq("user_id", userId)
    .eq("status", "confirmed");
  const [byOccurred, byCompetence, byEconomic] = await Promise.all([
    fetchAllPages<any>((a, b) =>
      base().gte("occurred_at", shiftDays(from, -COMPETENCE_WINDOW_PADDING_DAYS))
        .lte("occurred_at", shiftDays(to, COMPETENCE_WINDOW_PADDING_DAYS))
        .order("occurred_at", { ascending: true }).order("id", { ascending: true }).range(a, b),
    { source: "competence_window_occurred" }),
    fetchAllPages<any>((a, b) =>
      base().gte("competence_date", from).lte("competence_date", to)
        .order("occurred_at", { ascending: true }).order("id", { ascending: true }).range(a, b),
    { source: "competence_window_competence" }),
    fetchAllPages<any>((a, b) =>
      base().gte("economic_competence_date", from).lte("economic_competence_date", to)
        .order("occurred_at", { ascending: true }).order("id", { ascending: true }).range(a, b),
    { source: "competence_window_economic" }),
  ]);
  const byId = new Map<string, any>();
  for (const row of [...byOccurred, ...byCompetence, ...byEconomic]) byId.set(String(row.id), row);
  return [...byId.values()].sort((x, y) => String(x.occurred_at).localeCompare(String(y.occurred_at)));
}
