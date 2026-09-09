// NarrativeMemory (`nino_narrative.v1`)
//
// Contexto declarado pelo próprio usuário ("estou viajando", "é do trabalho"),
// com validade. Enquanto vale, as leituras reconhecem o contexto; depois de
// expirar, ele deixa de explicar gasto. Usa a tabela `agent_memory` existente —
// nenhuma segunda fonte de verdade.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const NARRATIVE_CONTEXT_KIND = "narrative_context";

export type NarrativeContextEntry = {
  subject_key: string;
  statement: string;
  confidence: number;
  expires_at: string | null;
  source: string;
};

export function isActiveContext(entry: { expires_at?: string | null }, now = new Date()): boolean {
  if (!entry.expires_at) return true;
  const at = new Date(entry.expires_at);
  return Number.isFinite(at.getTime()) ? at.getTime() > now.getTime() : true;
}

/** Contextos vigentes do usuário para um assunto (e os globais). */
export async function loadNarrativeContext(
  sb: SupabaseClient,
  userId: string,
  subjectKey?: string,
): Promise<NarrativeContextEntry[]> {
  try {
    const { data } = await sb.from("agent_memory")
      .select("key,value,confidence,expires_at,source")
      .eq("user_id", userId)
      .eq("kind", NARRATIVE_CONTEXT_KIND)
      .order("last_used_at", { ascending: false })
      .limit(20);
    const rows = (Array.isArray(data) ? data : []) as any[];
    return rows
      .filter((row) => isActiveContext(row))
      .map((row) => ({
        subject_key: String(row.key ?? "global"),
        statement: String((row.value as any)?.statement ?? (row.value as any)?.text ?? "").trim(),
        confidence: Number(row.confidence ?? 0.6),
        expires_at: row.expires_at ?? null,
        source: String(row.source ?? "user_reply"),
      }))
      .filter((entry) => entry.statement.length > 0)
      .filter((entry) => !subjectKey || entry.subject_key === "global" || entry.subject_key === subjectKey);
  } catch {
    return [];
  }
}

/** Grava o contexto com validade explícita. Sem regra permanente escondida. */
export async function rememberNarrativeContext(
  sb: SupabaseClient,
  userId: string,
  entry: { subjectKey: string; statement: string; validDays: number; confidence?: number; source?: string },
): Promise<void> {
  const expires = new Date(Date.now() + Math.max(1, entry.validDays) * 86_400_000).toISOString();
  try {
    await sb.from("agent_memory").upsert({
      user_id: userId,
      kind: NARRATIVE_CONTEXT_KIND,
      key: entry.subjectKey,
      value: { statement: entry.statement.slice(0, 400) },
      confidence: Math.min(1, Math.max(0.1, entry.confidence ?? 0.7)),
      source: entry.source ?? "user_reply",
      expires_at: expires,
      last_used_at: new Date().toISOString(),
    }, { onConflict: "user_id,kind,key" });
  } catch (error) {
    console.warn("[narrative-memory] write_failed", String(error).slice(0, 200));
  }
}

const PLANNED_PATTERNS: Array<[RegExp, { statement: string; validDays: number }]> = [
  [/\b(estou|vou|fui) (viajar|viajando|de viagem)\b/i, { statement: "O usuário está em viagem neste período.", validDays: 21 }],
  [/\bfoi planejad/i, { statement: "O usuário informou que esse gasto foi planejado.", validDays: 45 }],
  [/\bé (do|de) trabalho\b|\breembols/i, { statement: "O usuário informou que esse gasto é de trabalho/reembolsável.", validDays: 90 }],
  [/\bé recorrente\b|\btodo mês\b/i, { statement: "O usuário informou que esse gasto é recorrente.", validDays: 180 }],
  [/\bfoi (uma )?(única|unica) vez\b|\bfoi pontual\b/i, { statement: "O usuário informou que esse gasto foi pontual.", validDays: 30 }],
];

/** Interpreta a resposta do usuário sem inventar contexto que ele não deu. */
export function contextFromReply(reply: string): { statement: string; validDays: number } | null {
  const text = String(reply ?? "");
  for (const [pattern, result] of PLANNED_PATTERNS) {
    if (pattern.test(text)) return result;
  }
  return null;
}
