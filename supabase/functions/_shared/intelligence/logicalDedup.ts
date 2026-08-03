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
