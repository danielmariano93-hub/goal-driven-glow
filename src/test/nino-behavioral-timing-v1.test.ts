// nino_behavioral_timing.v1 — regressões do motor de MOMENTO.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assessTiming,
  classifyMoneyIn,
  effectiveScore,
  growthBlockedBy,
  shouldDeferByTiming,
  timingFingerprint,
  type TimingContext,
} from "../../supabase/functions/_shared/proactive/behavioralTiming";

const NOW = "2026-09-02T12:00:00.000Z";

function ctx(overrides: Partial<TimingContext> = {}): TimingContext {
  return {
    now: NOW,
    monthly_income: 10_000,
    materiality_floor: 100,
    truth_gate_safe: true,
    projected_month_end_available: 1_500,
    available_today: 2_000,
    sustainable_capacity: 600,
    has_active_goal: true,
    debt_pressure_dominant: false,
    commitment_pending: false,
    ...overrides,
  };
}

const read = (path: string) => readFileSync(path, "utf8");

describe("classificação de entrada de dinheiro", () => {
  it("transferência entre contas próprias nunca é renda nova", () => {
    expect(classifyMoneyIn({ movement_kind: "internal_transfer" })).toBe("TRANSFER_IN");
    expect(classifyMoneyIn({ movement_kind: "transaction", transfer_group_id: "g1" })).toBe("TRANSFER_IN");
  });

  it("estorno e resgate são separados de salário", () => {
    expect(classifyMoneyIn({ movement_kind: "refund" })).toBe("REFUND");
    expect(classifyMoneyIn({ movement_kind: "investment_redemption" })).toBe("INVESTMENT_REDEMPTION");
    expect(classifyMoneyIn({ movement_kind: "transaction", description: "Salário agosto" })).toBe("SALARY");
    expect(classifyMoneyIn({ movement_kind: "transaction", origin: "recurring" })).toBe("RECURRING_INCOME");
  });
});

describe("janela e elegibilidade", () => {
  it("salário recém-creditado abre janela imediata com princípio de crescimento", () => {
    const result = assessTiming({
      trigger: "MONEY_IN",
      occurred_at: "2026-09-02T09:00:00.000Z",
      materiality: 6_000,
      money_in_kind: "SALARY",
    }, ctx());
    expect(result.window).toBe("immediate");
    expect(result.eligible_now).toBe(true);
    expect(result.principle_candidates[0]).toBe("pay_yourself_first");
    expect(result.timing_score).toBeGreaterThan(70);
  });

  it("transferência entre contas não gera intervenção de crescimento", () => {
    const result = assessTiming({
      trigger: "MONEY_IN",
      occurred_at: "2026-09-02T09:00:00.000Z",
      materiality: 6_000,
      money_in_kind: "TRANSFER_IN",
    }, ctx());
    expect(result.eligible_now).toBe(false);
    expect(result.reason).toContain("money_in_kind_not_income");
  });

  it("caixa projetado negativo troca crescimento por margem de segurança", () => {
    const blocked = ctx({ projected_month_end_available: -400 });
    expect(growthBlockedBy(blocked)).toBe("projected_cash_negative");
    const result = assessTiming({
      trigger: "MONEY_IN",
      occurred_at: "2026-09-02T09:00:00.000Z",
      materiality: 6_000,
      money_in_kind: "SALARY",
    }, blocked);
    expect(result.principle_candidates).toEqual(["margin_of_safety"]);
    expect(result.growth_blocked).toBe(true);
  });

  it("evento antigo sem ação não vira mensagem retrospectiva", () => {
    const result = assessTiming({
      trigger: "LARGE_SPEND",
      occurred_at: "2026-08-20T09:00:00.000Z",
      materiality: 900,
      actionable: false,
    }, ctx());
    expect(result.window).toBe("closed");
    expect(result.eligible_now).toBe(false);
    expect(result.reason).toBe("retrospective_without_action");
  });

  it("padrão sem amostra mínima não fala", () => {
    const result = assessTiming({
      trigger: "FLEXIBLE_SPEND_CLUSTER",
      occurred_at: "2026-09-02T09:00:00.000Z",
      materiality: 900,
      evidence_count: 2,
    }, ctx());
    expect(result.eligible_now).toBe(false);
    expect(result.reason).toContain("insufficient_evidence");
  });

  it("gasto abaixo do piso relativo não interrompe", () => {
    const result = assessTiming({
      trigger: "LARGE_SPEND",
      occurred_at: "2026-09-02T09:00:00.000Z",
      materiality: 80,
    }, ctx());
    expect(result.eligible_now).toBe(false);
    expect(result.reason).toBe("below_relative_floor");
  });
});

describe("momento x importância", () => {
  it("timing entra como fator, não substitui a importância", () => {
    expect(effectiveScore(100, 100)).toBe(100);
    expect(effectiveScore(100, 0)).toBe(55);
    expect(effectiveScore(80, 50)).toBeLessThan(80);
  });

  it("risco crítico nunca é adiado por momento fraco", () => {
    expect(shouldDeferByTiming({ timing_score: 10, eligible_now: false }, "critical")).toBe(false);
    expect(shouldDeferByTiming({ timing_score: 10, eligible_now: true }, "info")).toBe(true);
  });

  it("dedup amarra evento econômico, princípio e janela", () => {
    const a = timingFingerprint({
      trigger: "MONEY_IN", economic_event_id: "tx-1",
      occurred_at: "2026-09-02", principle: "pay_yourself_first", window: "immediate",
    });
    const b = timingFingerprint({
      trigger: "MONEY_IN", economic_event_id: "tx-1",
      occurred_at: "2026-09-02", principle: "pay_yourself_first", window: "immediate",
    });
    expect(a).toBe(b);
  });

  it("dispensas recentes derrubam o score do mesmo gatilho", () => {
    const base = assessTiming({
      trigger: "MONEY_IN", occurred_at: "2026-09-02T09:00:00.000Z",
      materiality: 6_000, money_in_kind: "SALARY",
    }, ctx());
    const tired = assessTiming({
      trigger: "MONEY_IN", occurred_at: "2026-09-02T09:00:00.000Z",
      materiality: 6_000, money_in_kind: "SALARY",
    }, ctx({ recent_dismissals: 3 }));
    expect(tired.timing_score).toBeLessThan(base.timing_score);
  });
});

describe("contratos de integração", () => {
  it("o ranking ordena por momento x importância", () => {
    const ranking = read("supabase/functions/_shared/proactive/ranking.ts");
    expect(ranking).toContain("effectiveScore");
    expect(ranking).toContain("shouldDeferByTiming");
    expect(ranking).toContain("effective_score");
  });

  it("o pipeline usa o mesmo governador e adia sem descartar", () => {
    const pipeline = read("supabase/functions/_shared/proactive/pipeline.ts");
    expect(pipeline).toContain("buildTimingSituations");
    expect(pipeline).toContain("markBehavioralEventsProcessed");
    expect(pipeline).toContain("recordTimingDeliveries");
    expect(pipeline).toContain("reconcileTimingOutcomes");
    expect(pipeline).toContain("deferred_by_timing");
  });

  it("a alternativa de compromisso é aritmética do valor canônico", () => {
    const loop = read("supabase/functions/_shared/agent/changeLoop.ts");
    expect(loop).toContain("computeCommitmentAlternative");
    expect(loop).toContain("commitment_alternative");
  });

  it("o admin expõe a auditoria de momento", () => {
    const board = read("src/components/admin/BehavioralTimingBoard.tsx");
    expect(board).toContain("admin_v3_behavioral_timing");
    expect(board).toContain("Adiou por momento");
  });
});
