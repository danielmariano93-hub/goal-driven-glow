// Cenários fixos dos resumos (semanal 16–22/11/2026 e mensal de outubro/2026). Números redondos à mão
// para a reconciliação em centavos poder ser conferida linha a linha.
import type { SummaryRow, WeeklyInput } from "../../../supabase/functions/_shared/summaries/weekly";
import type { MonthlyInput } from "../../../supabase/functions/_shared/summaries/monthly";

const row = (day: string, amount: number, category: string, id?: string): SummaryRow => ({ id: id ?? `${day}-${category}-${amount}`, day, amount, category, small: amount > 0 && amount <= 50 && !/Moradia|Energia|Assinaturas/.test(category) });

/** Semana fechada 16–22/11 e a anterior 09–15/11, mais o começo de outubro/novembro para o mês até a data. */
export const weeklyRows: SummaryRow[] = [
  // Outubro 1–22 (base do "mês até a data")
  row("2026-10-02", 420.0, "Mercado"), row("2026-10-05", 1800.0, "Moradia"), row("2026-10-08", 215.09, "Energia"), row("2026-10-11", 96.4, "Restaurantes"),
  row("2026-10-15", 38.9, "Transporte"), row("2026-10-18", 312.55, "Mercado"), row("2026-10-21", 129.9, "Assinaturas"),
  // Novembro 1–8
  row("2026-11-02", 388.2, "Mercado"), row("2026-11-05", 1800.0, "Moradia"), row("2026-11-06", 213.54, "Energia"), row("2026-11-07", 42.5, "Restaurantes"),
  // Semana anterior 09–15/11
  row("2026-11-09", 154.3, "Mercado"), row("2026-11-11", 64.0, "Restaurantes"), row("2026-11-12", 27.9, "Transporte"), row("2026-11-14", 103.4, "Assinaturas"),
  // Semana 16–22/11
  row("2026-11-16", 231.75, "Mercado"), row("2026-11-17", 48.9, "Restaurantes"), row("2026-11-18", 89.0, "Restaurantes"), row("2026-11-19", 23.9, "Transporte"),
  row("2026-11-20", 35.0, "Transporte"), row("2026-11-21", 112.6, "Mercado"), row("2026-11-21", -40.0, "Mercado", "estorno-1"), row("2026-11-22", 27.5, "Restaurantes"),
];

export const weeklyInput = (over: Partial<WeeklyInput> = {}): WeeklyInput => ({
  userId: "user-fixture",
  timezone: "America/Sao_Paulo",
  asOf: "2026-11-23",
  weekStart: "2026-11-16",
  generatedAt: "2026-11-23T11:00:00.000Z",
  rows: weeklyRows,
  balances: { today: 4210.37, monthOpening: 4785.12 },
  future: {
    projectedEnd: 2330.81, projectedEndDate: "2026-11-30",
    income: { amount: 6500, date: "2026-12-05", status: "expected" },
    upcoming: [
      { date: "2026-11-25", label: "Fatura Nubank", amount: 1287.44, estimated: false },
      { date: "2026-11-28", label: "Internet", amount: 119.9, estimated: false },
      { date: "2026-12-09", label: "Parcela Tia", amount: 1566, estimated: false },
    ],
    minBalance: { amount: 2330.81, date: "2026-11-30" },
  },
  goals: [{ category: "Restaurantes", pct: 0.72, daysRemaining: 8, verdict: "no_ritmo" }],
  quality: { uncategorizedShare: 0.04, stale: false, notes: [] },
  ...over,
});

export const monthlyInput = (over: Partial<MonthlyInput> = {}): MonthlyInput => ({
  userId: "user-fixture",
  timezone: "America/Sao_Paulo",
  asOf: "2026-11-02",
  month: "2026-10",
  generatedAt: "2026-11-02T11:00:00.000Z",
  cur: { income: 7250.0, consumption: 5912.48, result: 1337.52, resultPartial: false, endBalance: 4920.18, debtPaid: 1566.0, hasEntries: true },
  prev: { income: 6980.0, consumption: 6455.3, result: 524.7, resultPartial: false, endBalance: 4102.6, debtPaid: 1566.0, hasEntries: true },
  categories: [
    { name: "Moradia", total: 1800, previous: 1800 },
    { name: "Mercado", total: 1243.7, previous: 1388.15 },
    { name: "Restaurantes", total: 702.3, previous: 951.8 },
    { name: "Energia", total: 215.09, previous: 238.4 },
  ],
  goals: { spending: [
    { category: "Restaurantes", pct: 0.88, verdict: "no_ritmo" },
    { category: "Mercado", pct: 0.95, verdict: "no_ritmo" },
    { category: "Lazer", pct: 1.12, verdict: "estourou" },
  ] },
  netWorth: { current: 18450.0, previous: 17210.4 },
  trend: [
    { month: "2026-05", result: 812.4, partial: false }, { month: "2026-06", result: -230.1, partial: false }, { month: "2026-07", result: 410.0, partial: false },
    { month: "2026-08", result: 98.35, partial: false }, { month: "2026-09", result: 524.7, partial: false }, { month: "2026-10", result: 1337.52, partial: false },
  ],
  next: { commitments: 3412.9, estimated: true, incomeBaseline: 7000, overdueReceivables: 180, toReceive: 640 },
  opportunity: null,
  cashRisk: null,
  quality: { pendingImports: false, uncategorizedShare: 0.03, notes: [] },
  ...over,
});
