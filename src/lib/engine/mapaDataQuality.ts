// E0 — Data Quality Gate do Mapa Financeiro. Decide quais grupos de indicadores têm dados para existir. Puro.
import type { DataQuality, DataQualityFlag, Eligibility, EligibilityGroup } from "./mapaContracts";
import type { MapaMonthAgg, MapaMonthlyEntry } from "./mapaMonthly";

export const DATA_QUALITY_FORMULA = "data_quality.v1";
/** Razões de renda exigem 3 meses fechados com registro; tendências, 4. */
export const MIN_CLOSED_FOR_RATIOS = 3;
export const MIN_CLOSED_FOR_TRENDS = 4;
/** Sem lançamento há mais de N dias, a leitura é considerada defasada. */
export const STALE_ENTRY_DAYS = 10;
export const STALE_SYNC_DAYS = 7;
/** Diferença de conciliação (R$) acima da qual o caixa perde confiança. [provisório] */
export const RECONCILIATION_TOLERANCE_BRL = 50;

export interface DataQualityInput {
  asOf: string;
  entries: MapaMonthlyEntry[];
  months: MapaMonthAgg[];
  /** Dias desde a última sincronização do Open Finance (null = sem conexão). */
  lastSyncAgeDays?: number | null;
  /** Diferença de conciliação das pontes financeiras (R$). */
  reconciliationDifference?: number | null;
}

const DAY_MS = 86_400_000;
const dayMs = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);

export function computeDataQuality(input: DataQualityInput): DataQuality {
  const { asOf, entries, months } = input;
  const lastSync = input.lastSyncAgeDays ?? null;
  const recon = input.reconciliationDifference ?? null;
  const flags: DataQualityFlag[] = [];

  if (!entries.length) {
    return {
      months_history: 0, closed_months: 0, gap_months: 0, last_entry_age_days: null,
      last_sync_age_days: lastSync, reconciliation_difference: recon, flags: ["sem_dados"],
      eligibility: { razoes_de_renda: "bloqueado", tendencias: "bloqueado", caixa: "bloqueado", recencia: "bloqueado" },
    };
  }

  const closedActive = months.filter((m) => m.closed && m.entries > 0).length;
  const gaps = months.filter((m) => m.closed && m.entries === 0).length;
  const lastDate = entries.reduce((max, e) => (e.date > max ? e.date : max), entries[0].date);
  const lastAge = Math.max(0, Math.round((dayMs(asOf) - dayMs(lastDate)) / DAY_MS));

  if (closedActive < MIN_CLOSED_FOR_RATIOS) flags.push("poucos_meses_fechados");
  if (lastAge > STALE_ENTRY_DAYS) flags.push("sem_lancamentos_recentes");
  if (gaps > 0) flags.push("meses_sem_registro");
  if (lastSync !== null && lastSync > STALE_SYNC_DAYS) flags.push("sync_desatualizado");
  if (recon !== null && Math.abs(recon) > RECONCILIATION_TOLERANCE_BRL) flags.push("conciliacao_divergente");

  const ratios: Eligibility = closedActive >= MIN_CLOSED_FOR_RATIOS ? (gaps > 0 ? "parcial" : "ok") : "bloqueado";
  const trends: Eligibility = closedActive >= MIN_CLOSED_FOR_TRENDS ? (gaps > 0 ? "parcial" : "ok") : "bloqueado";
  const caixa: Eligibility = flags.includes("conciliacao_divergente") || flags.includes("sync_desatualizado") ? "parcial" : "ok";
  const recencia: Eligibility = flags.includes("sem_lancamentos_recentes") ? "parcial" : "ok";
  const eligibility: Record<EligibilityGroup, Eligibility> = { razoes_de_renda: ratios, tendencias: trends, caixa, recencia };

  return {
    months_history: months.length,
    closed_months: closedActive,
    gap_months: gaps,
    last_entry_age_days: lastAge,
    last_sync_age_days: lastSync,
    reconciliation_difference: recon,
    flags,
    eligibility,
  };
}
