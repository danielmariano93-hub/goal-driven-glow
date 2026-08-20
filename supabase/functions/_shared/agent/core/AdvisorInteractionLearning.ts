// advisor_learning.v1 — captura de sinais de interesse no runtime do agente.
// Vale para App e WhatsApp: a escrita passa pela RPC de serviço, então não
// depende de sessão do usuário.
//
// Regras duras:
//  - Exposição espontânea do Nino NUNCA gera interesse (delta 0, só auditoria).
//  - Sem tópico identificável, nada é aprendido.
//  - Preferência ordena; nunca suprime risco material (isso é do ranking).
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  resolveAdvisorTopicKey,
  detectPreferredComparisonMode,
  type AdvisorSignal,
  type TopicResolutionInput,
} from "../../finance-core/advisorTopics.ts";
import { remember } from "./MemoryStore.ts";

export type AdvisorSignalSource = "app" | "whatsapp" | "simulator" | "proactive" | "report";

export type RegisterAdvisorSignalInput = {
  user_id: string;
  signal: AdvisorSignal;
  source: AdvisorSignalSource;
  topic?: TopicResolutionInput;
  topic_key?: string | null;
  refs?: Record<string, unknown>;
};

export async function registerAdvisorSignal(
  sb: SupabaseClient,
  input: RegisterAdvisorSignalInput,
): Promise<string | null> {
  const topicKey = input.topic_key
    ?? (input.topic ? resolveAdvisorTopicKey(input.topic) : null);
  if (!topicKey) return null;
  try {
    await sb.rpc("advisor_register_topic_signal_v2", {
      _topic_key: topicKey,
      _signal: input.signal,
      _user_id: input.user_id,
      _source: input.source,
      _refs: input.refs ?? {},
    });
    return topicKey;
  } catch (e) {
    console.error("[advisor-learning]", String((e as Error).message).slice(0, 200));
    return null;
  }
}

const EXPLICIT_POSITIVE_RX = /\b(muito\s+[úu]til|isso\s+ajuda|adorei|gostei\s+disso|perfeito,?\s+era\s+isso|continua\s+me\s+avisando|manda\s+mais)\b/i;
const EXPLICIT_NEGATIVE_RX = /\b(n[ãa]o\s+(?:[ée]\s+)?[úu]til|n[ãa]o\s+quero\s+(?:receber|saber)|para\s+de\s+falar\s+disso|pare\s+de\s+falar|chega\s+disso|desnecess[áa]rio)\b/i;

/** Sinal explícito de feedback no texto do usuário, se houver. */
export function detectExplicitFeedback(text: string): AdvisorSignal | null {
  const t = String(text ?? "");
  if (EXPLICIT_NEGATIVE_RX.test(t)) return "marked_not_useful";
  if (EXPLICIT_POSITIVE_RX.test(t)) return "explicit_positive";
  return null;
}

const MUTATION_TOOLS = /^(create_|confirm_|pay_|register_|apply_)/;

export type TurnLearningInput = {
  user_id: string;
  source: AdvisorSignalSource;
  user_text: string;
  capability?: string | null;
  /** Categoria/merchant efetivamente resolvidos no turno. */
  category?: string | null;
  merchant?: string | null;
  /** Tópico do turno anterior — base para detectar follow-up. */
  previous_topic_key?: string | null;
  tool_calls?: Array<{ tool_name: string; ok: boolean }>;
  /** Continuação aceita ("ok" reexecutando oferta analítica). */
  continuation_accepted?: boolean;
  refs?: Record<string, unknown>;
};

/**
 * Aprende com o que o turno realmente fez. Retorna o tópico registrado (ou
 * null). Best-effort: nunca lança.
 */
export async function learnAdvisorInterest(
  sb: SupabaseClient,
  input: TurnLearningInput,
): Promise<string | null> {
  try {
    const okTools = (input.tool_calls ?? []).filter((c) => c.ok);
    const lastTool = okTools.length ? okTools[okTools.length - 1].tool_name : null;
    const topicKey = resolveAdvisorTopicKey({
      category: input.category ?? null,
      merchant: input.merchant ?? null,
      capability: input.capability ?? null,
      tool_name: lastTool,
      text: input.user_text,
    });
    if (!topicKey) return null;

    const explicit = detectExplicitFeedback(input.user_text);
    const acted = okTools.some((c) => MUTATION_TOOLS.test(c.tool_name));
    const isFollowUp = Boolean(input.previous_topic_key && input.previous_topic_key === topicKey);

    const signal: AdvisorSignal = explicit
      ?? (acted ? "acted"
        : input.continuation_accepted ? "asked_more"
        : isFollowUp ? "followed_up"
        : okTools.length ? "opened"
        : "exposed");

    await registerAdvisorSignal(sb, {
      user_id: input.user_id,
      signal,
      source: input.source,
      topic_key: topicKey,
      refs: {
        capability: input.capability ?? null,
        tool: lastTool,
        follow_up: isFollowUp,
        explicit_feedback: explicit,
        ...(input.refs ?? {}),
      },
    });

    await learnComparisonPreference(sb, input.user_id, input.user_text);
    return topicKey;
  } catch (e) {
    console.error("[advisor-learning:turn]", String((e as Error).message).slice(0, 200));
    return null;
  }
}

/**
 * Recorte de comparação pedido pelo usuário vira preferência aprendida.
 * Guardado em `agent_memory` (kind `advisor_preference`), por frequência e
 * recência: `remember` já reforça confiança em repetição.
 */
export async function learnComparisonPreference(
  sb: SupabaseClient,
  user_id: string,
  text: string,
): Promise<void> {
  const mode = detectPreferredComparisonMode(text);
  if (!mode) return;
  await remember(sb, {
    user_id,
    kind: "advisor_preference",
    key: mode,
    value: { preferred_comparison_mode: mode, last_text: String(text).slice(0, 200) },
    source: "user",
    confidence: 0.9,
  });
}

/** Lê a comparação preferida (mais recente e com mais evidência). */
export async function loadPreferredComparisonMode(
  sb: SupabaseClient,
  user_id: string,
): Promise<string | null> {
  try {
    const { data } = await sb.from("agent_memory")
      .select("key,use_count,confidence,updated_at")
      .eq("user_id", user_id)
      .eq("kind", "advisor_preference")
      .order("updated_at", { ascending: false })
      .limit(5);
    const rows = (data as any[]) ?? [];
    if (!rows.length) return null;
    rows.sort((a, b) => (Number(b.use_count ?? 0) - Number(a.use_count ?? 0))
      || String(b.updated_at).localeCompare(String(a.updated_at)));
    return String(rows[0].key);
  } catch {
    return null;
  }
}

// advisor_learning.v1
