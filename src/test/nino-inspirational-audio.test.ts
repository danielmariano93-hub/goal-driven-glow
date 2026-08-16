import { describe, expect, it } from "vitest";
import {
  classifyConversational,
  deterministicConversationalReply,
  shouldAcknowledge,
} from "../../supabase/functions/_shared/agent/core/Conversational.ts";
import { findBrokenPhrases, humanizeReply } from "../../supabase/functions/_shared/agent/core/ReplyHumanizer.ts";
import { audioFailureReply, isAudioMedia } from "../../supabase/functions/_shared/messaging/wahaMedia.ts";

describe("propósito e identidade sem aviso indevido", () => {
  const asks = [
    "Nino, me fala um pouco mais sobre você e seu propósito",
    "me conta mais de você",
    "qual é o seu propósito?",
    "qual sua missão",
    "por que você existe",
    "me apresenta",
    "sobre o que é o Meu Nino",
  ];

  it("classifica pedido sobre si mesmo como conversa", () => {
    for (const q of asks) {
      expect(classifyConversational(q).kind, q).not.toBeNull();
    }
  });

  it("nunca dispara o aviso de espera nesses pedidos", () => {
    for (const q of asks) expect(shouldAcknowledge(q), q).toBe(false);
  });

  it("nenhum aviso em turno analítico — só os três pontinhos", () => {
    for (const q of [
      "quanto gastei em agosto?",
      "me manda um gráfico da evolução dos meus gastos",
      "onde eu mais gasto?",
      "gastei 32 no mercado",
      "como estão minhas metas?",
    ]) {
      expect(shouldAcknowledge(q), q).toBe(false);
    }
  });

  it("resposta de propósito é inspiracional, íntegra e convida à ação", () => {
    const reply = humanizeReply(deterministicConversationalReply("purpose", { first_name: "Daniel" })!);
    expect(reply).toMatch(/Daniel/);
    expect(reply).toMatch(/clareza/i);
    expect(reply).toMatch(/gasto|print/i);
    expect(reply.toLowerCase()).not.toMatch(/google|openai|gemini|gpt/);
    expect(findBrokenPhrases(reply)).toEqual([]);
  });

  it("identidade e capacidades saem sem bullet colado e sem frase quebrada", () => {
    for (const kind of ["identity", "capabilities"] as const) {
      const reply = humanizeReply(deterministicConversationalReply(kind, { first_name: "Ana" })!);
      expect(findBrokenPhrases(reply), kind).toEqual([]);
      expect(reply).not.toMatch(/\S[ \t]+•/);
    }
  });

  it("bullet colado no meio da frase é quebrado em linhas", () => {
    const out = humanizeReply("Eu faço: • Registrar gastos • Prever o mês");
    expect(out).toBe("Eu faço:\n\n• Registrar gastos\n• Prever o mês");
    expect(findBrokenPhrases(out)).toEqual([]);
  });
});

describe("áudio no WhatsApp", () => {
  it("reconhece nota de voz e ignora outras mídias", () => {
    expect(isAudioMedia({ mime_type: "audio/ogg; codecs=opus" })).toBe(true);
    expect(isAudioMedia({ mimetype: "audio/mp4" })).toBe(true);
    expect(isAudioMedia({ mediaType: "ptt" })).toBe(true);
    expect(isAudioMedia({ mime_type: "image/jpeg" })).toBe(false);
    expect(isAudioMedia(null)).toBe(false);
  });

  it("falha de áudio sempre gera resposta amigável e específica", () => {
    expect(audioFailureReply("too_long", "Ana")).toMatch(/Ana/);
    expect(audioFailureReply("too_long")).toMatch(/curt/i);
    expect(audioFailureReply("empty_audio")).toMatch(/vazio/i);
    expect(audioFailureReply("unsupported_format")).toMatch(/formato/i);
    expect(audioFailureReply("transcription_failed")).toMatch(/repetir|texto/i);
  });
});
