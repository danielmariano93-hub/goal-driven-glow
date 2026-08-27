// Regressão estrutural da inteligência do Nino (rodada nino_provenance.v1 +
// holistic_assessment.v1). Cada teste trava uma causa-raiz real observada em
// produção, não um exemplo de frase.
import { describe, it, expect } from "vitest";
import { extractSpans, maskTemporal } from "../../supabase/functions/_shared/agent/extract";
import { classifyCapability } from "../../supabase/functions/_shared/agent/core/CapabilityRouter";
import {
  allowsFinancialWrite,
  canDraftEntry,
  hasWriteEvidence,
} from "../../supabase/functions/_shared/agent/core/TextProvenance";
import { isAffirmativeAnswer } from "../../supabase/functions/_shared/agent/core/ContinuationContract";
import { openAIToolDefinitions } from "../../supabase/functions/_shared/agent/tools";

describe("fragmento temporal nunca é valor", () => {
  it("mascara mês, data, hora e ano", () => {
    expect(maskTemporal("gastei em 27/08 no mercado")).not.toMatch(/27\/08/);
    expect(maskTemporal("27 de ago. de 2026, 12:33")).not.toMatch(/\d/);
  });

  it("pedido de relatório não produz valor nem descrição de lançamento", () => {
    for (const text of ["Passar relatório do mês", "relatório do mês 08", "ago 8", "me passa o relatório de agosto"]) {
      const spans = extractSpans(text);
      expect(spans.amount ?? null, text).toBeNull();
    }
  });

  it("lançamento real continua sendo extraído", () => {
    expect(extractSpans("gastei 33,89 alimentação Itaú hoje").amount).toBe(33.89);
    expect(extractSpans("Valor R$ 5,40\nEstabelecimento KFC").amount).toBe(5.4);
  });
});

describe("procedência do texto governa a escrita", () => {
  it("texto remontado pelo sistema nunca escreve", () => {
    expect(allowsFinancialWrite("system_reconstructed")).toBe(false);
    expect(canDraftEntry("gastei 50 no mercado", "system_reconstructed")).toBe(false);
  });

  it("texto do usuário escreve só com evidência de registro", () => {
    expect(canDraftEntry("gastei 50 no mercado", "user_current")).toBe(true);
    expect(canDraftEntry("Passar relatório do mês", "user_current")).toBe(false);
    expect(hasWriteEvidence("Valor R$ 5,40")).toBe(true);
  });

  it("resposta de slot pode completar um lançamento já pedido", () => {
    expect(canDraftEntry("Alimentação", "slot_answer")).toBe(true);
  });
});

describe("continuidade por contrato, não por lista", () => {
  it("aceita variações afirmativas curtas", () => {
    for (const t of ["sim", "ok", "Quero ver", "quero ver o detalhamento", "pode mandar", "manda por favor"]) {
      expect(isAffirmativeAnswer(t), t).toBe(true);
    }
  });

  it("recusa negativa e assunto novo", () => {
    for (const t of ["não", "sim, e em agosto?", "quero ver quanto gastei com transporte no mês passado"]) {
      expect(isAffirmativeAnswer(t), t).toBe(false);
    }
  });
});

describe("hierarquia de roteamento", () => {
  it("pedido de relatório é leitura determinística", () => {
    const cap = classifyCapability("Passar relatório do mês");
    expect(cap.name).toBe("month_report");
    expect(cap.execution).toBe("deterministic");
  });

  it("pergunta global vai para a avaliação holística", () => {
    for (const t of ["estou melhorando ou piorando?", "como está minha vida financeira?", "faz um diagnóstico geral"]) {
      expect(classifyCapability(t).required_tool, t).toBe("assess_financial_health");
    }
  });

  it("pergunta de período continua na resposta executiva", () => {
    expect(classifyCapability("como foi meu mês?").required_tool).toBe("assess_financial_performance");
  });

  it("a ferramenta holística está publicada no catálogo", () => {
    expect(openAIToolDefinitions().some((t: any) => t.function?.name === "assess_financial_health")).toBe(true);
  });
});
