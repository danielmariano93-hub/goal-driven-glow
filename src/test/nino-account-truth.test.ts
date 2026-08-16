import { describe, it, expect } from "vitest";
import { parseStructuredCard, interpret } from "../../supabase/functions/_shared/agent/parser.ts";
import { validate, entryFailureMessage, PERSONA_INVERSION_RX } from "../../supabase/functions/_shared/agent/core/ResponseValidator.ts";

describe("cartão colado é lido deterministicamente", () => {
  const card = [
    "• *Despesa:* R$ 50,40",
    "• *Descrição:* KFC",
    "• *Categoria:* Alimentação",
    "• *Data:* 16/08/2026",
  ].join("\n");

  it("extrai valor, descrição, categoria e data", () => {
    const parsed = parseStructuredCard(card);
    expect(parsed?.amount).toBe(50.4);
    expect(parsed?.description).toBe("KFC");
    expect(parsed?.category_hint).toBe("Alimentação");
    expect(parsed?.occurred_at).toBe("2026-08-16");
    expect(parsed?.type).toBe("expense");
  });

  it("entra no interpretador como transação", () => {
    const parsed = interpret("Registre essa despesa\n" + card);
    expect(parsed.kind).toBe("transaction");
    expect((parsed as any).amount).toBe(50.4);
  });

  it("lê receita e conta quando presentes", () => {
    const parsed = parseStructuredCard("• Receita: R$ 1.200,00\n• Descrição: Salário\n• Conta: Banco Itau");
    expect(parsed?.type).toBe("income");
    expect(parsed?.amount).toBe(1200);
    expect(parsed?.account_hint).toBe("Banco Itau");
  });

  it("ignora texto que não é cartão", () => {
    expect(parseStructuredCard("gastei 50 no mercado")).toBeNull();
  });
});

describe("falha de conta responde com nomes reais", () => {
  it("lista as contas do usuário", () => {
    const msg = entryFailureMessage([
      { tool_name: "create_transaction_draft", ok: false, error: "account_not_found", result: { accounts: ["Banco Itau", "Nubank"] } } as any,
    ]);
    expect(msg).toContain("Banco Itau");
    expect(msg).toContain("Nubank");
    expect(msg).not.toMatch(/algo deu errado/i);
  });

  it("pergunta genérica quando não há lista", () => {
    const msg = entryFailureMessage([
      { tool_name: "create_transaction_draft", ok: false, error: "account_not_found" } as any,
    ]);
    expect(msg).toMatch(/qual conta/i);
  });
});

describe("guarda de persona invertida", () => {
  it("detecta o agente falando como usuário", () => {
    expect(PERSONA_INVERSION_RX.test("Ah, Nino! Esqueci de perguntar em qual conta foi esse gasto.")).toBe(true);
    expect(PERSONA_INVERSION_RX.test("Nino, preciso registrar isso")).toBe(true);
    expect(PERSONA_INVERSION_RX.test("Registrei seu gasto no Banco Itau.")).toBe(false);
  });

  it("substitui a resposta invertida pela determinística", () => {
    const result = validate("Ah, Nino! Esqueci de perguntar em qual conta foi esse gasto.", {
      entryTurn: true,
      hasSuccessfulMutation: false,
      toolCalls: [
        { tool_name: "create_transaction_draft", ok: false, error: "account_not_found", result: { accounts: ["Banco Itau"] } } as any,
      ],
    });
    expect(result.reasons).toContain("persona_inversion");
    expect(result.body).toContain("Banco Itau");
  });
});

describe("turno de lançamento com ferramenta falha nunca sai em prosa", () => {
  it("troca a prosa pela pergunta determinística", () => {
    const result = validate("Você poderia me dizer em qual conta ficou esse valor, por gentileza?", {
      entryTurn: true,
      hasSuccessfulMutation: false,
      toolCalls: [
        { tool_name: "create_transaction_draft", ok: false, error: "account_not_found", result: { accounts: ["Banco Itau", "Nubank"] } } as any,
      ],
    });
    expect(result.reasons).toContain("entry_tool_failed");
    expect(result.body).toBe("Em qual conta eu registro? (Banco Itau, Nubank)");
  });
});
