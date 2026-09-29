// deno-lint-ignore-file no-explicit-any
// nino_priority_feed.v1 — "o que importa agora" em UMA fila por usuário.
// ======================================================================
// O pipeline proativo já decide o que interrompe (orçamento de atenção por
// canal). A fila de prioridades é a mesma ordem, sem o orçamento de
// interrupção: o que o app mostra, o que o chat responde em "o que importa?"
// e o que o WhatsApp envia saem do MESMO ranking, com as mesmas regras de
// qualidade do dado, relevância pessoal e aprendizado.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { FinancialSituation, MultiFinanceProactiveContext } from "./contracts.ts";
import { meetsSituationMateriality } from "./ranking.ts";

export const PRIORITY_FEED_VERSION = "nino_priority_feed.v1";
export const PRIORITY_FEED_LIMIT = 5;
/** A fila vale até a próxima rodada horária com folga; depois é considerada velha. */
export const PRIORITY_FEED_TTL_HOURS = 26;

export type PriorityFeedItem = {
  rank: number;
  fingerprint: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  route: string | null;
  impact_amount: number;
  priority_score: number;
  reasons: string[];
  evidence: Record<string, unknown>;
};

/**
 * Ordena e filtra pelas mesmas regras do alocador (aprendizado, materialidade,
 * confiança), com um assunto por tipo. Não aplica orçamento de canal nem janela
 * de repetição: isso decide interrupção, não relevância.
 */
export function buildPriorityFeed(
  ranked: FinancialSituation[],
  ctx: MultiFinanceProactiveContext,
  opts: { limit?: number; minConfidence?: number } = {},
): PriorityFeedItem[] {
  const limit = opts.limit ?? PRIORITY_FEED_LIMIT;
  const minConfidence = opts.minConfidence ?? 0.6;
  const kinds = new Set<string>();
  const out: PriorityFeedItem[] = [];
  const ordered = [...ranked].sort((a, b) => b.priority_score - a.priority_score);
  for (const situation of ordered) {
    if (out.length >= limit) break;
    if (situation.score_reasons.includes("muted_by_learning")) continue;
    if (situation.confidence < minConfidence) continue;
    if (!meetsSituationMateriality(situation, ctx)) continue;
    if (kinds.has(situation.communication_kind)) continue;
    kinds.add(situation.communication_kind);
    const evidence = (situation.evidence ?? {}) as Record<string, any>;
    out.push({
      rank: out.length + 1,
      fingerprint: situation.fingerprint,
      kind: situation.communication_kind,
      severity: situation.severity,
      title: situation.title,
      body: situation.body,
      route: situation.route,
      impact_amount: situation.impact_amount,
      priority_score: situation.priority_score,
      reasons: situation.score_reasons.slice(0, 12),
      // Evidência enxuta e auditável (o detalhe completo fica em proactive_situations).
      evidence: {
        situation_type: situation.type,
        domains: situation.domains,
        confidence: situation.confidence,
        days_until: situation.days_until,
        user_model: evidence.user_model ?? null,
        data_quality_blockers: evidence.data_quality_blockers ?? null,
        replaces: evidence.replaces ?? null,
      },
    });
  }
  return out;
}

/** Substitui a fila do usuário (idempotente por rodada). */
export async function writePriorityFeed(
  sb: SupabaseClient,
  userId: string,
  asOf: string,
  items: PriorityFeedItem[],
): Promise<void> {
  const { error: deleteError } = await sb.from("nino_priority_feed").delete().eq("user_id", userId);
  if (deleteError) throw new Error(`nino_priority_feed_delete:${deleteError.message}`);
  if (!items.length) return;
  const validUntil = new Date(Date.now() + PRIORITY_FEED_TTL_HOURS * 3_600_000).toISOString();
  const { error } = await sb.from("nino_priority_feed").insert(items.map((item) => ({
    user_id: userId,
    rank: item.rank,
    fingerprint: item.fingerprint,
    kind: item.kind,
    severity: item.severity,
    title: item.title,
    body: item.body,
    route: item.route,
    impact_amount: item.impact_amount,
    priority_score: item.priority_score,
    reasons: item.reasons,
    evidence: item.evidence,
    as_of: asOf,
    version: PRIORITY_FEED_VERSION,
    valid_until: validUntil,
  })));
  if (error) throw new Error(`nino_priority_feed_insert:${error.message}`);
}

/** Leitura para chat/app: só a fila vigente, em ordem. */
export async function readPriorityFeed(
  sb: SupabaseClient,
  userId: string,
  limit = 3,
): Promise<Array<PriorityFeedItem & { as_of: string; computed_at: string }>> {
  const { data, error } = await sb.from("nino_priority_feed")
    .select("rank,fingerprint,kind,severity,title,body,route,impact_amount,priority_score,reasons,evidence,as_of,computed_at")
    .eq("user_id", userId)
    .gt("valid_until", new Date().toISOString())
    .order("rank", { ascending: true })
    .limit(Math.max(1, Math.min(PRIORITY_FEED_LIMIT, limit)));
  if (error) throw new Error(`nino_priority_feed_read:${error.message}`);
  return ((data as any[]) ?? []).map((row) => ({
    ...row,
    impact_amount: Number(row.impact_amount ?? 0),
    priority_score: Number(row.priority_score ?? 0),
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
    evidence: (row.evidence ?? {}) as Record<string, unknown>,
  }));
}
