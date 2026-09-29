import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  interpretWithSingleSemanticAuthorityV3,
  requiresDeepSemanticReview,
} from "../../supabase/functions/_shared/agent/v3/SemanticAuthorityV3";
import { bridgeTurnSpecV3ToRuntime } from "../../supabase/functions/_shared/agent/v3/V3RuntimeBridge";
import type { TurnSpecV3 } from "../../supabase/functions/_shared/agent/v3/TurnSpecV3";

const provider = {
  provider: "groq" as const,
  baseUrl: "https://groq.invalid/openai/v1",
  apiKey: "test-key",
  headers: { Authorization: "Bearer test-key" },
  modelOverride: "openai/gpt-oss-120b",
};

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function groqStructured(argumentsObject: unknown) {
  return response({
    choices: [{ message: { content: JSON.stringify(argumentsObject) } }],
    usage: { prompt_tokens: 120, completion_tokens: 40 },
  });
}

function readTurn(period = "do dia 21 ao dia 27") {
  return {
    version: "nino_turn_spec.v3",
    kind: "task",
    act: "new_request",
    canonical_request: "Consultar o total gasto entre os dias 21 e 27.",
    inherit_topic: false,
    references: [],
    tasks: [{
      kind: "financial_query",
      financial: {
        metric: "expense_amount",
        operation: "sum",
        group_by: [],
        filters: [],
        periods: [{ value: period, source: "current_turn", source_span: period }],
        limit: null,
        comparison: null,
      },
      goal: null,
      advisory: null,
      write: null,
    }],
    direct_reply: null,
    clarification_question: null,
  };
}

function writeTurn(amount: string) {
  return {
    version: "nino_turn_spec.v3",
    kind: "task",
    act: "new_request",
    canonical_request: `Registrar gasto de R$ ${amount} no mercado.`,
    inherit_topic: false,
    references: [],
    tasks: [{
      kind: "financial_write",
      financial: null,
      goal: null,
      advisory: null,
      write: {
        action: "transaction.create",
        slots: [
          { key: "amount", value: amount },
          { key: "merchant", value: "mercado" },
        ],
      },
    }],
    direct_reply: null,
    clarification_question: null,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Nino V3 — single semantic authority", () => {
  it("interpreta a frase real de produção como leitura, não como transaction.create", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(groqStructured(readTurn()));

    const outcome = await interpretWithSingleSemanticAuthorityV3({
      text: "Nino me fala quanto eu gastei semana passada do dia 21 ao dia 27",
      history_text: "",
      context_text: "{}",
      deep_model: "openai/gpt-oss-120b",
      provider_override: provider,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(outcome.tier).toBe("fast");
    expect(outcome.turn?.kind).toBe("task");
    const task = outcome.turn?.kind === "task" ? outcome.turn.tasks[0] : null;
    expect(task?.kind).toBe("financial_query");
    if (task?.kind === "financial_query") {
      expect(task.metric).toBe("expense_amount");
      expect(task.operation).toBe("sum");
      expect(task.periods[0]?.value).toBe("do dia 21 ao dia 27");
    }
    const bridged = bridgeTurnSpecV3ToRuntime(outcome.turn!);
    expect(bridged.ok).toBe(true);
    if (bridged.ok) {
      expect(bridged.contract.mode).toBe("read");
      expect(bridged.contract.action).toBeNull();
    }
  });

  it("usa revisão profunda para escrita", () => {
    const turn: TurnSpecV3 = {
      version: "nino_turn_spec.v3",
      kind: "task",
      act: "new_request",
      response_intent: "execute",
      canonical_request: "Registrar gasto.",
      inherit_topic: false,
      references: [],
      tasks: [{
        kind: "financial_write",
        family: "financial.write",
        action: "transaction.create",
        slots: { amount: "50", merchant: "Mercado" },
      }],
    };
    expect(requiresDeepSemanticReview(turn)).toBe(true);
  });

  it("só libera escrita quando os tiers concordam inclusive nos valores", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(groqStructured(writeTurn("50")))
      .mockResolvedValueOnce(groqStructured(writeTurn("50")));

    const outcome = await interpretWithSingleSemanticAuthorityV3({
      text: "Registra R$50 no mercado",
      deep_model: "openai/gpt-oss-120b",
      provider_override: provider,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome.tier).toBe("reviewed");
    expect(outcome.review_match).toBe(true);
    expect(outcome.turn?.kind).toBe("task");
  });

  it("considera 50 e 50,00 a mesma intenção financeira", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(groqStructured(writeTurn("50")))
      .mockResolvedValueOnce(groqStructured(writeTurn("50,00")));

    const outcome = await interpretWithSingleSemanticAuthorityV3({
      text: "Registra R$50 no mercado",
      deep_model: "openai/gpt-oss-120b",
      provider_override: provider,
    });

    expect(outcome.turn?.kind).toBe("task");
    expect(outcome.review_match).toBe(true);
    expect(outcome.tier).toBe("reviewed");
  });

  it("bloqueia escrita quando os modelos discordam no valor", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(groqStructured(writeTurn("50")))
      .mockResolvedValueOnce(groqStructured(writeTurn("500")));

    const outcome = await interpretWithSingleSemanticAuthorityV3({
      text: "Registra R$50 no mercado",
      deep_model: "openai/gpt-oss-120b",
      provider_override: provider,
    });

    expect(outcome.turn).toBeNull();
    expect(outcome.review_match).toBe(false);
    expect(outcome.telemetry.error).toBe("semantic_tier_disagreement");
    expect(outcome.review_reasons).toContain("task_semantics_mismatch");
  });

  it("429 muda de modelo em vez de repetir cegamente o mesmo tier", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(response({ error: { message: "rate limit" } }, 429))
      .mockResolvedValueOnce(groqStructured(readTurn("este mês")));

    const outcome = await interpretWithSingleSemanticAuthorityV3({
      text: "Quanto eu gastei este mês?",
      deep_model: "openai/gpt-oss-120b",
      provider_override: provider,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const models = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body ?? "{}")).model);
    expect(models).toEqual(["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);
    expect(outcome.turn?.kind).toBe("task");
    expect(outcome.tier).toBe("deep");
  });

  it("ConversationAuthority não possui mais parser/compilador lexical antes do V3", () => {
    const source = readFileSync("supabase/functions/_shared/agent/core/ConversationAuthority.ts", "utf8");
    expect(source).not.toContain("compileDeterministicConversationTurn");
    expect(source).not.toContain("contextualMonthlyChartFastPath");
    expect(source).not.toContain("temporalExpenseFastPath");
    expect(source).not.toContain("safeUndoFastPath");
    expect(source).not.toContain("circuitBreakerTelemetry");
    expect(source).toContain("interpretWithSingleSemanticAuthorityV3");
    expect(source).toContain("no lexical fast-path, parser or V2 circuit breaker may decide meaning first");
  });

  it("AgentCore limita a preempção a contratos fechados e envia o restante ao V3", () => {
    const source = readFileSync("supabase/functions/_shared/agent/core/AgentCoreV2.ts", "utf8");
    expect(source).toContain("const groundedFollowupContract = v3AuthorityEnabled");
    expect(source).toContain("const narrowContract = v3AuthorityEnabled");
    expect(source).toContain("compileDeterministicConversationTurn({ text: brainText, memory })");
    expect(source).toContain(": await interpretConversationTurn({");
    expect(source).toContain("fail-closed deterministic authority");
  });
});
