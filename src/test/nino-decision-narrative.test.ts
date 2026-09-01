import { describe, expect, it } from "vitest";
import { composeNinoDecisionNarrative, isHumanText, isSameDecision } from "@/lib/copy/decisionNarrative";

const goalSituation = {
  id: "s1",
  situation_type: "goal_pace_gap",
  situation_key: "goal:viagem",
  severity: "attention",
  headline: "Sua meta Viagem está atrasada",
  one_line_summary: "Sua meta Viagem está atrasada para o prazo atual",
  cause_summary: "O ritmo dos últimos meses ficou abaixo do necessário.",
};

const goalStep = {
  id: "r1",
  stage: "fund_goal",
  title: "Transformar folga em avanço da meta",
  detail: "O valor é limitado pela sua capacidade sustentável, não pelo desejo da meta.",
  route: "/app/metas",
  amount: 290,
  amountRole: "monthly_capacity",
  requiredAmount: 1554,
  goalId: "g1",
  goalName: "Viagem",
};

describe("nino_decision_narrative.v1", () => {
  it("consolida diagnóstico e próximo passo quando é a mesma decisão", () => {
    expect(isSameDecision(goalSituation, goalStep)).toBe(true);
    const narrative = composeNinoDecisionNarrative({ situation: goalSituation, nextStep: goalStep });
    expect(narrative?.sameDecision).toBe(true);
  });

  it("explica a relação entre o necessário do prazo e o ritmo que cabe hoje", () => {
    const narrative = composeNinoDecisionNarrative({ situation: goalSituation, nextStep: goalStep });
    expect(narrative?.context).toContain("1.554");
    expect(narrative?.primaryAmount?.value).toBe(290);
  });

  it("nunca entrega jargão técnico do motor ao usuário", () => {
    const narrative = composeNinoDecisionNarrative({ situation: goalSituation, nextStep: goalStep });
    const all = [narrative?.headline, narrative?.context, narrative?.recommendation].join(" ");
    expect(isHumanText(all)).toBe(true);
    expect(all).not.toContain("capacidade sustentável");
    expect(all).not.toContain("desejo da meta");
  });

  it("oferece aceite real do plano quando há valor mensal", () => {
    const narrative = composeNinoDecisionNarrative({ situation: goalSituation, nextStep: goalStep });
    expect(narrative?.primaryCta?.kind).toBe("accept");
  });

  it("não consolida decisões de objetos diferentes", () => {
    const debtSituation = { ...goalSituation, situation_type: "card_pressure", situation_key: "card:itau", headline: "Sua fatura subiu", one_line_summary: "Sua fatura subiu", };
    expect(isSameDecision(debtSituation, goalStep)).toBe(false);
  });

  it("sem próximo passo, ainda entrega a leitura da situação", () => {
    const narrative = composeNinoDecisionNarrative({ situation: goalSituation, action: { title: "Ver meta", route: "/app/metas" } });
    expect(narrative?.sameDecision).toBe(false);
    expect(narrative?.primaryCta).toEqual({ kind: "link", label: "Ver meta", route: "/app/metas" });
  });
});
