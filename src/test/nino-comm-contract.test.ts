import { describe, expect, it } from "vitest";
import { allowsCompact, compactBRL, exactBRL, money, pct } from "@/lib/copy/numbers";
import { BANNED_WORDS, confidencePhrase, countNumbers, humanizeJargon, SURFACE_LIMITS } from "@/lib/copy/ninoVoice";
import { buildCommunicationIntent, intentToConversationalText } from "@/lib/copy/commIntent";

const situation = {
  headline: "Cartão pesando no mês",
  one_line_summary: "Você gastou R$ 4.229,83 acima do que recebeu neste mês.",
  cause_summary: "Os gastos flexíveis cresceram, principalmente delivery.",
  consequence_summary: "Isso reduz o que sobra para as suas metas.",
  forecast_summary: "Mantido o ritmo, o mês fecha apertado.",
  impact_amount: 4229.83,
  severity: "critical",
  confidence: 0.91,
};

describe("nino_comm.v1 — política numérica por contexto", () => {
  it("compacta apenas em superfícies de leitura", () => {
    expect(allowsCompact("headline")).toBe(true);
    expect(allowsCompact("receipt")).toBe(false);
    expect(allowsCompact("statement")).toBe(false);
    expect(allowsCompact("installment")).toBe(false);
  });

  it("nunca compacta valor de recibo, confirmação, fatura, parcela ou saldo", () => {
    for (const context of ["receipt", "confirmation", "invoice", "installment", "balance", "detail"] as const) {
      expect(money(4229.83, context)).toBe(exactBRL(4229.83));
      expect(money(4229.83, context)).toContain("4.229,83");
    }
  });

  it("compacta leitura sem inventar precisão", () => {
    expect(compactBRL(4229.83)).toBe("R$ 4,2 mil");
    expect(compactBRL(1_300_000)).toBe("R$ 1,3 milhão");
    expect(compactBRL(137.42)).toBe("R$ 137");
  });

  it("zero percentual com 2 casas em headline", () => {
    expect(pct(60.47, "headline")).toBe("60%");
    expect(pct(60.47, "detail")).toBe("60,5%");
  });
});

describe("nino_comm.v1 — voz do Nino", () => {
  it("traduz jargão financeiro", () => {
    expect(humanizeJargon("Seus gastos flexíveis subiram")).toBe("Seus gastos que dão pra ajustar subiram");
    expect(humanizeJargon("projeção de caixa do mês")).toContain("como seu mês deve fechar");
    expect(humanizeJargon("Sem categoria explicou 73,15% do aumento dos seus gastos")).toBe("Seus gastos aumentaram principalmente por Sem categoria");
    expect(humanizeJargon("composição e taxa de sobra")).toBe("de onde veio e quanto sobrou");
  });

  it("confiança nunca aparece como número", () => {
    for (const c of [0.1, 0.45, 0.7, 0.95]) {
      const phrase = confidencePhrase(c);
      expect(phrase).not.toMatch(/\d/);
      expect(phrase).not.toMatch(/%/);
    }
  });

  it("nenhum termo banido aparece nas frases de confiança", () => {
    const all = [0.1, 0.5, 0.9].map(confidencePhrase).join(" ").toLowerCase();
    for (const word of BANNED_WORDS) expect(all).not.toContain(word);
  });
});

describe("nino_comm.v1 — contrato de intenção", () => {
  const intent = buildCommunicationIntent(situation, "card");

  it("conclusão é uma frase e respeita o limite da superfície", () => {
    const sentences = intent.conclusion.split(/(?<=[.!?])\s+/).filter(Boolean);
    expect(sentences.length).toBeLessThanOrEqual(SURFACE_LIMITS.card.maxSentences);
    expect(countNumbers(intent.conclusion)).toBeLessThanOrEqual(SURFACE_LIMITS.card.maxNumbers);
  });

  it("não cria número que não exista na fonte", () => {
    const text = [intent.conclusion, intent.why_it_matters, intent.impact_label, ...intent.supporting].join(" ");
    const values = text.match(/R\$\s?[\d.,]+/g) ?? [];
    const allowed = ["4.229,83", "4,2"];
    for (const value of values) {
      expect(allowed.some((a) => value.includes(a))).toBe(true);
    }
  });

  it("no máximo 2 sinais de apoio e nenhuma confiança numérica no detalhe", () => {
    expect(intent.supporting.length).toBeLessThanOrEqual(2);
    expect(intent.detail.join(" ")).not.toMatch(/Confian[çc]a:\s*\d/);
  });

  it("texto conversacional cabe em 4 linhas e termina com pergunta", () => {
    const text = intentToConversationalText(intent, "Quer revisar comigo?");
    const lines = text.split("\n");
    expect(lines.length).toBeLessThanOrEqual(SURFACE_LIMITS.whatsapp.maxLines);
    expect(lines[lines.length - 1]).toMatch(/\?$/);
  });

  it("app e canais consomem a mesma conclusão", () => {
    const appIntent = buildCommunicationIntent(situation, "card_detail");
    const waIntent = buildCommunicationIntent(situation, "whatsapp");
    expect(waIntent.conclusion).toBe(appIntent.conclusion);
  });
});
