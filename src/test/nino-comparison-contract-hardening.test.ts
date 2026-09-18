import { describe, expect, it } from "vitest";
import {
  resolvePeriodPt,
  resolveTimeAspectPt,
} from "../../supabase/functions/_shared/analytics/periodResolver";
import { resolveMultiPeriodsPt } from "../../supabase/functions/_shared/analytics/multiPeriodResolver";
import { resolveGroundedComparisonFollowup } from "../../supabase/functions/_shared/agent/core/GroundedComparisonFollowup";

const NOW = new Date("2026-09-18T15:00:00Z");

function comparisonMemory(summary = "Quais categorias ficaram acima da média dos últimos 3 meses?") {
  return {
    session_id: "s1",
    current_topic: "read",
    active_topic_id: null,
    previous_intent: "read",
    active_category: null,
    active_merchant: null,
    active_period: { from: "2026-06-18", to: "2026-09-18", label: "últimos 3 meses" },
    comparison_period: null,
    pending_slots: [],
    awaiting: null,
    pending_conversation_action: null,
    conversation_summary: summary,
    references: [{
      id: "ref-prod-1809",
      type: "entity_set" as const,
      target: "category" as const,
      entity_labels: ["Moradia", "Dívidas e empréstimos", "Dízimo", "Assinaturas", "Vestuário"],
      created_at: "2026-09-18T14:32:25.000Z",
      expires_at: "2026-09-18T15:02:25.000Z",
      turns_remaining: 4,
      status: "active" as const,
      source: {
        tool_name: "compare_to_monthly_average",
        query_id: "q1",
        context: {
          months: 3,
          target_period: { from: "2026-06-18", to: "2026-09-18", label: "últimos 3 meses" },
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

describe("comparison follow-up — continuidade sem recompilar semântica", () => {
  it("resolve 'menos acima' pelo conjunto já exibido, sem chamar o compiler", () => {
    const turn = resolveGroundedComparisonFollowup(
      "E qual ficou menos acima da média?",
      comparisonMemory(),
    );
    expect(turn).toMatchObject({
      act: "follow_up",
      mode: "converse",
      domain: "conversation",
      financial_read: null,
    });
    expect(turn?.direct_reply).toContain("Vestuário");
    expect(turn?.direct_reply).toContain("menos acima");
  });

  it("explica corretamente a estatística executada: média mensal contra média mensal", () => {
    const turn = resolveGroundedComparisonFollowup(
      "Esses valores que você está comparando são médias mensais ou valores totais?",
      comparisonMemory("Agora me mostre as 5 categorias que mais ficaram acima da média, da maior para a menor."),
    );
    expect(turn).toMatchObject({ act: "follow_up", mode: "converse", domain: "conversation" });
    expect(turn?.direct_reply).toContain("médias mensais dos dois lados");
    expect(turn?.direct_reply).toContain("3 meses completos anteriores");
    expect(turn?.direct_reply).toContain("Não estou comparando o total de vários meses");
  });

  it("mantém o caminho determinístico existente para 'mais acima'", () => {
    const turn = resolveGroundedComparisonFollowup(
      "Qual delas ficou mais acima?",
      comparisonMemory(),
    );
    expect(turn).toMatchObject({
      act: "follow_up",
      mode: "read",
      domain: "financial_read",
      financial_read: {
        queries: [{
          operation: "compare",
          comparison_direction: "increase",
          comparison_baseline: "mean_previous_complete_months",
          comparison_baseline_window: 3,
          limit: 1,
        }],
      },
    });
  });
});
