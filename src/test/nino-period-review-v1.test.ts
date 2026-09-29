import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  buildCategoryReading, buildPeriodReview, categoryKey, comparisonPeriodFor, type PeriodReviewInput,
} from "../../supabase/functions/_shared/agent/v3/PeriodReviewV3";
import { bridgeTurnSpecV3ToRuntime, coherentOperation } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import type { TurnSpecV3 } from "../../supabase/functions/_shared/agent/v3/TurnSpecV3";
import { guardComposedReply, buildComposerPrompt, type ComposeInput } from "../../supabase/functions/_shared/agent/v3/ConversationalComposerV3";
import { humanizeReply } from "../../supabase/functions/_shared/agent/core/ReplyHumanizer";
import { leaksInfrastructure, sanitizeUserFacingText } from "../../supabase/functions/_shared/agent/core/UserSafeError";
import { unsupportedReply } from "../../supabase/functions/_shared/agent/core/SemanticTurnPipeline";
import { NinoMessageText } from "@/components/assessor/NinoMessageText";

const NOW = new Date("2026-09-29T18:28:00-03:00");
const sourced = (value: string) => ({ value, source: "current_turn" as const, source_span: value });

// Setembro real do usuário de teste (valores do motor em 29/09/2026).
const september: PeriodReviewInput = {
  today: "2026-09-29",
  period: { from: "2026-09-01", to: "2026-09-30" },
  expense: {
    total: 7698.43,
    categories: [
      { name: "Dízimo", value: 2444.5 },
      { name: "Lazer", value: 1697.57 },
      { name: "Divisão do Rolê", value: 1017.29 },
      { name: "Alimentação", value: 369.76 },
      { name: "Transporte", value: 300 },
    ],
  },
  income: {
    total: 24355.3,
    categories: [
      { name: "Ferias & Bonus", value: 19380.64 },
      { name: "Salário", value: 4974.66 },
      { name: "Divisão Rolê", value: 1624.44 },
    ],
  },
  comparison: {
    period: { from: "2026-08-01", to: "2026-08-29", label: "agosto" },
    total: 6100,
    categories: [
      { name: "Dízimo", value: 900 },
      { name: "Lazer", value: 1500 },
      { name: "Alimentação", value: 1317.08 },
      { name: "Transporte", value: 320 },
    ],
  },
  income_baseline: { months: 3, categories: [{ name: "Salário", value: 15000 }, { name: "Divisão Rolê", value: 3000 }] },
  ceilings: [{ category: "Lazer", limit: 1272.79, spent: 1697.57, overage: 424.78, projected_overage: 483.32 }],
  upcoming: [{ name: "Crediário", amount: 1316.16, date: "2026-09-30" }],
  donation_goal_names: ["Dízimo"],
  savings_goals: [{ name: "Meta Financeira", remaining: 7770.71 }],
};

describe("revisão do período: 'faz um resumo do meu mês atual?'", () => {
  const review = buildPeriodReview(september);

  it("abre com a leitura do mês, não com um número solto", () => {
    expect(review.headline).toBe("Setembro está sendo um mês fora da curva: entrou bem mais que o normal por causa de Ferias & Bonus.");
  });

  it("traz entradas, o extraordinário, gastos e a sobra, com negrito", () => {
    expect(review.blocks).toContain("📊 *Setembro até agora* (1 a 29/09)");
    expect(review.blocks).toContain("*Entradas:* R$ 24.355,30");
    expect(review.blocks).toContain("↳ R$ 19.380,64 de Ferias & Bonus, fora do seu normal");
    expect(review.blocks).toContain("*Gastos:* R$ 7.698,43");
    expect(review.blocks).toContain("*Sobrou:* R$ 16.656,87");
  });

  it("lê as categorias como assessor: peso, compromisso, teto e reembolso", () => {
    expect(review.blocks).toContain("• *Dízimo*: R$ 2.444,50 (32%) · compromisso seu");
    expect(review.blocks).toContain("• *Lazer*: R$ 1.697,57 (22%) · passou R$ 424,78 do teto ⚠️");
    expect(review.blocks).toContain("• *Divisão do Rolê*: R$ 1.017,29 (13%) · voltaram R$ 1.624,44, mais do que saiu");
  });

  it("mostra o que mudou contra o mesmo trecho do mês passado e o que vence", () => {
    expect(review.blocks).toContain("*O que mudou* (vs. mesmo período de agosto)");
    expect(review.blocks).toContain("• *Dízimo*: subiu de R$ 900,00 para R$ 2.444,50");
    expect(review.blocks).toContain("• *Alimentação*: caiu de R$ 1.317,08 para R$ 369,76");
    expect(review.blocks).toContain("• Crediário: R$ 1.316,16 em 30/09");
  });

  it("termina com UMA sugestão concreta ligada à meta", () => {
    expect(review.blocks.trim().split("\n\n").pop()).toBe(
      "💡 Com a entrada extra de Ferias & Bonus, dá para dar um salto na meta *Meta Financeira* (faltam R$ 7.770,71). Quer que eu simule quanto colocar lá?",
    );
  });

  it("chega ao canal diagramado: blocos separados, negrito do WhatsApp, até 3 emojis, sem data robótica", () => {
    const delivered = humanizeReply(review.body);
    expect(delivered).not.toMatch(/\*\*/);
    expect(delivered).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(delivered.split("\n\n").length).toBeGreaterThanOrEqual(6);
    expect(delivered).toContain("📊");
    expect(delivered).toContain("⚠️");
    expect(delivered).toContain("💡");
    expect(delivered).not.toMatch(/^\s*$\n^\s*$/m);
    expect(leaksInfrastructure(delivered)).toBe(false);
    // Título da seção colado à lista (sem linha em branco no meio).
    expect(delivered).toContain("*Onde mais foi*\n• *Dízimo*");
    expect(delivered).toContain("*Próximos dias*\n• Crediário");
  });

  it("mês apertado e sem extraordinário muda a leitura e a sugestão", () => {
    const tight = buildPeriodReview({
      ...september,
      income: { total: 5000, categories: [{ name: "Salário", value: 5000 }] },
      income_baseline: { months: 3, categories: [{ name: "Salário", value: 15000 }] },
      expense: { total: 6200, categories: [{ name: "Mercado", value: 3000 }, { name: "Lazer", value: 1697.57 }] },
      savings_goals: [],
      ceilings: [],
    });
    expect(tight.headline).toBe("Setembro está apertado: saiu mais do que entrou até aqui.");
    expect(tight.blocks).toContain("*Faltou:* R$ 1.200,00");
    expect(tight.blocks).toContain("💡 Vale olhar os gastos de *Mercado*, que foi onde mais pesou.");
  });

  it("mês fechado vira 'Seu agosto de 2026' e compara com o mês anterior inteiro", () => {
    const closed = buildPeriodReview({ ...september, period: { from: "2026-08-01", to: "2026-08-31" }, upcoming: [] });
    expect(closed.blocks.startsWith("📊 *Seu agosto de 2026*")).toBe(true);
    expect(comparisonPeriodFor({ from: "2026-08-01", to: "2026-08-31" }, "2026-09-29")).toMatchObject({ from: "2026-07-01", to: "2026-07-31" });
    expect(comparisonPeriodFor({ from: "2026-09-01", to: "2026-09-30" }, "2026-09-29")).toMatchObject({ from: "2026-08-01", to: "2026-08-29" });
    expect(comparisonPeriodFor({ from: "2026-03-01", to: "2026-03-31" }, "2026-03-31")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
  });

  it("reembolso casa nomes diferentes da mesma categoria", () => {
    expect(categoryKey("Divisão do Rolê")).toBe(categoryKey("Divisão Rolê"));
  });
});

describe("'Em quais categorias eu gastei esse valor?' nunca mais falha", () => {
  it("valor + agrupamento vira separação (ou série, se for por mês)", () => {
    expect(coherentOperation("value", ["category"])).toBe("breakdown");
    expect(coherentOperation("sum", ["month"])).toBe("trend");
    expect(coherentOperation("rank", ["category"])).toBe("rank");
    expect(coherentOperation("value", [])).toBe("value");
  });

  it("a ponte entrega uma consulta executável", () => {
    const turn: TurnSpecV3 = {
      version: "nino_turn_spec.v3", kind: "task", response_intent: "execute", act: "follow_up",
      canonical_request: "Em quais categorias eu gastei esse valor?", inherit_topic: true, references: [],
      tasks: [{
        kind: "financial_query", family: "financial.query", metric: "expense_amount", operation: "value",
        group_by: ["category"], filters: [], periods: [sourced("este mês")], limit: null, comparison: null,
      }],
    };
    const result = bridgeTurnSpecV3ToRuntime(turn, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contract.financial_read?.queries[0]).toMatchObject({ operation: "breakdown", group_by: ["category"] });
  });

  it("quando algo não é suportado, a resposta é honesta e útil (nunca 'tente mais tarde')", () => {
    for (const text of [unsupportedReply(["x"]), unsupportedReply([], true), unsupportedReply([])]) {
      expect(leaksInfrastructure(text)).toBe(false);
      expect(sanitizeUserFacingText(text)).toBe(text);
      expect(text).not.toMatch(/tent(e|ar) novamente|daqui a pouco/i);
    }
  });
});

describe("'resumo do mês' vira balanço (period_review)", () => {
  it("a ponte leva period_review ao runtime", () => {
    const turn: TurnSpecV3 = {
      version: "nino_turn_spec.v3", kind: "task", response_intent: "execute", act: "new_request",
      canonical_request: "Faça um resumo do meu mês atual", inherit_topic: false, references: [],
      tasks: [{ kind: "advisory", family: "advisory", operation: "period_review", periods: [sourced("este mês")], scenario: null, options: [] }],
    };
    const result = bridgeTurnSpecV3ToRuntime(turn, NOW, { extended: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contract).toMatchObject({ domain: "advisory", advisory_kind: "period_review" });
    expect(result.contract.focus.period_expressions).toEqual(["2026-09-01..2026-09-29"]);
  });
});

describe("'Em quais categorias eu mais gastei esse mês?' com leitura de assessor", () => {
  const reading = buildCategoryReading({
    period: { from: "2026-09-01", to: "2026-09-29" },
    total: 7698.43,
    categories: september.expense.categories,
    income_categories: september.income.categories,
    ceilings: september.ceilings,
    donation_goal_names: ["Dízimo"],
    limit: 3,
  });

  it("período falado, total em negrito, lista com peso e leitura", () => {
    expect(reading.body).toBe([
      "📊 De 1 a 29 de setembro, você gastou *R$ 7.698,43*.",
      "",
      "*Onde mais foi*",
      "• *Dízimo*: R$ 2.444,50 (32%) · compromisso seu",
      "• *Lazer*: R$ 1.697,57 (22%) · passou R$ 424,78 do teto ⚠️",
      "• *Divisão do Rolê*: R$ 1.017,29 (13%) · voltaram R$ 1.624,44, mais do que saiu",
      "",
      "Tirando os compromissos e o que voltou para você, o que mais pesou foi *Lazer*.",
    ].join("\n"));
  });
});

describe("layout no compositor e no app", () => {
  const input = (over: Partial<ComposeInput>): ComposeInput => ({
    kind: "review", channel: "whatsapp", user_text: "faz um resumo do meu mês", history: [], relationship_context: null,
    deterministic_body: buildPeriodReview(september).body, evidence: [{ period_review: buildPeriodReview(september).facts }],
    allow_offer: true, capture_memory: false, today: "2026-09-29", ...over,
  });

  it("abertura do balanço é curta e não pergunta", () => {
    expect(guardComposedReply({ text: "Setembro está sendo um mês fora da curva, com o bônus de férias entrando.", input: input({}) }).ok).toBe(true);
    expect(guardComposedReply({ text: "Quer que eu detalhe o mês?", input: input({}) }).violations).toContain("review_opening_asks");
  });

  it("resposta que termina em item de lista não é tratada como truncada", () => {
    const answer = input({
      kind: "answer",
      deterministic_body: "Você gastou *R$ 7.698,43*.\n\n• *Lazer*: R$ 1.697,57",
    });
    const guard = guardComposedReply({ text: "Você gastou *R$ 7.698,43*.\n\n• *Lazer*: R$ 1.697,57", input: answer });
    expect(guard.violations).not.toContain("truncated_text");
  });

  it("o prompt pede negrito, espaçamento, listas e poucos emojis nos dois canais", () => {
    for (const channel of ["app", "whatsapp"] as const) {
      const { system } = buildComposerPrompt(input({ kind: "answer", channel }));
      expect(system).toContain("*negrito*");
      expect(system).toContain("linha em branco");
      expect(system).toContain("No máximo 2 emojis");
      expect(system).not.toContain("sem emoji");
    }
  });

  it("no app, *negrito* vira <strong> e aritmética não", () => {
    const html = renderToStaticMarkup(NinoMessageText({ text: "• *Lazer*: R$ 1.697,57 e 2 * 3 * 4" }));
    expect(html).toContain("<strong class=\"font-semibold\">Lazer</strong>");
    expect(html).toContain("2 * 3 * 4");
  });
});
