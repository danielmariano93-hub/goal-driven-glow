import { describe, expect, it } from "vitest";
import {
  classifyConversational,
  deterministicConversationalReply,
  shouldAcknowledge,
} from "../../supabase/functions/_shared/agent/core/Conversational.ts";
import { findBrokenPhrases, humanizeReply } from "../../supabase/functions/_shared/agent/core/ReplyHumanizer.ts";

describe("rota conversacional", () => {
  it("classifica identidade e responde sem citar fornecedor", () => {
    for (const q of ["Oi nino. O que você é exatamente?", "quem te criou?", "você é um robô?"]) {
      const c = classifyConversational(q);
      expect(c.kind, q).toBe("identity");
      const reply = deterministicConversationalReply("identity", { first_name: "Daniel" })!;
      expect(reply).toMatch(/Nino/);
      expect(reply.toLowerCase()).not.toMatch(/google|openai|gemini|gpt/);
      expect(findBrokenPhrases(humanizeReply(reply))).toEqual([]);
    }
  });

  it("classifica capacidades, saudação, agradecimento e despedida", () => {
    expect(classifyConversational("o que você faz?").kind).toBe("capabilities");
    expect(classifyConversational("bom dia").kind).toBe("greeting");
    expect(classifyConversational("valeu!").kind).toBe("thanks");
    expect(classifyConversational("tchau").kind).toBe("farewell");
  });

  it("conversa geral vai para a rota casual não determinística", () => {
    const c = classifyConversational("qual a capital da França?");
    expect(c.kind).toBe("chat");
    expect(c.deterministic).toBe(false);
  });

  it("pergunta financeira NUNCA cai na rota casual", () => {
    for (const q of [
      "quanto gastei em agosto?",
      "onde eu gasto mais?",
      "gastei 32 no mercado",
      "qual meu saldo?",
      "como está minha meta?",
    ]) {
      expect(classifyConversational(q).kind, q).toBeNull();
    }
  });

  it("não avisa 'só um instante' em conversa casual", () => {
    for (const q of ["o que você é exatamente?", "bom dia", "obrigado", "o que você faz?"]) {
      expect(shouldAcknowledge(q), q).toBe(false);
    }
  });
});

describe("saneamento de texto sem quebrar frase", () => {
  it("remove autoria de fornecedor sem deixar preposição órfã", () => {
    const out = humanizeReply("Oi! Eu sou o Nino. Fui criado pelo Google para te ajudar a organizar suas finanças.");
    expect(out.toLowerCase()).not.toMatch(/google/);
    expect(out).not.toMatch(/criado pelo para/i);
    expect(findBrokenPhrases(out)).toEqual([]);
    expect(out).toMatch(/para te ajudar/);
  });

  it("remove menções variadas de modelo", () => {
    for (const raw of [
      "Sou um modelo de linguagem do Google, mas te ajudo com dinheiro.",
      "Fui treinado pela OpenAI para conversar.",
      "Sou baseado no GPT-4 e cuido das suas finanças.",
    ]) {
      const out = humanizeReply(raw);
      expect(out.toLowerCase()).not.toMatch(/google|openai|open ai|gpt/);
      expect(findBrokenPhrases(out)).toEqual([]);
    }
  });

  it("mantém números e bullets intactos", () => {
    const out = humanizeReply("Você gastou *R$ 1.240,50* em agosto.\n\n• Alimentação: R$ 480,00\n• Transporte: R$ 210,30");
    expect(out).toMatch(/R\$ 1\.240,50/);
    expect(out).toMatch(/• Alimentação: R\$ 480,00/);
  });

  it("detecta e repara bullet vazio", () => {
    const out = humanizeReply("Resumo:\n• \n• Transporte: R$ 10,00");
    expect(findBrokenPhrases(out)).toEqual([]);
  });
});
