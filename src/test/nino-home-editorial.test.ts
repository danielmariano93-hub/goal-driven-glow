import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildNinoHomeEditorialView, NINO_SUPPORTING_LIMIT } from "@/lib/nino/homeEditorial";
import { toHomeDiagnosisView, type FinancialSituation, type NinoDiagnosisContext } from "@/lib/nino/diagnosis";
import type { NinoNextStep } from "@/lib/nino/nextStep";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

function situation(over: Partial<FinancialSituation> & { id: string }): FinancialSituation {
  return {
    situation_type: "spending_pace_change",
    situation_key: over.id,
    status: "active",
    temporal_scope: "now",
    severity: "attention",
    confidence: 0.8,
    relevance_score: 50,
    headline: `Leitura ${over.id}`,
    narrative_role: "support",
    evaluation: {},
    valid_from: new Date().toISOString(),
    ...over,
  } as FinancialSituation;
}

function context(over: Partial<NinoDiagnosisContext> = {}): NinoDiagnosisContext {
  return {
    ok: true,
    contract: "nino_diagnosis_contract.v1.1",
    snapshot_id: null,
    as_of: new Date().toISOString(),
    overall_state: "attention",
    primary_situation: null,
    primary_action: null,
    supporting_situations: [],
    patterns: [],
    anticipations: [],
    operational_tasks: [],
    suppressed_situation_ids: [],
    timeline: [],
    closings: [],
    narrative: {},
    forecast: {},
    data_quality: {},
    confidence: 0.8,
    rationale: {},
    snapshot_payload: {},
    ...over,
  } as NinoDiagnosisContext;
}

const goalStep: NinoNextStep = {
  id: "step-1",
  stage: "fund_goal",
  title: "Aportar na meta",
  detail: null,
  route: "/app/metas",
  amount: 290.14,
  amountRole: "monthly_contribution",
  requiredAmount: 1554,
  goalId: "goal-1",
  goalName: "Meta Financeira",
};

function build(over: Partial<NinoDiagnosisContext>, nextStep: NinoNextStep | null = null) {
  const ctx = context(over);
  return buildNinoHomeEditorialView({ context: ctx, diagnosis: toHomeDiagnosisView(ctx), nextStep });
}

describe("nino_home_editorial.v1", () => {
  it("A. um Spotlight de decisão + um insight compacto", () => {
    const view = build(
      { supporting_situations: [situation({ id: "d1", severity: "positive", one_line_summary: "Você já reduziu 19% da dívida Celular" })] },
      goalStep,
    );
    expect(view.primary?.semanticType).toBe("next_best_action");
    expect(view.primary?.mainValue).toBe(290.14);
    expect(view.primary?.primaryAction?.kind).toBe("accept");
    expect(view.supporting).toHaveLength(1);
    expect(view.supporting[0].title).toContain("19%");
  });

  it("B. nunca passa de três insights secundários", () => {
    const view = build(
      {
        supporting_situations: [
          situation({ id: "s1", one_line_summary: "Leitura um" }),
          situation({ id: "s2", one_line_summary: "Leitura dois", situation_type: "cash_flow_imbalance" }),
        ],
        anticipations: [situation({ id: "s3", situation_type: "anticipation", temporal_scope: "future", one_line_summary: "Leitura três" })],
        patterns: [situation({ id: "s4", situation_type: "behavioral_pattern", status: "confirmed", one_line_summary: "Leitura quatro" })],
        operational_tasks: [situation({ id: "s5", situation_type: "data_quality_issue", one_line_summary: "Leitura cinco" })],
      },
      goalStep,
    );
    expect(view.supporting).toHaveLength(NINO_SUPPORTING_LIMIT);
    expect(view.totalAvailable).toBeGreaterThan(NINO_SUPPORTING_LIMIT);
  });

  it("C. sem decisão material não inventa Spotlight", () => {
    const view = build({ supporting_situations: [situation({ id: "s1", severity: "positive", one_line_summary: "Dívida caiu 19%" })] });
    expect(view.primary).toBeNull();
    expect(view.supporting).toHaveLength(1);
  });

  it("D. headline longa é resumida editorialmente, sem corte no meio de palavra", () => {
    const long = "Sua meta pede um ritmo maior do que cabe hoje porque o prazo atual foi definido antes da mudança de renda. Vamos ajustar isso.";
    const view = build({ primary_situation: situation({ id: "p", one_line_summary: long }) });
    expect(view.primary?.headline.length).toBeLessThanOrEqual(91);
    expect(view.primary?.headline.endsWith("-")).toBe(false);
  });

  it("E. sem valor principal o Spotlight continua íntegro", () => {
    const view = build({ primary_situation: situation({ id: "p", one_line_summary: "Seu ritmo subiu" }) });
    expect(view.primary?.mainValue).toBeNull();
    expect(view.primary?.headline).toBe("Seu ritmo subiu");
  });

  it("F. sem ação secundária o CTA principal segue presente", () => {
    const view = build({}, { ...goalStep, stage: "repair_truth", amount: null, requiredAmount: null });
    expect(view.primary?.secondaryAction).toBeNull();
    expect(view.primary?.primaryAction?.label).toBe("Resolver isso");
  });

  it("G. progresso vai para o apoio quando existe decisão melhor", () => {
    const view = build(
      { supporting_situations: [situation({ id: "prog", severity: "positive", one_line_summary: "Você já reduziu 19% da dívida" })] },
      goalStep,
    );
    expect(view.primary?.semanticType).toBe("next_best_action");
    expect(view.supporting.map((item) => item.tone)).toContain("progress");
  });

  it("G2. risco crítico vem antes da decisão quando não é a mesma decisão", () => {
    const view = build(
      { primary_situation: situation({ id: "crit", severity: "critical", situation_type: "cash_flow_imbalance", one_line_summary: "Seu caixa precisa de atenção" }) },
      goalStep,
    );
    expect(view.primary?.tone).toBe("critical");
    expect(view.primary?.semanticType).toBe("cash_flow_imbalance");
  });

  it("H. a mesma situação não aparece no Spotlight e no apoio", () => {
    const primary = situation({ id: "p", one_line_summary: "Seu ritmo subiu" });
    const view = build({ primary_situation: primary, supporting_situations: [situation({ id: "s", one_line_summary: "Seu ritmo subiu" })] });
    expect(view.primary?.headline).toBe("Seu ritmo subiu");
    expect(view.supporting.some((item) => item.title === "Seu ritmo subiu")).toBe(false);
  });

  it("I. a Home não mostra feedback de leitura", () => {
    const files = [
      "src/components/home/NinoGuidanceSection.tsx",
      "src/components/home/nino/NinoSpotlightCard.tsx",
      "src/components/home/nino/NinoInsightRow.tsx",
    ].map(read).join("\n");
    expect(files).not.toContain("Não ajudou");
    expect(files).not.toContain("Útil");
    expect(files).not.toContain("Ver outra leitura");
  });

  it("J. não existe mais carrossel, dots ou swipe no bloco do Nino", () => {
    const section = read("src/components/home/NinoGuidanceSection.tsx");
    expect(section).not.toContain("embla");
    expect(section).not.toContain("useEmblaCarousel");
    expect(section).not.toContain("scrollNext");
    expect(section).not.toContain("aria-roledescription");
    expect(fs.existsSync(path.join(root, "src/components/home/NinoGuidanceCard.tsx"))).toBe(false);
    expect(fs.existsSync(path.join(root, "src/components/home/NinoDecisionCard.tsx"))).toBe(false);
  });

  it("não vaza jargão técnico do motor para a UI", () => {
    const view = build({}, goalStep);
    const text = `${view.primary?.eyebrow} ${view.primary?.headline} ${view.primary?.supportingText ?? ""}`;
    expect(text).not.toMatch(/stage|confidence|priority|truth gate|capacidade sustent/i);
  });
});
