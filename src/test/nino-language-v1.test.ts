// nino_language.v1 — compreender antes de executar.
// Incidente real: "Ansioso" foi gravado como "Atento", a correção
// "não foi atento, foi ansioso" não foi entendida e o registro rodou duas
// vezes no mesmo turno. Estes testes travam os três defeitos.
import { describe, expect, it } from "vitest";
import { EMOTION_CATALOG, EMOTION_CATALOG_VERSION, resolveEmotion } from "@/lib/emotions/catalog";
import {
  candidateFeelingTerm,
  customEmotionOption,
  EMOTION_CATALOG as BACKEND_CATALOG,
  emotionSlug,
  parseEmotionCorrection,
  parseEmotionFromText,
  resolveEmotionTerm,
} from "../../supabase/functions/_shared/intelligence/emotionParse";
import {
  isExplicitRepair,
  isExplicitSubstitution,
  classifyDialogueState,
} from "../../supabase/functions/_shared/agent/core/DialogueAct";
import {
  createTurnEvidenceCache,
  isWriteTool,
} from "../../supabase/functions/_shared/agent/core/TurnEvidenceCache";
import { isShortHumanMessage } from "../../supabase/functions/_shared/agent/core/HumanUnderstanding";
import { classifyCapability } from "../../supabase/functions/_shared/agent/core/CapabilityRouter";

const parsed = { kind: "question" } as any;

describe("ansioso é ansioso", () => {
  it("catálogo do app tem ansioso como emoção própria", () => {
    expect(EMOTION_CATALOG_VERSION).toBe("emotion_catalog.v3");
    const keys = EMOTION_CATALOG.map((e) => e.key);
    expect(keys).toContain("ansioso");
    expect(resolveEmotion("ansioso")?.key).toBe("ansioso");
    expect(resolveEmotion("ansiedade")?.key).toBe("ansioso");
    expect(resolveEmotion("nervoso")?.key).toBe("ansioso");
  });

  it("atento voltou a significar atenção", () => {
    expect(resolveEmotion("atento")?.key).toBe("atento");
    expect(resolveEmotion("ansioso")?.key).not.toBe("atento");
  });

  it("catálogo do Nino espelha o catálogo do app", () => {
    expect(BACKEND_CATALOG.map((e) => e.key).sort())
      .toEqual(EMOTION_CATALOG.map((e) => e.key).sort());
    for (const option of BACKEND_CATALOG) {
      const front = EMOTION_CATALOG.find((e) => e.key === option.key);
      expect(front?.mood).toBe(option.mood);
    }
  });

  it("frase livre com ansiedade não vira atento", () => {
    expect(parseEmotionFromText("hoje me senti bem ansioso")?.key).toBe("ansioso");
    expect(parseEmotionFromText("meio tenso hoje")?.key).toBe("ansioso");
    expect(resolveEmotionTerm("apreensiva")?.key).toBe("ansioso");
  });
});

describe("correção natural: não foi X, foi Y", () => {
  it("reconhece a substituição como repair", () => {
    expect(isExplicitSubstitution("Não foi atento, foi ansioso")).toBe(true);
    expect(isExplicitRepair("Não foi atento, foi ansioso")).toBe(true);
    const state = classifyDialogueState("Não foi atento, foi ansioso", parsed);
    expect(state.acts).toContain("repair");
    expect(state.acts).not.toContain("new_query");
  });

  it("extrai o termo afirmado, nunca o negado", () => {
    const c = parseEmotionCorrection("não foi atento, foi ansioso");
    expect(c?.toTerm).toBe("ansioso");
    expect(c?.option?.key).toBe("ansioso");
    expect(parseEmotionCorrection("não era triste, era cansado")?.toTerm).toBe("cansado");
    expect(parseEmotionCorrection("quis dizer ansioso")?.option?.key).toBe("ansioso");
  });

  it("negação solta não é substituição", () => {
    expect(parseEmotionCorrection("não foi isso")).toBeNull();
    expect(isExplicitSubstitution("não foi isso")).toBe(false);
  });

  it("roteia correção para o registro emocional com correction=true", () => {
    const decision = classifyCapability("Não foi atento, foi ansioso", { kind: "question" } as any, null as any);
    expect(decision.name).toBe("emotional_checkin");
    expect(decision.required_tool).toBe("log_emotional_checkin");
    expect(decision.tool_args?.correction).toBe(true);
    expect(decision.tool_args?.emotion).toBe("ansioso");
  });
});

describe("sentimento pessoal", () => {
  it("palavra fora do catálogo é preservada como candidata", () => {
    expect(candidateFeelingTerm("apatia")).toBe("apatia");
    expect(candidateFeelingTerm("ansioso")).toBeNull();
    expect(candidateFeelingTerm("estou muito ansioso hoje")).toBeNull();
  });

  it("vira opção com a mesma forma do catálogo", () => {
    expect(emotionSlug("Apatia ")).toBe("apatia");
    const option = customEmotionOption({ emotion_key: "apatia", label: "apatia", mood: 2, emoji: null });
    expect(option).toMatchObject({ key: "apatia", label: "Apatia", mood: 2, custom: true });
  });
});

describe("escrita única por turno", () => {
  it("registro emocional é ferramenta de escrita", () => {
    expect(isWriteTool("log_emotional_checkin")).toBe(true);
  });

  it("não reexecuta escrita nem com argumentos diferentes", async () => {
    const cache = createTurnEvidenceCache();
    let runs = 0;
    const exec = () => {
      runs++;
      return Promise.resolve({
        tool_name: "log_emotional_checkin", args: {}, ok: true, result: { registered: true },
        error: null, duration_ms: 1, retries: 0,
      });
    };
    await cache.run("log_emotional_checkin", { emotion: "ansioso" }, exec);
    const second = await cache.run("log_emotional_checkin", { emotion: "ansioso", correction: true }, exec);
    expect(runs).toBe(1);
    expect(second.reused).toBe(true);
    expect(cache.hasWrite("log_emotional_checkin")).toBe(true);
    expect(cache.stats().write_reuses).toBe(1);
  });

  it("leitura continua podendo repetir com outros argumentos", async () => {
    const cache = createTurnEvidenceCache();
    let runs = 0;
    const exec = () => {
      runs++;
      return Promise.resolve({
        tool_name: "get_emotional_checkins", args: {}, ok: true, result: {},
        error: null, duration_ms: 1, retries: 0,
      });
    };
    await cache.run("get_emotional_checkins", { days: 7 }, exec);
    await cache.run("get_emotional_checkins", { days: 30 }, exec);
    expect(runs).toBe(2);
    expect(cache.hasWrite("get_emotional_checkins")).toBe(false);
  });
});

describe("mensagem humana curta", () => {
  it("reconhece sentimento, correção e conversa", () => {
    expect(isShortHumanMessage("ansioso")).toBe(true);
    expect(isShortHumanMessage("não foi atento, foi ansioso")).toBe(true);
    expect(isShortHumanMessage("bom dia")).toBe(true);
  });

  it("nunca captura pergunta financeira", () => {
    expect(isShortHumanMessage("quanto gastei hoje?")).toBe(false);
    expect(isShortHumanMessage("saldo")).toBe(false);
    expect(isShortHumanMessage("fatura do cartão")).toBe(false);
  });
});
