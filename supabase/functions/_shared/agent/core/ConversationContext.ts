// ConversationContext (nino_conversation_context.v1)
//
// Compact, bounded context for the Conversation Brain. It carries relationship
// memory and durable topic continuity, never live financial truth.
import type { MemoryFact } from "./MemoryStore.ts";
import type { Preferences } from "./PersonalizationEngine.ts";
import type { ResolverOutput } from "./ConversationResolver.ts";

function compact(value: unknown, max = 220): string {
  let text = "";
  try { text = typeof value === "string" ? value : JSON.stringify(value); }
  catch { text = String(value ?? ""); }
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function safeMemoryValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const k = key.toLowerCase();
    if (/(^|_)(amount|valor|saldo|balance|total|fatura|invoice|patrimonio|net_worth|debt|divida|receita|income|gasto|spent|forecast|projection)(_|$)/.test(k)) {
      continue;
    }
    out[key] = raw && typeof raw === "object" && !Array.isArray(raw)
      ? safeMemoryValue(raw)
      : raw;
  }
  return out;
}

export function buildConversationUserContext(args: {
  preferences?: Preferences | null;
  memories?: MemoryFact[] | null;
  topic?: ResolverOutput | null;
}): string {
  const lines: string[] = [];

  const p = args.preferences;
  if (p) {
    lines.push(
      `Preferências de resposta: tom=${p.tone}; verbosidade=${p.verbosity}; ` +
      `explicação=${p.explanation_style}; sugestões=${p.suggestion_frequency}; nível=${p.technical_level}.`,
    );
  }

  const memories = (args.memories ?? [])
    .filter((m) => m && (m.source === "user" || m.source === "correction" || Number(m.confidence ?? 0) >= 0.65))
    .slice(0, 10);
  if (memories.length) {
    const facts = memories.map((m) =>
      `${m.kind}:${m.key}=${compact(safeMemoryValue(m.value), 180)}`
    );
    lines.push(`Memórias relacionais confiáveis (não são verdade financeira ao vivo): ${facts.join(" | ")}`);
  }

  const topic = args.topic;
  if (topic?.clarification_required) {
    const options = topic.clarification_options.map((v) => compact(v, 100)).filter(Boolean).slice(0, 3);
    if (options.length) {
      lines.push(`TopicResolution=ambiguous; opções de assunto: ${options.join(" | ")}. Se a mensagem depender de contexto anterior, esclareça antes de assumir.`);
    }
  } else if (topic?.topic) {
    const t = topic.topic;
    lines.push(
      `Tópico durável relevante: id=${t.id}; assunto=${compact(t.subject, 100)}; ` +
      `última_pergunta=${compact(t.last_query, 220)}; resumo=${compact(t.summary, 180) || "—"}; ` +
      `período=${t.period_from ?? "—"}..${t.period_to ?? "—"}.`,
    );
  }

  return lines.join("\n").slice(0, 3600);
}
