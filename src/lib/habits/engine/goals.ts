// Objetivos e medidas (puro, só para a interface). Datas "AAAA-MM-DD" no dia local da pessoa.
import { addDays, diffDays } from "./dates";

export type Cadence = "weekly" | "monthly";

export interface MeasurePoint {
  date: string;
  value: number;
}

/** Mínimo de medidas antes de falar em tendência (a fita métrica erra cerca de 1 cm; com menos pontos qualquer variação pode ser ruído). */
export const MIN_TREND_POINTS = 4;
/** Mínimo de dias entre a primeira e a última medida para comparar a média do início com a média de agora. */
export const MIN_TREND_SPAN_DAYS = 14;

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

/** Média móvel de `windowDays` dias corridos terminando em cada medida (só as medidas daquele intervalo entram). */
export function movingAverage(points: MeasurePoint[], windowDays = 7): MeasurePoint[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((p) => {
    const from = addDays(p.date, -(windowDays - 1));
    const inWindow = sorted.filter((q) => q.date >= from && q.date <= p.date).map((q) => q.value);
    return { date: p.date, value: mean(inWindow) };
  });
}

export interface MeasureStats {
  n: number;
  first: MeasurePoint | null;
  last: MeasurePoint | null;
  /** última - primeira (nulo com menos de 2 medidas). */
  change: number | null;
  /** 4 medidas ou mais: dá para desenhar linha de tendência. */
  trend_ready: boolean;
}

export function measureStats(points: MeasurePoint[]): MeasureStats {
  const s = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const first = s[0] ?? null;
  const last = s[s.length - 1] ?? null;
  return { n: s.length, first, last, change: s.length >= 2 && first && last ? round(last.value - first.value) : null, trend_ready: s.length >= MIN_TREND_POINTS };
}

export interface AverageChange {
  /** Média das medidas dos 7 primeiros dias. */
  start: number;
  /** Média das medidas dos 7 últimos dias. */
  now: number;
  change: number;
}

/**
 * Variação do peso pela média semanal: média dos 7 primeiros dias contra a média dos 7 últimos. Nulo com menos de 4 medidas
 * ou menos de 14 dias entre a primeira e a última (o peso oscila 1 a 2 kg de um dia para o outro; ponto isolado não vale).
 */
export function averageChange(points: MeasurePoint[]): AverageChange | null {
  const s = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (s.length < MIN_TREND_POINTS) return null;
  const first = s[0].date;
  const last = s[s.length - 1].date;
  if (diffDays(first, last) < MIN_TREND_SPAN_DAYS) return null;
  const head = s.filter((p) => p.date <= addDays(first, 6)).map((p) => p.value);
  const tail = s.filter((p) => p.date >= addDays(last, -6)).map((p) => p.value);
  const start = mean(head);
  const now = mean(tail);
  return { start: round(start), now: round(now), change: round(now - start) };
}

/** Soma `n` meses a uma data, ficando no último dia do mês quando o dia não existe (31/01 + 1 mês = 28/02). */
export function addMonths(date: string, n: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + n;
  const d = Number(date.slice(8, 10));
  const target = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

export type DueState = "due" | "soon" | "ok";

export interface NextDue {
  due_on: string;
  /** "due" = já é dia (ou passou); "soon" = faltam até 2 dias; "ok" = longe. */
  state: DueState;
  days: number;
}

/** Próxima medida: a última + 7 dias (semanal) ou + 1 mês (mensal). Sem nenhuma medida, vale desde o começo do objetivo. */
export function nextDue(cadence: Cadence, lastDate: string | null, startedOn: string, today: string): NextDue {
  const due_on = lastDate == null ? startedOn : cadence === "weekly" ? addDays(lastDate, 7) : addMonths(lastDate, 1);
  const days = diffDays(today, due_on);
  return { due_on, days, state: days <= 0 ? "due" : days <= 2 ? "soon" : "ok" };
}

/** Frase da variação, sem julgamento: "−1,5 cm", "+0,4 kg", "sem variação". */
export function changeText(delta: number, unit: string): string {
  if (delta === 0) return "sem variação";
  const abs = String(Math.abs(delta)).replace(".", ",");
  return `${delta < 0 ? "−" : "+"}${abs} ${unit}`;
}
