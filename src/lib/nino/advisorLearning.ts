// advisor_learning.v1 (cliente) — espelho da mesma tabela de pesos usada no
// runtime do agente. Toda superfície do app (Home, relatórios, insights, CTAs)
// registra interesse por aqui: uma porta só, com auditoria no banco.
import { supabase } from "@/integrations/supabase/client";

export type AdvisorSignal =
  | "exposed"
  | "opened"
  | "followed_up"
  | "asked_more"
  | "acted"
  | "explicit_positive"
  | "ignored"
  | "dismissed"
  | "marked_not_useful";

/** Pesos idênticos aos da RPC `advisor_register_topic_signal_v2`. */
export const ADVISOR_SIGNAL_WEIGHTS: Record<AdvisorSignal, number> = {
  explicit_positive: 0.35,
  acted: 0.3,
  asked_more: 0.2,
  followed_up: 0.2,
  opened: 0.08,
  exposed: 0,
  ignored: -0.03,
  dismissed: -0.2,
  marked_not_useful: -0.35,
};

/** Movimento máximo (soma de |delta|) por tópico por dia. */
export const ADVISOR_DAILY_MOVEMENT_CAP = 0.35;

export type AdvisorSignalSource = "app" | "report" | "insight" | "goal" | "proactive";

/**
 * Registra um sinal de interesse. `exposed` é auditado com delta 0: o Nino
 * mostrar algo espontaneamente não significa que o usuário se interessou.
 */
export async function registerAdvisorSignal(params: {
  topicKey: string;
  signal: AdvisorSignal;
  source?: AdvisorSignalSource;
  refs?: Record<string, unknown>;
}): Promise<void> {
  const topicKey = String(params.topicKey ?? "").trim();
  if (!topicKey) return;
  try {
    await supabase.rpc("advisor_register_topic_signal_v2", {
      _topic_key: topicKey,
      _signal: params.signal,
      _source: params.source ?? "app",
      _refs: (params.refs ?? {}) as never,
    });
  } catch {
    // Aprendizado é best-effort: nunca quebra a tela do usuário.
  }
}

/** Tópico canônico de uma categoria (mesma forma usada no backend). */
export function categoryTopicKey(category: string): string {
  const slug = String(category ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `performance:category:${slug}`;
}
