// Additional deterministic proactive detectors.
// Kept separate so the canonical InsightsEngine remains the single orchestrator.

export type ProactiveTransaction = {
  id: string;
  amount: number;
  description?: string;
  occurred_at: string;
  type: string;
  movement_kind?: string;
};

export type ActivityWindow = {
  last_30_days: number;
  previous_30_days: number;
  days_since_last_activity: number | null;
  last_activity_at?: string | null;
};

export type ExtensionInsight = {
  id: string;
  kind: "engagement_drop" | "recurring_pattern";
  severity: "info" | "attention" | "critical";
  score: number;
  title: string;
  body: string;
  action?: { type: string; payload?: Record<string, unknown> };
  evidence: Record<string, unknown>;
  dedup_key: string;
};

function normalizeDescription(value: string | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b\d{2,}\b/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function detectEngagementDrop(activity?: ActivityWindow): ExtensionInsight[] {
  if (!activity) return [];
  const previous = Math.max(0, activity.previous_30_days);
  const current = Math.max(0, activity.last_30_days);
  const daysSince = activity.days_since_last_activity;

  if (previous < 4 || daysSince === null || daysSince < 7) return [];
  const ratio = current / Math.max(1, previous);
  if (ratio > 0.4) return [];

  return [{
    id: `engagement-drop:${activity.last_activity_at ?? "unknown"}`,
    kind: "engagement_drop",
    severity: daysSince >= 21 ? "attention" : "info",
    score: Math.min(1, 0.55 + daysSince / 60),
    title: "Seu acompanhamento financeiro perdeu ritmo",
    body: `Faz ${daysSince} dias que você não atualiza ou consulta seus dados. Uma revisão curta pode ajudar a retomar o controle.`,
    action: { type: "navigate", payload: { route: "/app" } },
    evidence: {
      activity_last_30_days: current,
      activity_previous_30_days: previous,
      days_since_last_activity: daysSince,
      last_activity_at: activity.last_activity_at ?? null,
      minimum_previous_activity: 4,
    },
    dedup_key: `engagement_drop:${activity.last_activity_at?.slice(0, 10) ?? "none"}`,
  }];
}

export function detectRecurringPattern(transactions: ProactiveTransaction[]): ExtensionInsight[] {
  const expenses = transactions
    .filter((row) =>
      row.type === "expense" &&
      row.movement_kind !== "transfer" &&
      Number(row.amount) > 0 &&
      Boolean(normalizeDescription(row.description)),
    )
    .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

  const groups = new Map<string, ProactiveTransaction[]>();
  for (const row of expenses) {
    const key = normalizeDescription(row.description);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const candidates: ExtensionInsight[] = [];
  for (const [description, rows] of groups) {
    if (rows.length < 3) continue;

    const dates = rows.map((row) => new Date(row.occurred_at).getTime()).filter(Number.isFinite);
    const intervals = dates.slice(1).map((date, index) =>
      Math.round((date - dates[index]) / 86_400_000),
    );
    const typicalInterval = median(intervals);
    if (typicalInterval < 20 || typicalInterval > 40) continue;

    const amounts = rows.map((row) => Number(row.amount) || 0);
    const typicalAmount = median(amounts);
    if (typicalAmount <= 0) continue;
    const maxDeviation = Math.max(...amounts.map((amount) =>
      Math.abs(amount - typicalAmount) / typicalAmount,
    ));
    if (maxDeviation > 0.35) continue;

    const last = rows[rows.length - 1];
    candidates.push({
      id: `recurring-pattern:${description}`,
      kind: "recurring_pattern",
      severity: "info",
      score: Math.min(0.95, 0.45 + rows.length * 0.08),
      title: `Parece que "${last.description ?? description}" se repete`,
      body: `Encontrei ${rows.length} ocorrências, normalmente a cada ${Math.round(typicalInterval)} dias. Você pode transformar isso em recorrência para facilitar o acompanhamento.`,
      action: { type: "navigate", payload: { route: "/app/recorrencias" } },
      evidence: {
        occurrences: rows.length,
        typical_interval_days: typicalInterval,
        typical_amount: typicalAmount,
        maximum_amount_deviation: Number(maxDeviation.toFixed(3)),
        first_occurrence: rows[0].occurred_at,
        last_occurrence: last.occurred_at,
      },
      dedup_key: `recurring_pattern:${description}`,
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}
