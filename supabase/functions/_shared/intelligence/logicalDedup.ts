// comms_contract.v2 — chave lógica única de comunicação.
//
// `dedup_key` identifica a *superfície* (notificação, entrega, sugestão) e pode
// variar por canal. `logical_dedup_key` identifica o *assunto* comunicado, de
// modo que revisão semanal, relatório inteligente e sugestão proativa do mesmo
// período nunca sejam comunicados duas vezes por caminhos diferentes.

export type ReviewPeriodKind = "weekly" | "monthly";

/** Assunto único de fechamento de período (revisão + relatório inteligente). */
export function periodReviewKey(
  kind: ReviewPeriodKind,
  userId: string,
  periodStart: string,
): string {
  return `${kind}_review:${userId}:${periodStart}`;
}

/** Assunto único de um insight determinístico do catálogo. */
export function insightLogicalKey(
  userId: string,
  family: string,
  dedupKey: string,
): string {
  return `insight:${userId}:${family}:${dedupKey}`;
}

/**
 * Assunto único de uma sugestão proativa. Revisões de período colapsam na
 * mesma chave do relatório para não duplicar a comunicação.
 */
export function suggestionLogicalKey(userId: string, dedupKey: string): string {
  const review = /^advisor_review:(weekly|monthly):(.+)$/.exec(dedupKey);
  if (review) {
    return periodReviewKey(review[1] as ReviewPeriodKind, userId, review[2]);
  }
  return `proactive:${userId}:${dedupKey}`;
}

/**
 * Identidade de domínio de uma comunicação. IDs de situação/item/sugestão não
 * podem criar assuntos diferentes para a mesma meta e o mesmo ciclo.
 */
export function communicationTopicKey(args: {
  userId: string;
  kind: string;
  dedupKey: string;
  evidence?: Record<string, unknown> | null;
}): string {
  const evidence = args.evidence ?? {};
  const goalId = typeof evidence.goal_id === "string" ? evidence.goal_id : null;
  const periodStart = typeof evidence.period_start === "string"
    ? evidence.period_start.slice(0, 10)
    : null;
  const explicit = typeof evidence.logical_topic_key === "string"
    ? evidence.logical_topic_key
    : null;
  const legacyCategoryGoal = explicit?.match(/^situation:category_goal(?:_breach)?:([^:]+):(\d{4}-\d{2}-\d{2})/);
  if (legacyCategoryGoal) {
    return `category_goal:${args.userId}:${legacyCategoryGoal[1]}:${legacyCategoryGoal[2]}`;
  }
  if (goalId && periodStart && (
    evidence.goal_kind === "category_spending"
    || explicit?.includes("category_goal")
  )) {
    return `category_goal:${args.userId}:${goalId}:${periodStart}`;
  }
  return explicit
    ? `topic:${args.userId}:${explicit}`
    : suggestionLogicalKey(args.userId, args.dedupKey);
}
