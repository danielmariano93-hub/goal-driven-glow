import { describe, expect, it } from "vitest";
import { stripVolatileFinancialState } from "../../supabase/functions/_shared/agent/core/MemoryStore";
import { serializeBrainUserContext } from "../../supabase/functions/_shared/agent/core/BrainUserContext";
import { DEFAULT_PREFS } from "../../supabase/functions/_shared/agent/core/PersonalizationEngine";
import { detectResponsePreference } from "../../supabase/functions/_shared/agent/core/ResponsePreferenceLearning";

describe("Nino durable conversation memory safety", () => {
  it("removes live financial values recursively instead of persisting stale truth", () => {
    const out = stripVolatileFinancialState({
      preference: "respostas diretas",
      nested: {
        amount: 199.9,
        balance: 4300,
        category: "Alimentação",
        deeper: { invoice_total: 550 },
      },
      correction_text: "não era isso; meu saldo era 4300 e a fatura R$ 550,00",
    });

    expect(out.value.preference).toBe("respostas diretas");
    expect(out.value.nested).toEqual({ category: "Alimentação", deeper: {} });
    expect(String(out.value.correction_text)).not.toContain("4300");
    expect(String(out.value.correction_text)).not.toContain("550,00");
    expect(out.dropped).toEqual(expect.arrayContaining([
      "nested.amount", "nested.balance", "nested.deeper.invoice_total",
    ]));
  });

  it("Brain context carries durable preferences but not volatile money", () => {
    const context = serializeBrainUserContext(
      { ...DEFAULT_PREFS, verbosity: "concise", suggestion_frequency: "low" },
      [{
        id: "m1",
        user_id: "u1",
        kind: "correction",
        key: "correction:test",
        value: { text: "prefiro comparar meses fechados", amount: 5000, nested: { balance: 9000 } },
        confidence: 1,
        source: "user",
        use_count: 0,
        last_used_at: null,
        created_at: "2026-09-17T00:00:00Z",
        updated_at: "2026-09-17T00:00:00Z",
      }],
    );

    expect(context).toContain('"verbosity":"concise"');
    expect(context).toContain('"suggestion_frequency":"low"');
    expect(context).toContain("prefiro comparar meses fechados");
    expect(context).not.toContain("5000");
    expect(context).not.toContain("9000");
  });

  it("learns only explicit meta-preferences about how Nino should answer", () => {
    expect(detectResponsePreference("Prefiro respostas curtas e diretas")).toMatchObject({
      patch: { verbosity: "concise" },
    });
    expect(detectResponsePreference("Não precisa sugerir próximos passos, só responda")).toMatchObject({
      patch: { suggestion_frequency: "low" },
    });
    expect(detectResponsePreference("quero gastar menos no mês que vem")).toBeNull();
  });
});
