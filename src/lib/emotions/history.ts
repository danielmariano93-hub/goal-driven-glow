// Histórico emocional (`emotion_history.v1`): calendário da semana, linha de evolução e frase-resumo.
// Mostra o que a pessoa marcou. Não gera nota, não infere emoção a partir de gasto e nunca julga.

import { EMOTION_CATALOG, resolveEmotion, type EmotionOption } from "./catalog";

export interface CheckinRow {
  mood?: number | null;
  emotion_key?: string | null;
  declared_emotion_key?: string | null;
  trigger_label?: string | null;
  occurred_at: string;
}

export interface EmotionDay {
  /** AAAA-MM-DD (São Paulo) */
  date: string;
  weekday: string;
  isToday: boolean;
  emotion: EmotionOption | null;
  /** Mais de um registro no dia (o calendário mostra o último). */
  count: number;
  mood: number | null;
}

const WEEKDAY = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export function saoPauloDay(value: string | Date): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const parts = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function shiftDay(day: string, delta: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(day: string): string {
  return WEEKDAY[new Date(`${day}T12:00:00Z`).getUTCDay()];
}

function emotionOf(row: CheckinRow): EmotionOption | null {
  const resolved = resolveEmotion(row.declared_emotion_key ?? row.emotion_key ?? row.trigger_label);
  if (resolved) return resolved;
  if (row.mood != null) return EMOTION_CATALOG.find((e) => e.mood === Number(row.mood)) ?? null;
  return null;
}

/** Um registro por dia: o último do dia vale. */
function byDay(rows: CheckinRow[]): Map<string, { last: CheckinRow; count: number }> {
  const map = new Map<string, { last: CheckinRow; count: number }>();
  for (const row of [...rows].sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : 1))) {
    const day = saoPauloDay(row.occurred_at);
    const prev = map.get(day);
    map.set(day, { last: row, count: (prev?.count ?? 0) + 1 });
  }
  return map;
}

/** Os 7 dias terminando hoje, do mais antigo para o mais novo. */
export function buildWeekStrip(rows: CheckinRow[], today: string): EmotionDay[] {
  const days = byDay(rows);
  return Array.from({ length: 7 }, (_, i) => {
    const date = shiftDay(today, i - 6);
    const hit = days.get(date);
    const emotion = hit ? emotionOf(hit.last) : null;
    return { date, weekday: weekdayOf(date), isToday: date === today, emotion, count: hit?.count ?? 0, mood: emotion?.mood ?? (hit?.last.mood ?? null) };
  });
}

export interface EvolutionPoint {
  /** AAAA-MM-DD do início do intervalo */
  date: string;
  label: string;
  mood: number;
  n: number;
}

export const MIN_POINTS_FOR_EVOLUTION = 3;

/** Humor médio por dia (até 45 dias) ou por semana (acima disso), na escala 1..5 do catálogo. */
export function buildEvolution(rows: CheckinRow[], today: string, windowDays: number): EvolutionPoint[] {
  const start = shiftDay(today, -(windowDays - 1));
  const days = byDay(rows);
  const perDay: Array<{ date: string; mood: number }> = [];
  for (const [date, { last }] of days) {
    if (date < start || date > today) continue;
    const e = emotionOf(last);
    const mood = e?.mood ?? (last.mood != null ? Number(last.mood) : null);
    if (mood != null) perDay.push({ date, mood });
  }
  perDay.sort((a, b) => (a.date < b.date ? -1 : 1));
  const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const daily = perDay.map((p) => ({ date: p.date, label: fmt(p.date), mood: p.mood, n: 1 }));
  if (windowDays <= 45) return daily;
  const weeks = new Map<string, number[]>();
  for (const p of perDay) {
    const dt = new Date(`${p.date}T12:00:00Z`);
    const monday = shiftDay(p.date, -((dt.getUTCDay() + 6) % 7));
    weeks.set(monday, [...(weeks.get(monday) ?? []), p.mood]);
  }
  const weekly = [...weeks.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, moods]) => ({
    date, label: fmt(date), mood: Math.round((moods.reduce((s, m) => s + m, 0) / moods.length) * 10) / 10, n: moods.length,
  }));
  // Poucas semanas com dado: a linha por dia mostra mais que 1 ou 2 pontos semanais.
  return weekly.length >= MIN_POINTS_FOR_EVOLUTION ? weekly : daily;
}

/** Emoji mais próximo de um humor médio (para marcar os extremos do gráfico). */
export function emojiForMood(mood: number): string {
  const rounded = Math.round(mood);
  const pool = EMOTION_CATALOG.filter((e) => e.primary || e.mood === rounded);
  return (pool.find((e) => e.mood === rounded) ?? EMOTION_CATALOG[0]).emoji;
}

/** Frase neutra do Nino sobre a semana. Só descreve; não explica causa. */
export function summarizeWeek(week: EmotionDay[]): string | null {
  const marked = week.filter((d) => d.emotion);
  if (marked.length === 0) return null;
  if (marked.length === 1) return `Você registrou ${marked[0].emotion!.label.toLowerCase()} ${marked[0].isToday ? "hoje" : `na ${marked[0].weekday}`}. Quanto mais dias, melhor o Nino enxerga seu padrão.`;
  const counts = new Map<string, { e: EmotionOption; n: number }>();
  for (const d of marked) counts.set(d.emotion!.key, { e: d.emotion!, n: (counts.get(d.emotion!.key)?.n ?? 0) + 1 });
  const top = [...counts.values()].sort((a, b) => b.n - a.n || b.e.mood - a.e.mood)[0];
  const base = `Em ${marked.length} dos últimos 7 dias você registrou como se sentia. O mais frequente foi ${top.e.label.toLowerCase()} (${top.n} ${top.n === 1 ? "dia" : "dias"}).`;
  const first = marked.slice(0, Math.ceil(marked.length / 2));
  const last = marked.slice(Math.floor(marked.length / 2));
  const avg = (xs: EmotionDay[]) => xs.reduce((s, d) => s + (d.mood ?? 3), 0) / xs.length;
  const diff = avg(last) - avg(first);
  if (marked.length >= 4 && Math.abs(diff) >= 1) return `${base} Os dias mais recentes ficaram ${diff > 0 ? "mais leves" : "mais pesados"} que os primeiros.`;
  return base;
}

/** Dias com gasto bem acima do usual, só para pôr ao lado do humor (sem concluir nada). */
export function highSpendDays(dailySpend: Map<string, number>): Set<string> {
  const values = [...dailySpend.values()].filter((v) => v > 0).sort((a, b) => a - b);
  if (values.length < 7) return new Set();
  const p90 = values[Math.floor(values.length * 0.9)];
  const median = values[Math.floor(values.length / 2)];
  const cut = Math.max(p90, median * 2);
  return new Set([...dailySpend.entries()].filter(([, v]) => v >= cut).map(([d]) => d));
}

/**
 * Curva suave (Catmull-Rom convertida em Bézier) passando por todos os pontos.
 * Os controles ficam entre os valores vizinhos no eixo vertical, então a linha nunca
 * "passa" do humor mínimo/máximo nem faz ondas que sugiram um valor que não existe.
 */
export function smoothPath(pts: Array<[number, number]>, tension = 0.5): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const lo = Math.min(p1[1], p2[1]);
    const hi = Math.max(p1[1], p2[1]);
    const clamp = (v: number) => Math.max(lo, Math.min(hi, v));
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension * 2;
    const c1y = clamp(p1[1] + ((p2[1] - p0[1]) / 6) * tension * 2);
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension * 2;
    const c2y = clamp(p2[1] - ((p3[1] - p1[1]) / 6) * tension * 2);
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}
