import { describe, expect, it } from "vitest";
import { resolveTopicForTurn, upsertTopic, topicIsFresh } from "../../supabase/functions/_shared/agent/core/ConversationTopicState";

const NOW = Date.parse("2026-11-06T12:00:00Z");
function stateWith(updated_at: string) {
  const empty = { version: "nino_topic_state.v1", active_topic_id: null, topics: [] } as any;
  return upsertTopic(empty, {
    topic_id: "old", subject: "mercado", original_query: "quanto gastei no mercado", last_query: "quanto gastei no mercado",
    acts: ["new_query"], period: null, entities: ["Mercado"], ir: null, execution_summary: null,
    evidence_reference: null, pending_clarification: null, status: "open", updated_at,
  } as any, true);
}

describe("tópico antigo não vence a última mensagem", () => {
  it("elipse logo depois continua o tópico", () => {
    const r = resolveTopicForTurn({ state: stateWith("2026-11-06T11:30:00Z"), text: "e por quê?", acts: ["followup"], now_ms: NOW });
    expect(r.topic.topic_id).toBe("old");
    expect(r.created).toBe(false);
  });
  it("elipse um dia depois NÃO herda o tópico de ontem", () => {
    const r = resolveTopicForTurn({ state: stateWith("2026-11-05T11:30:00Z"), text: "e por quê?", acts: ["followup"], now_ms: NOW });
    expect(r.topic.topic_id).not.toBe("old");
    expect(r.created).toBe(true);
  });
  it("retomada explícita continua funcionando com tópico antigo", () => {
    const r = resolveTopicForTurn({ state: stateWith("2026-11-05T11:30:00Z"), text: "voltando ao assunto do mercado", acts: ["new_query"], now_ms: NOW });
    expect(r.resumed_topic_id === "old" || r.topic.topic_id === "old").toBe(true);
  });
  it("sem data válida mantém o comportamento anterior", () => {
    expect(topicIsFresh(undefined, NOW)).toBe(true);
    expect(topicIsFresh("lixo", NOW)).toBe(true);
  });
});
