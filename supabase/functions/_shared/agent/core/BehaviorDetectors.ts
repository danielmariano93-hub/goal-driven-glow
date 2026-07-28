// Explainable, non-diagnostic behavioral hypotheses.
// All detectors require minimum samples and return evidence for user confirmation.

export type BehaviorTransaction = {
  id: string;
  amount: number;
  description?: string | null;
  occurred_at: string;
  type: string;
  movement_kind?: string | null;
};

export type EmotionalCheckin = {
  occurred_at: string;
  mood: number;
  trigger_label?: string | null;
};

export type RecurringOccurrence = {
  id: string;
  due_date: string;
  status: string;
  amount?: number;
  description?: string;
};

export type BehaviorHypothesisKind =
  | "emotional_spending"
  | "impulsive_spending"
  | "financial_procrastination"
  | "financial_discipline"
  | "relapse_risk";

export type BehaviorHypothesisCandidate = {
  kind: BehaviorHypothesisKind;
  title: string;
  explanation: string;
  confidence: number;
  evidence: Record<string, unknown>;
  dedup_key: string;
  expires_at: string;
};

export type BehaviorDetectorInput = {
  transactions: BehaviorTransaction[];
  checkins: EmotionalCheckin[];
  recurring: RecurringOccurrence[];
  now?: Date;
};

const DAY = 86_400_000;

function dayKey(value: string): string {
  return String(value).slice(0, 10);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function expiry(now: Date, days = 60): string {
  return new Date(now.getTime() + days * DAY).toISOString();
}

function expenses(input: BehaviorDetectorInput): BehaviorTransaction[] {
  return input.transactions.filter((row) =>
    row.type === "expense" &&
    (row.movement_kind ?? "transaction") === "transaction" &&
    Number(row.amount) > 0,
  );
}

export function detectEmotionalSpending(input: BehaviorDetectorInput): BehaviorHypothesisCandidate[] {
  const now = input.now ?? new Date();
  const checkinByDay = new Map<string, EmotionalCheckin>();
  for (const checkin of input.checkins) {
    const key = dayKey(checkin.occurred_at);
    if (!checkinByDay.has(key)) checkinByDay.set(key, checkin);
  }

  const totals = new Map<string, number>();
  for (const row of expenses(input)) {
    const key = dayKey(row.occurred_at);
    totals.set(key, (totals.get(key) ?? 0) + Number(row.amount));
  }

  const paired = [...totals.entries()]
    .map(([day, total]) => ({ day, total, checkin: checkinByDay.get(day) }))
    .filter((item): item is { day: string; total: number; checkin: EmotionalCheckin } => Boolean(item.checkin));

  const low = paired.filter((item) => Number(item.checkin.mood) <= 2);
  const baseline = paired.filter((item) => Number(item.checkin.mood) >= 3);
  if (low.length < 3 || baseline.length < 3 || paired.length < 8) return [];

  const lowAverage = low.reduce((sum, item) => sum + item.total, 0) / low.length;
  const baselineAverage = baseline.reduce((sum, item) => sum + item.total, 0) / baseline.length;
  if (baselineAverage <= 0 || lowAverage < baselineAverage * 1.25) return [];

  const delta = lowAverage / baselineAverage - 1;
  return [{
    kind: "emotional_spending",
    title: "Pode existir uma relação entre dias difíceis e gastos maiores",
    explanation: `Nos dias com humor financeiro baixo, seu gasto médio foi ${Math.round(delta * 100)}% maior do que nos demais dias. Isso é uma hipótese estatística, não um diagnóstico.`,
    confidence: Math.min(0.9, 0.55 + paired.length / 50 + Math.min(delta, 1) * 0.15),
    evidence: {
      paired_days: paired.length,
      low_mood_days: low.length,
      comparison_days: baseline.length,
      low_mood_average: Number(lowAverage.toFixed(2)),
      comparison_average: Number(baselineAverage.toFixed(2)),
      difference_pct: Number((delta * 100).toFixed(1)),
      minimum_sample: 8,
    },
    dedup_key: `emotional_spending:${now.toISOString().slice(0, 7)}`,
    expires_at: expiry(now),
  }];
}

export function detectImpulsiveSpending(input: BehaviorDetectorInput): BehaviorHypothesisCandidate[] {
  const now = input.now ?? new Date();
  const rows = expenses(input);
  if (rows.length < 20) return [];

  const byDay = new Map<string, BehaviorTransaction[]>();
  for (const row of rows) {
    const key = dayKey(row.occurred_at);
    const list = byDay.get(key) ?? [];
    list.push(row);
    byDay.set(key, list);
  }

  const dailyTotals = [...byDay.values()].map((items) =>
    items.reduce((sum, row) => sum + Number(row.amount), 0),
  );
  const typicalDaily = median(dailyTotals);
  if (typicalDaily <= 0) return [];

  const burstDays = [...byDay.entries()].filter(([, items]) => {
    const total = items.reduce((sum, row) => sum + Number(row.amount), 0);
    return items.length >= 3 && total >= typicalDaily * 1.5;
  });
  if (burstDays.length < 3) return [];

  return [{
    kind: "impulsive_spending",
    title: "Há sinais de gastos concentrados em poucos momentos",
    explanation: `Em ${burstDays.length} dias você fez três ou mais gastos e superou o seu dia típico. Isso também pode acontecer por contas fixas, viagens, eventos ou registros feitos em lote; confirme quais dias foram realmente não planejados.`,
    confidence: Math.min(0.78, 0.48 + Math.min(burstDays.length, 5) * 0.035 + Math.min(rows.length, 120) / 1200),
    evidence: {
      transaction_sample: rows.length,
      observed_days: byDay.size,
      burst_days: burstDays.length,
      typical_daily_spend: Number(typicalDaily.toFixed(2)),
      burst_day_examples: burstDays.slice(-5).map(([day, items]) => ({
        day,
        count: items.length,
        total: Number(items.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(2)),
      })),
      minimum_transactions: 20,
    },
    dedup_key: `impulsive_spending:${now.toISOString().slice(0, 7)}`,
    expires_at: expiry(now),
  }];
}

export function detectFinancialProcrastination(input: BehaviorDetectorInput): BehaviorHypothesisCandidate[] {
  const now = input.now ?? new Date();
  const overdue = input.recurring.filter((item) =>
    item.status !== "paid" &&
    new Date(`${dayKey(item.due_date)}T12:00:00Z`).getTime() < now.getTime() - DAY,
  );
  if (overdue.length < 2) return [];

  return [{
    kind: "financial_procrastination",
    title: "Alguns compromissos estão ficando para depois",
    explanation: `Encontrei ${overdue.length} ocorrências vencidas sem confirmação de pagamento. Isso pode indicar apenas falta de atualização; confirme para o Nino ajustar o acompanhamento.`,
    confidence: Math.min(0.86, 0.55 + overdue.length * 0.07),
    evidence: {
      overdue_count: overdue.length,
      examples: overdue.slice(0, 5).map((item) => ({
        due_date: item.due_date,
        description: item.description ?? "Compromisso",
        amount: Number(item.amount ?? 0),
      })),
      minimum_overdue_count: 2,
    },
    dedup_key: `financial_procrastination:${now.toISOString().slice(0, 7)}`,
    expires_at: expiry(now, 45),
  }];
}

export function detectFinancialDiscipline(input: BehaviorDetectorInput): BehaviorHypothesisCandidate[] {
  const now = input.now ?? new Date();
  const rows = input.transactions.filter((row) => ["income", "expense"].includes(row.type));
  if (rows.length < 25) return [];

  const weekly = new Map<string, { income: number; expense: number }>();
  for (const row of rows) {
    const date = new Date(row.occurred_at);
    const monday = new Date(date);
    const day = (monday.getUTCDay() + 6) % 7;
    monday.setUTCDate(monday.getUTCDate() - day);
    const key = monday.toISOString().slice(0, 10);
    const item = weekly.get(key) ?? { income: 0, expense: 0 };
    if (row.type === "income") item.income += Number(row.amount);
    if (row.type === "expense" && (row.movement_kind ?? "transaction") === "transaction") item.expense += Number(row.amount);
    weekly.set(key, item);
  }

  const observed = [...weekly.values()].filter((item) => item.income > 0 || item.expense > 0);
  if (observed.length < 8) return [];
  const balanced = observed.filter((item) => item.income >= item.expense).length;
  const ratio = balanced / observed.length;
  if (ratio < 0.75) return [];

  return [{
    kind: "financial_discipline",
    title: "Você vem mantendo uma rotina financeira consistente",
    explanation: `Em ${balanced} de ${observed.length} semanas observadas, as entradas cobriram os gastos registrados. O padrão é positivo, considerando apenas os dados que estão no app.`,
    confidence: Math.min(0.92, 0.58 + observed.length / 40 + ratio * 0.12),
    evidence: {
      observed_weeks: observed.length,
      balanced_weeks: balanced,
      balanced_ratio: Number(ratio.toFixed(3)),
      transaction_sample: rows.length,
      minimum_weeks: 8,
    },
    dedup_key: `financial_discipline:${now.toISOString().slice(0, 7)}`,
    expires_at: expiry(now, 75),
  }];
}

export function detectRelapseRisk(input: BehaviorDetectorInput): BehaviorHypothesisCandidate[] {
  const now = input.now ?? new Date();
  const rows = expenses(input).filter((row) =>
    now.getTime() - new Date(row.occurred_at).getTime() <= 60 * DAY,
  );
  if (rows.length < 30) return [];

  const recentStart = now.getTime() - 14 * DAY;
  const previousStart = now.getTime() - 56 * DAY;
  const recent = rows.filter((row) => new Date(row.occurred_at).getTime() >= recentStart);
  const previous = rows.filter((row) => {
    const time = new Date(row.occurred_at).getTime();
    return time >= previousStart && time < recentStart;
  });
  if (recent.length < 7 || previous.length < 18) return [];

  const recentDaily = recent.reduce((sum, row) => sum + Number(row.amount), 0) / 14;
  const previousDaily = previous.reduce((sum, row) => sum + Number(row.amount), 0) / 42;
  if (previousDaily <= 0 || recentDaily < previousDaily * 1.35) return [];

  const delta = recentDaily / previousDaily - 1;
  return [{
    kind: "relapse_risk",
    title: "Seus gastos aceleraram nas últimas duas semanas",
    explanation: `A média diária recente ficou ${Math.round(delta * 100)}% acima das seis semanas anteriores. Isso pode ser sazonal; confirme se representa uma mudança de hábito.`,
    confidence: Math.min(0.9, 0.56 + Math.min(delta, 1) * 0.2 + rows.length / 300),
    evidence: {
      recent_transactions: recent.length,
      previous_transactions: previous.length,
      recent_daily_average: Number(recentDaily.toFixed(2)),
      previous_daily_average: Number(previousDaily.toFixed(2)),
      difference_pct: Number((delta * 100).toFixed(1)),
      recent_window_days: 14,
      comparison_window_days: 42,
    },
    dedup_key: `relapse_risk:${now.toISOString().slice(0, 10)}`,
    expires_at: expiry(now, 45),
  }];
}

export function runBehaviorDetectors(input: BehaviorDetectorInput): BehaviorHypothesisCandidate[] {
  return [
    ...detectEmotionalSpending(input),
    ...detectImpulsiveSpending(input),
    ...detectFinancialProcrastination(input),
    ...detectFinancialDiscipline(input),
    ...detectRelapseRisk(input),
  ]
    .filter((candidate) => candidate.confidence >= 0.6)
    .sort((a, b) => b.confidence - a.confidence);
}
