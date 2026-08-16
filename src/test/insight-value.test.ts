import { describe, expect, it } from "vitest";
import {
  insightValue,
  isAppTaskKind,
  materialityFloor,
  meetsMateriality,
  rankInsights,
  DIAGNOSIS_OWNED_KINDS,
} from "../../supabase/functions/_shared/intelligence/insightValue.ts";
import {
  communicationKindFor,
  consolidateByTopic,
  daysUntil,
  situationTypeFromTopic,
  toCandidate,
} from "../../supabase/functions/_shared/intelligence/diagnosisToCommunication.ts";

const income = 8000;

describe("insight_value.v1 — valor do insight", () => {
  it("dívida vencida ganha de duplicidade mesmo com impacto menor", () => {
    const debt = insightValue({
      kind: "debt_overdue", severity: "attention", impactAmount: 74.54,
      monthlyIncome: income, daysUntilEvent: -6, confidence: 0.9, actionable: true,
    });
    const dup = insightValue({
      kind: "duplicate_expense", severity: "attention", impactAmount: 921.65,
      monthlyIncome: income, confidence: 0.75, actionable: true,
    });
    expect(debt.score).toBeGreaterThan(dup.score);
  });

  it("impacto financeiro relativo à renda move o score", () => {
    const small = insightValue({ kind: "cash_flow_imbalance", severity: "attention", impactAmount: 100, monthlyIncome: income });
    const big = insightValue({ kind: "cash_flow_imbalance", severity: "attention", impactAmount: 3000, monthlyIncome: income });
    expect(big.score).toBeGreaterThan(small.score);
  });

  it("descarte repetido silencia o tipo", () => {
    const v = insightValue({ kind: "growing_category", severity: "attention", impactAmount: 500, monthlyIncome: income, dismissals: 2 });
    expect(v.muted).toBe(true);
    const fp = insightValue({ kind: "growing_category", severity: "attention", impactAmount: 500, monthlyIncome: income, falsePositives: 1 });
    expect(fp.muted).toBe(true);
  });

  it("ação do usuário aumenta o valor do tipo", () => {
    const neutral = insightValue({ kind: "goal_feasibility", severity: "attention", impactAmount: 1000, monthlyIncome: income });
    const used = insightValue({ kind: "goal_feasibility", severity: "attention", impactAmount: 1000, monthlyIncome: income, actions: 2 });
    expect(used.score).toBeGreaterThan(neutral.score);
  });

  it("piso de materialidade usa 2% da renda com mínimo de R$ 50", () => {
    expect(materialityFloor(null)).toBe(50);
    expect(materialityFloor(1000)).toBe(50);
    expect(materialityFloor(10000)).toBe(200);
  });

  it("padrão de R$ 14 não é material; crítico e vencimento sempre passam", () => {
    expect(meetsMateriality({ kind: "recurring_pattern", severity: "info", impactAmount: 14.23, monthlyIncome: income })).toBe(false);
    expect(meetsMateriality({ kind: "cash_flow_imbalance", severity: "critical", impactAmount: 0, monthlyIncome: income })).toBe(true);
    expect(meetsMateriality({ kind: "debt_overdue", severity: "attention", impactAmount: 74.54, monthlyIncome: income, daysUntilEvent: -6 })).toBe(true);
  });

  it("ranqueia por valor e não por ordem de chegada", () => {
    const items = [
      { kind: "duplicate_expense", severity: "info", impact: 49.62 },
      { kind: "debt_overdue", severity: "attention", impact: 74.54 },
    ];
    const ranked = rankInsights(items, (item) => ({
      kind: item.kind, severity: item.severity, impactAmount: item.impact, monthlyIncome: income,
    }));
    expect(ranked[0].item.kind).toBe("debt_overdue");
  });

  it("ruído operacional é tarefa de app e não é gerado pelo motor legado", () => {
    expect(isAppTaskKind("duplicate_expense")).toBe(true);
    expect(isAppTaskKind("debt_overdue")).toBe(false);
    expect(DIAGNOSIS_OWNED_KINDS.has("duplicate_expense")).toBe(true);
    expect(DIAGNOSIS_OWNED_KINDS.has("emotional_checkin_due")).toBe(false);
  });
});

describe("diagnóstico como fonte única da comunicação", () => {
  it("extrai o tipo de situação do tópico lógico", () => {
    expect(situationTypeFromTopic("situation:cash_flow:2026-08")).toBe("cash_flow");
    expect(situationTypeFromTopic("situation:future:debt:abc")).toBe("future:debt");
  });

  it("mapeia situação para tipo do catálogo", () => {
    expect(communicationKindFor("debt_overdue", "risk")).toBe("debt_overdue");
    expect(communicationKindFor("uncategorized", "data_quality")).toBe("categorize_transaction");
    expect(communicationKindFor("future:bill", "risk")).toBe("card_bill_pressure");
  });

  it("mantém apenas o item de maior impacto por assunto", () => {
    const rows = [
      { id: "a", logical_topic_key: "situation:cash_flow:2026-08", impact_amount: 1126.87, dedup_key: "a" },
      { id: "b", logical_topic_key: "situation:cash_flow:2026-08", impact_amount: 3058.53, dedup_key: "b" },
    ] as never[];
    const out = consolidateByTopic(rows);
    expect(out).toHaveLength(1);
    expect((out[0] as { id: string }).id).toBe("b");
  });

  it("converte item do diagnóstico preservando número, período e ação", () => {
    const now = new Date("2026-08-16T12:00:00Z");
    const candidate = toCandidate("u1", {
      id: "item-1", kind: "risk", severity: "attention", title: "Dívida vencida",
      summary: "A parcela de R$ 74,54 venceu em 10/08.", explanation: null,
      facts: { event_date: "2026-08-10" }, evidence: {}, primary_action: { type: "review_debt" },
      confidence: 0.9, impact_amount: 74.54, logical_topic_key: "situation:debt_overdue:x",
      dedup_key: "diagnosis:situation:x", valid_until: "2026-08-23T00:00:00Z",
      source_period_start: "2026-08-01", source_period_end: "2026-08-16",
    } as never, now);
    expect(candidate.kind).toBe("debt_overdue");
    expect(candidate.evidence.impact_amount).toBe(74.54);
    expect(candidate.evidence.days_until_event).toBe(-6);
    expect(candidate.channel_ready).toBe("both");
    expect(String(candidate.action.route)).toContain("/app/alertas/");
  });

  it("qualidade de dados nasce como tarefa de app", () => {
    const candidate = toCandidate("u1", {
      id: "item-2", kind: "data_quality", severity: "info", title: "19 lançamentos sem categoria",
      summary: "Eles somam R$ 598,41.", explanation: null, facts: {}, evidence: {},
      primary_action: { type: "classify_transactions" }, confidence: 1, impact_amount: 598.41,
      logical_topic_key: "situation:uncategorized:2026-08", dedup_key: "diagnosis:situation:y",
      valid_until: null, source_period_start: null, source_period_end: null,
    } as never);
    expect(candidate.kind).toBe("categorize_transaction");
    expect(candidate.channel_ready).toBe("app");
  });

  it("calcula dias até o evento", () => {
    expect(daysUntil("2026-08-20", new Date("2026-08-16T12:00:00Z"))).toBe(4);
    expect(daysUntil(null)).toBeNull();
  });
});
