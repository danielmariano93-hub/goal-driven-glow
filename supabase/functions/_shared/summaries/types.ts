// Nino Insights — resumos financeiros em PDF (semanal e mensal) entregues pelo WhatsApp.
// Contrato do resumo: tudo que o PDF mostra sai daqui. Valores em centavos; ausência é `null`, nunca zero.

export const SUMMARY_TEMPLATE_VERSION = "nino-summary-pdf.v2-mobile";
export const SUMMARY_DATA_VERSION = "summary-dto.v2";

export type SummaryType = "weekly" | "monthly";
export type MetricStatus = "ok" | "partial" | "unavailable" | "no_data";
/** Tom do valor: neutro por padrão; verde só melhora sustentada; vermelho risco; âmbar atenção. */
export type Tone = "neutral" | "good" | "risk" | "attention";

export interface SummaryMetric {
  id: string;
  label: string;
  amount_cents: number | null;
  unit: "BRL";
  status: MetricStatus;
  reference_amount_cents: number | null;
  delta_cents: number | null;
  delta_pct: number | null;
  /** Texto pronto da comparação ("+R$ 120,00 (+12%) vs. 7 dias anteriores", "sem comparação"…). */
  delta_text: string;
  comparison_label: string | null;
  tone: Tone;
  source: string;
  reason: string | null;
  /** Linha curta abaixo do número (contexto). */
  note?: string | null;
}

export interface SummaryCategory {
  name: string;
  amount_cents: number;
  reference_cents: number | null;
  delta_cents: number | null;
  delta_text: string;
  /** Fração da barra (0..1) em relação à maior; nula quando a barra não é válida. */
  bar: number | null;
}

export interface SummaryLine { label: string; value: string; tone?: Tone; note?: string | null }

export type InsightKind =
  | "cash_risk" | "data_quality" | "commitment_pressure" | "consumption_change"
  | "goal_risk" | "sustained_improvement" | "opportunity" | "neutral";

export interface SummaryInsight { kind: InsightKind; rule_id: string; title: string; body: string; tone: Tone }
export interface SummaryAction { rule_id: string; title: string; body: string }

export interface EvolutionBar { label: string; value_cents: number; partial: boolean }

/** Consumo por bloco de 7 dias do mês (1–7, 8–14, …) contra os mesmos dias do mês anterior. */
export interface WeekBar { label: string; current_cents: number | null; previous_cents: number | null; partial: boolean }
export interface WeekBars { title: string; current_label: string; previous_label: string; bars: WeekBar[]; note: string; total_current_cents: number; total_previous_cents: number | null }

export interface SummaryDTO {
  report_id: string;
  user_id: string;
  type: SummaryType;
  period_start: string;
  period_end_exclusive: string;
  as_of: string;
  timezone: string;
  is_partial: boolean;
  comparison_start: string | null;
  comparison_end_exclusive: string | null;
  generated_at: string;
  data_version: string;
  template_version: string;
  /** Cabeçalho. */
  title: string;
  subtitle: string;
  hero: SummaryMetric;
  /** Coluna direita do destaque: a base da comparação ou, no risco de caixa, o consumo do período. */
  hero_side: { label: string; value: string; note: string | null };
  /** Linha de baixo do destaque (até 2 números secundários, ex.: acumulado do mês e saldo de hoje). */
  hero_row: SummaryLine[];
  /** Grade de fatos (2 colunas) no layout de celular. */
  facts: SummaryLine[];
  week_bars: WeekBars | null;
  kpis: SummaryMetric[];
  categories: SummaryCategory[];
  categories_title: string;
  categories_empty: string | null;
  /** Bloco "olhando para frente" (semanal) / "próximo mês" (mensal). */
  future_title: string;
  future: SummaryLine[];
  /** Só no mensal: evolução. */
  evolution: { lines: SummaryLine[]; bars: EvolutionBar[] } | null;
  insight: SummaryInsight;
  action: SummaryAction;
  quality_flags: string[];
  /** Ressalva do rodapé (≤150). */
  caveat: string | null;
  metrics: SummaryMetric[];
}

export const TEXT_LIMITS = { title: 65, insight: 180, action: 120, caveat: 150 } as const;
