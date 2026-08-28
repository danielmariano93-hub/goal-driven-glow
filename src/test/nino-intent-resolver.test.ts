import { describe, expect, it } from "vitest";
import { resolveReadIntent } from "../../supabase/functions/_shared/agent/core/IntentResolver";
import { classifyCapability } from "../../supabase/functions/_shared/agent/core/CapabilityRouter";
import { isConversationContext, withoutCurrentTurn } from "../../supabase/functions/_shared/agent/core/ConversationHistory";
import { interpret } from "../../supabase/functions/_shared/agent/parser";

/**
 * `nino_intent.v1` — intenção de leitura resolvida por significado.
 * O caso que originou a correção: a pergunta abaixo caía em `general`,
 * exigia modelo e morria num 403 de crédito.
 */
describe("resolveReadIntent", () => {
  it("resolve a pergunta real que falhou em produção", () => {
    const read = resolveReadIntent("Quero saber como o mês está indo, de forma detalhada");
    expect(read?.name).toBe("month_report");
    expect(read?.required_tool).toBe("get_financial_snapshot");
  });

  it("resolve variações do mesmo pedido sem frase enumerada", () => {
    for (const text of [
      "como está meu mês?",
      "como anda o meu mês",
      "me explica o meu mês",
      "resumo do mês por favor",
      "quero o relatório do mês",
    ]) {
      expect(resolveReadIntent(text)?.name, text).toBe("month_report");
    }
  });

  it("resolve avaliação global para o motor holístico", () => {
    for (const text of ["como estão minhas finanças?", "estou melhorando ou piorando?", "to bem ou to mal nas finanças"]) {
      expect(resolveReadIntent(text)?.name, text).toBe("holistic_assessment");
    }
  });

  it("resolve caixa, dívidas, metas e lançamentos nos motores canônicos", () => {
    expect(resolveReadIntent("quanto eu tenho disponível hoje")?.required_tool).toBe("get_financial_snapshot");
    expect(resolveReadIntent("como estão as minhas dívidas")?.required_tool).toBe("get_debt_status");
    expect(resolveReadIntent("como estão as minhas metas")?.required_tool).toBe("get_goals_overview");
    expect(resolveReadIntent("quais foram os meus últimos lançamentos")?.required_tool).toBe("list_recent_transactions");
  });

  it("não resolve conversa sem âncora financeira", () => {
    for (const text of ["oi nino", "bom dia", "estou triste hoje", "obrigado!", "quem é você?"]) {
      expect(resolveReadIntent(text), text).toBeNull();
    }
  });

  it("nunca resolve pedido de registro como leitura", () => {
    expect(resolveReadIntent("registra 50 reais de mercado")).toBeNull();
    expect(resolveReadIntent("gastei 30 no uber")).toBeNull();
  });
});

describe("audio status e memória do canal", () => {
  it("responde o estado de áudio sem delegar ao modelo", () => {
    for (const text of [
      "Nino, agora você já tá conseguindo entender áudio?",
      "você consegue ouvir nota de voz?",
      "áudio funciona por aqui?",
    ]) {
      const capability = classifyCapability(text, interpret(text), null);
      expect(capability.name, text).toBe("audio_status");
      expect(capability.execution).toBe("deterministic");
      expect(capability.clarification).toMatch(/ouvindo e transcrevendo/i);
    }
  });

  it("não entrega marcadores operacionais antigos ao contexto", () => {
    expect(isConversationContext("[áudio não compreendido]")).toBe(false);
    expect(isConversationContext("[áudio recebido — aguardando escuta]")).toBe(false);
    expect(isConversationContext("registra 20 reais de mercado")).toBe(true);
  });

  it("remove apenas a cópia mais recente do turno atual", () => {
    const history = [
      { role: "user" as const, content: "oi" },
      { role: "assistant" as const, content: "oi!" },
      { role: "user" as const, content: "áudio funciona?" },
    ];
    expect(withoutCurrentTurn(history, "áudio funciona?")).toEqual(history.slice(0, 2));
  });
});
