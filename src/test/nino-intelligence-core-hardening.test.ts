import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { interpretSemanticQuery } from "../../supabase/functions/_shared/intelligence/semanticQuery";
import { computeWeekdayPattern } from "../../supabase/functions/_shared/analytics/weekdayPattern";

function tx(id: string, date: string, amount: number) {
  return {
    id,
    account_id: "a",
    category_id: null,
    type: "expense" as const,
    status: "confirmed" as const,
    amount,
    occurred_at: date,
    description: "teste",
    transfer_group_id: null,
    movement_kind: "transaction",
  };
}

describe("Nino Intelligence Core hardening", () => {
  it("não interpreta uma consulta pontual como padrão semanal", () => {
    expect(interpretSemanticQuery("Quanto eu gastei na sexta-feira?")).toBeNull();
  });

  it("recupera uma correção curta ligada ao conceito de média", () => {
    const result = interpretSemanticQuery(
      "Qual dia eu geralmente gasto mais? Eu digo na média, sem considerar um dia específico.",
    );

    expect(result?.intent).toBe("weekday_pattern");
    expect(result?.interpretation).toBe("typical_behavior");
    expect(result?.correction).toBe(true);
  });

  it("não transforma histórico esparso em padrão confiável", () => {
    const rows = [
      tx("f1", "2026-06-05", 180),
      tx("f2", "2026-06-26", 210),
    ];

    const result = computeWeekdayPattern({
      transactions: rows,
      to: "2026-06-30",
      weeks: 8,
    });

    expect(["insufficient", "low"]).toContain(result.confidence);
  });

  it("separa um pico alto usando apenas os dias ativos", () => {
    const rows = [
      tx("w1", "2026-06-03", 4000),
      tx("w2", "2026-06-10", 40),
      tx("w3", "2026-06-17", 45),
      tx("w4", "2026-06-24", 50),
      tx("f1", "2026-06-05", 180),
      tx("f2", "2026-06-12", 200),
      tx("f3", "2026-06-19", 190),
      tx("f4", "2026-06-26", 210),
    ];

    const result = computeWeekdayPattern({
      transactions: rows,
      to: "2026-06-30",
      weeks: 8,
    });

    expect(result.outliers.some((item) => item.amount === 4000)).toBe(true);

    // V9: com apenas quatro sextas ativas existe candidato,
    // mas ainda não evidência suficiente para uma conclusão pública.
    expect(result.winner).toBeNull();
    expect(result.decision).toBe("candidate");
    expect(result.candidate?.label).toBe("Sexta-feira");
  });

  it("mantém a migration de status administrativo separando cadastro de atividade", () => {
    const sql = readFileSync(
      "supabase/migrations/20260725043000_nino_intelligence_core_hardening.sql",
      "utf8",
    );

    expect(sql).toContain("user_registered");
    expect(sql).toMatch(/activated|activated_at|significant|meaningful|first_value/i);
  });
});
