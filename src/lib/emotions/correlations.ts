/** Correlação factual emoção × categoria/dia — apenas descritiva, com amostra mínima. */

export const MIN_SAMPLE = 5;

export interface EmotionTxn {
  mood: string;
  category: string | null;
  weekday: number; // 0-6 (0=domingo)
  amount: number;
}

export interface CorrelationRow {
  mood: string;
  category: string;
  count: number;
  total: number;
  avg: number;
  sufficient: boolean;
}

export function correlateByMoodCategory(txns: EmotionTxn[]): CorrelationRow[] {
  const buckets = new Map<string, { count: number; total: number }>();
  for (const t of txns) {
    if (!t.mood || !t.category) continue;
    const k = `${t.mood}::${t.category}`;
    const b = buckets.get(k) ?? { count: 0, total: 0 };
    b.count += 1;
    b.total += t.amount;
    buckets.set(k, b);
  }
  const out: CorrelationRow[] = [];
  for (const [k, v] of buckets.entries()) {
    const [mood, category] = k.split("::");
    out.push({
      mood,
      category,
      count: v.count,
      total: v.total,
      avg: v.count > 0 ? v.total / v.count : 0,
      sufficient: v.count >= MIN_SAMPLE,
    });
  }
  return out.sort((a, b) => b.total - a.total);
}
