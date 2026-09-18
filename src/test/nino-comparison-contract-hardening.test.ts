import { describe, expect, it } from "vitest";
import {
  resolvePeriodPt,
  resolveTimeAspectPt,
} from "../../supabase/functions/_shared/analytics/periodResolver";
import { resolveMultiPeriodsPt } from "../../supabase/functions/_shared/analytics/multiPeriodResolver";
import { resolveGroundedComparisonFollowup } from "../../supabase/functions/_shared/agent/core/GroundedComparisonFollowup";
import {
  advanceReferences,
  resolveStructuredReference,
} from "../../supabase/functions/_shared/agent/core/ConversationReferenceStore";
import { resolveConversation } from "../../supabase/functions/_shared/agent/core/ConversationResolver";
import { resolveNarrowDeterministicTurn } from "../../supabase/functions/_shared/agent/core/NarrowDeterministicGate";

const NOW = new Date("2026-09-18T15:00:00Z");

function comparisonMemory(summary = "Quais categorias de setembro ficaram acima da média dos últimos 3 meses?") {
  return {
    session_id: "s1",
    current_topic: "read",
    active_topic_id: "topic-current",
    previous_intent: "read",
    active_category: null,
    active_merchant: null,
    active_period: { from: "2026-09-01", to: "2026-09-18", label: "setembro até hoje" },
    comparison_period: null,
    pending_slots: [],
    awaiting: null,
    pending_conversation_action: null,
    conversation_summary: summary,
    references: [{
      id: "ref-prod-1809",
      type: "entity_set" as const,
      target: "category" as const,
      entity_labels: ["Moradia", "Dívidas e empréstimos", "Serviços"],
      topic_id: "topic-current",
      created_at: "2026-09-18T14:32:25.000Z",
      expires_at: "2026-09-18T16:02:25.000Z",
      turns_remaining: 1,
      status: "active" as const,
      source: {
        tool_name: "compare_to_monthly_average",
        query_id: "q1",
        run_id: "run-1",
        tool_call_ids: ["call-1"],
        context: {
          months: 3,
          target_period: { from: "2026-09-01", to: "2026-09-18", label: "setembro até hoje" },
          evidence: {
            kind: "comparison" as const,
            formula_version: "compare.monthly_mean.v3",
            requested_direction: "increase" as const,
            requested_limit: null,
            baseline_statistic: "mean",
            target_statistic: "aligned_period_amount",
            comparison_alignment: "aligned_month_to_date",
            baseline_window_months: 3,
            target_window_months: 1,
            total_a: 1000,
            total_b: 2000,
            delta_abs: 1000,
            delta_pct: 1,
            rows: [
              { name: "Moradia", total_a: 168.69, total_b: 5343.47, delta_abs: 5174.78, delta_pct: 30.6762 },
              { name: "Dívidas e empréstimos", total_a: 1897.09, total_b: 4200, delta_abs: 2302.91, delta_pct: 1.2139 },
              { name: "Serviços", total_a: 136.43, total_b: 137.75, delta_abs: 1.32, delta_pct: 0.0097 },
            ],
          },
        },
      },
    }],
  } as any;
}

describe("period_truth — janelas móveis em meses", () => {
  it("18/09 - últimos 3 meses começa em 18/06, não em 01/06", () => {
    expect(resolvePeriodPt("últimos 3 meses", NOW)).toMatchObject({
      from: "2026-06-18",
      to: "2026-09-18",
      label: "últimos 3 meses",
      kind: "range",
    });
  });

  it.each([
    ["últimos dois meses", "2026-07-18"],
    ["últimos 4 meses", "2026-05-18"],
    ["últimos seis meses", "2026-03-18"],
  ])("preserva o dia do mês em %s", (text, from) => {
    expect(resolvePeriodPt(text, NOW)?.from).toBe(from);
  });

  it("faz clamp de fim de mês sem estourar a data", () => {
    const march31 = new Date("2026-03-31T15:00:00Z");
    expect(resolvePeriodPt("últimos dois meses", march31)).toMatchObject({
      from: "2026-01-31",
      to: "2026-03-31",
    });
  });

  it("média mensal com número por extenso usa meses completos", () => {
    expect(resolveTimeAspectPt("qual a média mensal dos últimos três meses?", NOW)).toMatchObject({
      aspect: "last_n_complete",
      from: "2026-06-01",
      to: "2026-08-31",
      n: 3,
      exclude_partial: true,
      reduce: "mean",
    });
  });

  it("o resolver multi-período também reconhece uma janela de meses", () => {
    const out = resolveMultiPeriodsPt("gastos dos últimos 3 meses", NOW);
    expect(out.source).toBe("single");
    expect(out.periods[0]).toMatchObject({ from: "2026-06-18", to: "2026-09-18" });
  });
});

describe("comparison follow-up — evidência estruturada", () => {
  it("resolve 'menos acima' com entidade E valor comprovado", () => {
    const turn = resolveGroundedComparisonFollowup(
      "Ficou quanto menos acima da média?",
      comparisonMemory(),
    );
    expect(turn).toMatchObject({
      act: "follow_up",
      mode: "converse",
      domain: "conversation",
      focus: { category: "Serviços" },
      financial_read: null,
    });
    expect(turn?.direct_reply).toContain("Serviços");
    expect(turn?.direct_reply).toContain("1,32");
    expect(turn?.direct_reply).toContain("137,75");
    expect(turn?.direct_reply).toContain("136,43");
  });

  it("explica a metodologia realmente executada para mês parcial", () => {
    const turn = resolveGroundedComparisonFollowup(
      "Esses valores que você está comparando são médias mensais ou valores totais?",
      comparisonMemory(),
    );
    expect(turn).toMatchObject({ act: "follow_up", mode: "converse", domain: "conversation" });
    expect(turn?.direct_reply).toContain("até o mesmo dia do mês");
    expect(turn?.direct_reply).toContain("mês parcial");
  });

  it("resolve 'mais acima' da evidência sem recalcular nem usar LLM", () => {
    const turn = resolveGroundedComparisonFollowup(
      "Qual delas ficou mais acima?",
      comparisonMemory(),
    );
    expect(turn).toMatchObject({
      act: "follow_up",
      mode: "converse",
      domain: "conversation",
      focus: { category: "Moradia" },
    });
    expect(turn?.direct_reply).toContain("Moradia");
    expect(turn?.direct_reply).toContain("5.174,78");
  });

  it("'quanto ela ficou acima' usa a entidade selecionada, não o primeiro item por acaso", () => {
    const memory = comparisonMemory();
    memory.active_category = "Serviços";
    const turn = resolveGroundedComparisonFollowup("E quanto ela ficou acima?", memory);
    expect(turn?.focus.category).toBe("Serviços");
    expect(turn?.direct_reply).toContain("1,32");
    expect(turn?.direct_reply).not.toContain("5.174,78");
  });

  it("mantém a referência viva por TTL mesmo após o orçamento antigo de turnos chegar a 1", () => {
    const memory = comparisonMemory();
    const advanced = advanceReferences(memory.references, NOW);
    expect(advanced[0].status).toBe("active");
    expect(advanced[0].turns_remaining).toBeGreaterThan(0);
  });

  it("previous_entity prefere active_category quando ela pertence ao conjunto", () => {
    const memory = comparisonMemory();
    const grounded = resolveStructuredReference(
      { kind: "previous_entity", target: "category", expression: "ela", status: "resolved" },
      memory.references,
      NOW,
      { topic_id: "topic-current", preferred_entity: "Serviços" },
    );
    expect(grounded.entity_labels).toEqual(["Serviços"]);
  });
});

describe("conversation continuity — tópico ativo vence thread histórica em follow-up", () => {
  const current = {
    id: "current",
    user_id: "u1",
    conversation_id: "c1",
    subject: "read",
    title: "Quais categorias ficaram acima da média?",
    summary: null,
    status: "answered" as const,
    keywords: ["categorias", "media"],
    entities: [], acts: [],
    period_from: "2026-09-01", period_to: "2026-09-18",
    original_query: "Quais categorias ficaram acima da média?",
    last_query: "Qual ficou menos acima?",
    evidence_reference: null, execution_summary: null,
    turn_count: 5,
    opened_at: "2026-09-18T14:00:00Z",
    last_activity_at: "2026-09-18T14:10:00Z",
  };
  const old = {
    ...current,
    id: "old",
    title: "Quais categorias ficaram acima da média dos últimos 3 meses em agosto?",
    original_query: "Quais categorias ficaram acima da média dos últimos 3 meses em agosto?",
    last_query: "Esses valores são médias ou totais?",
    period_from: "2026-06-01",
    period_to: "2026-09-18",
    last_activity_at: "2026-09-18T13:00:00Z",
  };

  it("não deixa 'esses valores...' saltar para a thread antiga mais parecida", () => {
    const out = resolveConversation({
      text: "Esses valores que você está comparando são médias mensais ou valores totais?",
      active_topic_id: "current",
      topics: [old, current] as any,
      now: NOW,
    });
    expect(out.source).toBe("active_topic");
    expect(out.topic_id).toBe("current");
  });
});

describe("comparison ambiguity guard", () => {
  it("não inventa o período-alvo quando a pergunta só cita a média histórica", () => {
    const turn = resolveNarrowDeterministicTurn("Quais categorias ficaram acima da média dos últimos 3 meses?");
    expect(turn).toMatchObject({ mode: "clarify", domain: "conversation" });
    expect(turn?.clarification_question).toContain("este mês");
    expect(turn?.clarification_question).toContain("últimos 3 meses");
  });

  it("não bloqueia quando o alvo é explícito", () => {
    const turn = resolveNarrowDeterministicTurn("Quais categorias de agosto ficaram acima da média dos últimos 3 meses?");
    expect(turn).toBeNull();
  });
});
