import { describe, expect, it } from "vitest";
import {
  classifyAdvisorIntent,
  installmentsFromText,
  planInstallmentDecision,
} from "../../supabase/functions/_shared/agent/core/AdvisorConsult";
import { classifyCapability, resumeDeterministicCapability } from "../../supabase/functions/_shared/agent/core/CapabilityRouter";
import { routeIntent } from "../../supabase/functions/_shared/agent/core/IntentRouter";
import { shouldAcknowledge } from "../../supabase/functions/_shared/agent/core/Conversational";

const parsed = (text: string) => routeIntent(text).intent;

describe("intenção de consultoria", () => {
  it("reconhece pedidos de redução que antes caíam no genérico", () => {
    for (const q of [
      "quanto eu conseguiria reduzir em outras categorias?",
      "onde dá pra cortar pra sobrar mais?",
      "preciso liberar 500 por mês, como faço?",
    ]) {
      expect(classifyAdvisorIntent(q), q).toBe("reduction");
    }
  });

  it("reconhece pedidos de afordabilidade e parcelamento", () => {
    for (const q of [
      "consigo pagar uma parcela de 800?",
      "vale a pena parcelar em 10x?",
      "cabe no meu mês uma prestação de R$ 450?",
    ]) {
      expect(classifyAdvisorIntent(q), q).toBe("affordability");
    }
  });

  it("lê o número de parcelas do texto", () => {
    expect(installmentsFromText("em 10x")).toBe(10);
    expect(installmentsFromText("em 12 vezes")).toBe(12);
    expect(installmentsFromText("sem parcelar")).toBeNull();
  });
});

describe("roteamento de consultoria", () => {
  it("redução vai para o motor de economia real", () => {
    const d = classifyCapability("quanto eu conseguiria reduzir em outras categorias?", parsed("x"), null);
    expect(d.name).toBe("advisor_consult");
    expect(d.required_tool).toBe("find_savings_opportunities");
  });

  it("afordabilidade com valor vai para a decisão parcelada", () => {
    const d = classifyCapability("consigo pagar uma parcela de R$ 800 em 10x?", parsed("x"), null);
    expect(d.name).toBe("advisor_consult");
    expect(d.required_tool).toBe("plan_installment_decision");
    expect((d.tool_args as any).amount).toBe(800);
    expect((d.tool_args as any).installments).toBe(10);
  });

  it("sem valor, pergunta uma única coisa", () => {
    const d = classifyCapability("consigo pagar isso?", parsed("x"), null);
    expect(d.clarification).toBeTruthy();
    expect(d.required_tool).toBeNull();
  });

  it("follow-up 'e se fosse em 12x' reaproveita o valor", () => {
    const resumed = resumeDeterministicCapability(
      "e se fosse em 12x?",
      parsed("e se fosse em 12x?"),
      "consigo pagar uma parcela de R$ 1.200 em 6x?",
    );
    expect(resumed?.name).toBe("advisor_consult");
    expect((resumed?.tool_args as any).installments).toBe(12);
    expect((resumed?.tool_args as any).amount).toBe(1200);
  });
});

describe("motor de decisão parcelada", () => {
  const base = {
    today: "2026-08-16",
    method: "card" as const,
    projected_month_end_available: 2_000,
    monthly_income: 8_000,
    monthly_typical_expense: 6_000,
    monthly_debt_installments: 500,
    monthly_card_installments: 300,
  };

  it("cabe quando a parcela é pequena diante da folga", () => {
    const out = planInstallmentDecision({ ...base, amount: 1_200, installments: 12 });
    expect(out.installment_amount).toBe(100);
    expect(out.verdict).toBe("cabe");
    expect(out.tight_months).toHaveLength(0);
    expect(out.timeline).toHaveLength(12);
  });

  it("não cabe e indica quanto liberar por mês", () => {
    const out = planInstallmentDecision({ ...base, amount: 20_000, installments: 10 });
    expect(out.verdict).toBe("nao_cabe");
    expect(out.tight_months.length).toBeGreaterThan(0);
    expect(out.required_monthly_release).toBeGreaterThan(0);
    // Mês 1 usa a folga projetada; meses seguintes, a folga recorrente.
    expect(out.timeline[0].free_before).toBe(2_000);
    expect(out.timeline[1].free_before).toBe(1_200);
  });

  it("respeita parcelas de cartão já contratadas no mês", () => {
    const out = planInstallmentDecision({
      ...base, amount: 3_000, installments: 3,
      card_installments_by_month: { "2026-09": 1_400 },
    });
    expect(out.timeline[1].free_before).toBe(8_000 - 6_000 - 500 - 1_400);
  });

  it("nunca presume juros", () => {
    const out = planInstallmentDecision({ ...base, amount: 1_000, installments: 4 });
    expect(out.installment_amount * 4).toBeCloseTo(1_000, 2);
    expect(out.assumptions.join(" ")).toMatch(/juro/i);
  });
});

describe("sem aviso prévio de texto", () => {
  it("consultoria e análise não recebem 'só um instante'", () => {
    for (const q of [
      "consigo pagar uma parcela de 800 em 10x?",
      "quanto eu conseguiria reduzir em outras categorias?",
      "quanto gastei este mês?",
    ]) {
      expect(shouldAcknowledge(q), q).toBe(false);
    }
  });

  it("mantém um aviso só em leitura longa de documento", () => {
    expect(shouldAcknowledge("segue o extrato do banco em pdf com tudo do mês passado")).toBe(true);
  });
});
