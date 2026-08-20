import { describe, expect, it } from "vitest";
import {
  classifyOutcome,
  isAnswerable,
  isClarification,
} from "../../supabase/functions/_shared/agent/core/ToolOutcome";
import { entryFailureMessage } from "../../supabase/functions/_shared/agent/core/ResponseValidator";

describe("ToolOutcome universal", () => {
  it("sucesso é SUCCESS e nunca pede clarificação", () => {
    const outcome = classifyOutcome({ ok: true, result: { transaction_id: "t1" } });
    expect(outcome.kind).toBe("SUCCESS");
    expect(isClarification(outcome.kind)).toBe(false);
  });

  it("falta de valor é pergunta, não falha técnica", () => {
    const outcome = classifyOutcome({ ok: false, error: "needs_amount" });
    expect(outcome.kind).toBe("NEEDS_INPUT");
    expect(outcome.field).toBe("amount");
    expect(outcome.ask).toMatch(/valor/i);
    expect(isAnswerable(outcome.kind)).toBe(true);
  });

  it("emoção não reconhecida vira NEEDS_INPUT(emotion)", () => {
    const outcome = classifyOutcome({ ok: false, error: "emotion_not_recognized" });
    expect(outcome.kind).toBe("NEEDS_INPUT");
    expect(outcome.field).toBe("emotion");
  });

  it("conta ambígua lista as opções reais", () => {
    const outcome = classifyOutcome({
      ok: false,
      error: "account_not_found",
      result: { accounts: ["Banco Itau", { name: "Nubank" }] },
    });
    expect(outcome.field).toBe("account");
    expect(outcome.options).toEqual(["Banco Itau", "Nubank"]);
    expect(outcome.ask).toBe("Em qual conta eu registro? (Banco Itau, Nubank)");
  });

  it("período vazio é resposta legítima, não erro", () => {
    const outcome = classifyOutcome({ ok: false, error: "no_data" });
    expect(outcome.kind).toBe("EMPTY_STATE");
    expect(isAnswerable(outcome.kind)).toBe(true);
    expect(isClarification(outcome.kind)).toBe(false);
  });

  it("erro desconhecido continua sendo falha técnica", () => {
    const outcome = classifyOutcome({ ok: false, error: "tool_timeout_10000ms" });
    expect(outcome.kind).toBe("TECHNICAL_FAILURE");
    expect(isAnswerable(outcome.kind)).toBe(false);
  });

  it("mensagem de lançamento reaproveita a clarificação do outcome", () => {
    const message = entryFailureMessage([
      { step_index: 1, tool_name: "create_transaction_draft", args: {}, result: null, ok: false, duration_ms: 1, error: "needs_amount" } as never,
    ]);
    expect(message).toMatch(/valor/i);
  });
});
