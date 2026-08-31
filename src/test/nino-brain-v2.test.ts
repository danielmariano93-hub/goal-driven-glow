import { describe, expect, it } from "vitest";
import {
  aliasSafety,
  buildMerchantResolver,
  isPassThroughMerchant,
  merchantSourceText,
  normalizeMerchant,
} from "@/lib/engine/merchant";
import {
  comparablePrevious,
  currentMonthPeriod,
  resolvePeriodPt,
} from "../../supabase/functions/_shared/analytics/periodResolver";
import {
  buildTurnPlan,
  splitTasks,
} from "../../supabase/functions/_shared/agent/core/ConversationOrchestrator";
import { validateAgainstEvidence } from "../../supabase/functions/_shared/agent/core/TruthValidator";

describe("merchant_truth.v2", () => {
  it("preserva marcas numéricas", () => {
    expect(normalizeMerchant("PIX WHATS QRCODE 99")).toBe("99");
    const resolver = buildMerchantResolver();
    expect(resolver.resolve("PAY 99FOOD*PEDIDO")?.label).toBe("99 Food");
    expect(resolver.resolve("99 APP SP")?.label).toBe("99");
  });

  it("rejeita inversão de direção mesmo quando o valor existe", () => {
    const verdict = validateAgainstEvidence(
      "No conjunto, você gastou R$ 300,00 menos que no período anterior.",
      [{ tool_name: "comparison", ok: true, result: { current: 1200, previous: 900, delta: 300, direction: "above" } }],
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.issues.some((issue) => issue.type === "direction_mismatch")).toBe(true);
  });

  it("não trata intermediador de pagamento como estabelecimento", () => {
    expect(isPassThroughMerchant("PAGSEGURO *PAGAMENTO")).toBe(true);
    expect(isPassThroughMerchant("MERCADO PAGO IFOOD")).toBe(false);
    expect(buildMerchantResolver().resolve("PICPAY PAGAMENTO")).toBeNull();
  });

  it("rejeita alias genérico e aceita alias específico", () => {
    expect(aliasSafety({ alias_normalized: "pay", canonical_name: "Pay", confidence: 0.98 })).toBe("dangerous");
    expect(aliasSafety({ alias_normalized: "padaria brasil", canonical_name: "Padaria Brasil", confidence: 0.95, confirmed: true })).toBe("safe");
    const resolver = buildMerchantResolver([{ alias_normalized: "pay", canonical_name: "Pay", confidence: 0.98 }]);
    expect(resolver.resolve("PAY SOUK4U")?.label).not.toBe("Pay");
  });

  it("usa a precedência canônica de origem do texto", () => {
    expect(merchantSourceText({ merchant_name: null, normalized_description: "souk4u", description: "COMPRA" }))
      .toBe("souk4u");
  });
});

describe("period_truth.v1", () => {
  const now = new Date("2026-08-16T15:00:00Z");

  it("resolve mês nomeado passado como mês fechado", () => {
    expect(resolvePeriodPt("quanto gastei em julho?", now)).toMatchObject({
      from: "2026-07-01", to: "2026-07-31", complete: true,
    });
  });

  it("mês em curso vai só até hoje", () => {
    const p = resolvePeriodPt("quanto gastei este mês?", now)!;
    expect(p.from).toBe("2026-08-01");
    expect(p.to).toBe("2026-08-16");
    expect(p.complete).toBe(false);
  });

  it("resolve rolling e mesmo período do mês passado", () => {
    expect(resolvePeriodPt("últimos 7 dias", now)).toMatchObject({ from: "2026-08-10", to: "2026-08-16" });
    expect(resolvePeriodPt("mesmo período do mês passado", now)).toMatchObject({ from: "2026-07-01", to: "2026-07-16" });
  });

  it("sem período citado retorna null e o default é o mês em curso", () => {
    expect(resolvePeriodPt("onde meu dinheiro está escapando?", now)).toBeNull();
    expect(currentMonthPeriod(now)).toMatchObject({ from: "2026-08-01", to: "2026-08-16" });
    expect(comparablePrevious({ from: "2026-08-01", to: "2026-08-16" })).toEqual({ from: "2026-07-16", to: "2026-07-31" });
  });
});

describe("nino_brain.v2 — compreensão do turno", () => {
  const now = new Date("2026-08-16T15:00:00Z");

  it("herda o assunto em perguntas de continuação", () => {
    const plan = buildTurnPlan({
      text: "e em julho?",
      history: [{ role: "user", content: "quanto gastei com estabelecimentos este mês?" }],
      now,
    });
    expect(plan.followup).toBe(true);
    expect(plan.effective_text).toContain("estabelecimentos");
    expect(plan.effective_period.from).toBe("2026-07-01");
  });

  it("separa perguntas compostas", () => {
    const tasks = splitTasks("quanto gastei este mês e quais categorias mais consomem?");
    expect(tasks.length).toBe(2);
    expect(buildTurnPlan({ text: "quanto gastei este mês e quais categorias mais consomem?", now }).composed).toBe(true);
  });
});

describe("truth gate", () => {
  const calls = [{ tool_name: "analyze_merchants", ok: true, result: { facts: { period_net_total: 1250.5 } } }];

  it("aceita valores presentes na evidência", () => {
    expect(validateAgainstEvidence("Saíram R$ 1.250,50 no período.", calls).ok).toBe(true);
  });

  it("reprova valor inventado e oferece headline canônica", () => {
    const withHeadline = [{ ...calls[0], result: { ...calls[0].result, answer_format: { headline: "Você gastou R$ 1.250,50 no período." } } }];
    const verdict = validateAgainstEvidence("Você gastou R$ 4.900,00 no período.", withHeadline);
    expect(verdict.ok).toBe(false);
    expect(verdict.canonical_headline).toContain("1.250,50");
  });
});
