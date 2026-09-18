import { describe, expect, it } from "vitest";
import {
  looksContextDependentFollowup,
  resolveConversation,
} from "../../supabase/functions/_shared/agent/core/ConversationResolver";

const NOW = new Date("2026-09-18T15:00:00Z");

const active = {
  id: "active-old-topic",
  user_id: "u1",
  conversation_id: "c1",
  subject: "read",
  title: "Resumo de gastos de agosto",
  summary: null,
  status: "answered" as const,
  keywords: ["agosto", "gastos"],
  entities: [],
  acts: [],
  period_from: "2026-08-01",
  period_to: "2026-08-31",
  original_query: "Quanto gastei em agosto?",
  last_query: "E quais foram os maiores gastos?",
  evidence_reference: null,
  execution_summary: null,
  turn_count: 4,
  opened_at: "2026-09-18T13:00:00Z",
  last_activity_at: "2026-09-18T14:00:00Z",
};

const septemberCategories = {
  ...active,
  id: "september-categories",
  title: "Categorias de setembro",
  keywords: ["categorias", "setembro", "gastos"],
  original_query: "Quais categorias mais gastei em setembro?",
  last_query: "Quais categorias mais gastei em setembro?",
  period_from: "2026-09-01",
  period_to: "2026-09-18",
  last_activity_at: "2026-09-18T14:30:00Z",
};

describe("topic continuity guard", () => {
  it("não classifica palavra interrogativa standalone como follow-up contextual", () => {
    expect(looksContextDependentFollowup("Quais categorias mais gastei em setembro?")).toBe(false);
    expect(looksContextDependentFollowup("Como estão minhas metas?")).toBe(false);
  });

  it("mantém anáforas reais no tópico ativo", () => {
    expect(looksContextDependentFollowup("Esses valores são médias ou totais?")).toBe(true);
    expect(looksContextDependentFollowup("Qual delas ficou mais acima?")).toBe(true);
    expect(looksContextDependentFollowup("E comparado ao mês passado?")).toBe(true);
  });

  it("uma pergunta standalone pode selecionar outro tópico em vez de ser forçada ao ativo", () => {
    const out = resolveConversation({
      text: "Quais categorias mais gastei em setembro?",
      active_topic_id: active.id,
      topics: [active, septemberCategories] as any,
      now: NOW,
    });
    expect(out.topic_id).toBe(septemberCategories.id);
    expect(out.source).not.toBe("active_topic");
  });
});
