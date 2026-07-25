import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeWeekdayPattern } from "../../supabase/functions/_shared/analytics/weekdayPattern";
import { inferChartRequest } from "../../supabase/functions/_shared/intelligence/chartIntent";
import { mergeProactiveAudience } from "../../supabase/functions/_shared/intelligence/proactiveAudience";
import { metricDefinition } from "../../supabase/functions/_shared/intelligence/metricRegistry";
import { interpretSemanticQuery } from "../../supabase/functions/_shared/intelligence/semanticQuery";

function tx(id: string, date: string, amount: number) {
  return {
    id, account_id: "a", category_id: null, type: "expense" as const,
    status: "confirmed" as const, amount, occurred_at: date,
    description: "teste", transfer_group_id: null, movement_kind: "transaction",
  };
}

describe("Nino Intelligence Core hardening", () => {
  it("não captura consulta literal de uma sexta-feira como padrão semanal", () => {
    expect(interpretSemanticQuery("Quanto eu gastei na sexta-feira?")).toBeNull();
    expect(interpretSemanticQuery("Me mostre as despesas de quarta-feira")).toBeNull();
  });

  it("usa a pergunta anterior quando a mensagem atual corrige a interpretação", () => {
    const query = interpretSemanticQuery(
      "Eu digo na média, sem considerar um dia específico",
      "Qual dia da semana eu geralmente gasto mais?",
    );
    expect(query?.intent).toBe("weekday_pattern");
    expect(query?.interpretation).toBe("typical_behavior");
    expect(query?.correction).toBe(true);
  });

  it("não transforma histórico esparso em padrão confiável", () => {
    const rows = [
      tx("f1", "2026-05-08", 120),
      tx("f2", "2026-06-12", 150),
      tx("w1", "2026-05-06", 80),
    ];
    const result = computeWeekdayPattern({ transactions: rows, to: "2026-06-30", weeks: 8 });
    expect(result.winner).toBeNull();
    expect(result.confidence).toBe("insufficient");
  });

  it("separa um pico alto usando apenas os dias ativos", () => {
    const rows = [
      tx("w1", "2026-06-03", 4000), tx("w2", "2026-06-10", 40),
      tx("w3", "2026-06-17", 45), tx("w4", "2026-06-24", 50),
      tx("f1", "2026-06-05", 180), tx("f2", "2026-06-12", 200),
      tx("f3", "2026-06-19", 190), tx("f4", "2026-06-26", 210),
    ];
    const result = computeWeekdayPattern({ transactions: rows, to: "2026-06-30", weeks: 8 });
    expect(result.winner?.label).toBe("Sexta-feira");
    expect(result.outliers.some((row) => row.amount === 4000)).toBe(true);
    expect(result.formula_version).toBe("weekday.robust.v2");
    expect(metricDefinition("weekday_typical_spend")?.formula_version).toBe("weekday.robust.v2");
  });

  it("roteia gráficos de categoria e de padrão semanal sem depender da LLM", () => {
    expect(inferChartRequest("Gere um gráfico dos gastos por categoria dos últimos 45 dias"))
      .toEqual({ mode: "category", days: 45 });
    expect(inferChartRequest("Quero um gráfico de qual dia da semana eu geralmente gasto mais"))
      .toEqual({ mode: "weekday_pattern" });
  });

  it("inclui usuários ativos fora do assessor e remove duplicidades", () => {
    expect(mergeProactiveAudience([
      [{ user_id: "novo" }, { user_id: "duplicado" }],
      [{ user_id: "transacao" }, { user_id: "duplicado" }],
      [{ user_id: "evento" }],
    ])).toEqual(["novo", "duplicado", "transacao", "evento"]);
  });

  it("define novo, ativado, ativo e inativo sem usar cadastro como atividade", () => {
    const sql = readFileSync(
      "supabase/migrations/20260725043000_nino_intelligence_core_hardening.sql",
      "utf8",
    );
    expect(sql).toContain("e.event_name <> 'user_registered'");
    expect(sql).toContain("THEN 'new'");
    expect(sql).toContain("THEN 'dormant'");
    expect(sql).toContain("THEN 'active'");
    expect(sql).toContain("ELSE 'activated'");
    expect(sql).toContain("'activated','onboarding ou primeira ação significativa'");
    expect(sql).toContain("'formula_version','clients.live.v5'");
  });
});
