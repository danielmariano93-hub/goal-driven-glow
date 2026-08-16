import { describe, it, expect } from "vitest";
import { parseAmountInWords, parseSpelledMoney } from "../../supabase/functions/_shared/agent/amountWords.ts";
import { interpret } from "../../supabase/functions/_shared/agent/parser.ts";
import { classifyCapability, resumeDeterministicCapability, hasEntryIntent } from "../../supabase/functions/_shared/agent/core/CapabilityRouter.ts";
import { validate, entryFailureMessage } from "../../supabase/functions/_shared/agent/core/ResponseValidator.ts";
import { inferDraftType } from "../../supabase/functions/_shared/agent/tools.ts";

describe("valor por extenso (pt-BR)", () => {
  it("lê reais e centavos", () => {
    expect(parseAmountInWords("cinquenta reais e quarenta centavos")).toBe(50.4);
    expect(parseAmountInWords("quinze reais e cinquenta centavos")).toBe(15.5);
    expect(parseAmountInWords("um real e noventa e nove centavos")).toBe(1.99);
  });

  it("lê centenas, milhares e 'meio real'", () => {
    expect(parseAmountInWords("cem reais")).toBe(100);
    expect(parseAmountInWords("duzentos e cinquenta reais")).toBe(250);
    expect(parseAmountInWords("mil e duzentos reais")).toBe(1200);
    expect(parseAmountInWords("dois mil reais")).toBe(2000);
    expect(parseAmountInWords("meio real")).toBe(0.5);
  });

  it("só aceita extenso com marcador monetário", () => {
    expect(parseSpelledMoney("quero uma dica")).toBeNull();
    expect(parseSpelledMoney("me manda um resumo")).toBeNull();
    expect(parseSpelledMoney("cinquenta reais")).toBe(50);
  });
});

describe("interpretação do lançamento falado", () => {
  it("reconhece o caso do KFC", () => {
    const parsed = interpret("registre esse lançamento de cinquenta reais e quarenta centavos feitos no KFC hoje");
    expect(parsed.kind).toBe("transaction");
    expect((parsed as any).amount).toBe(50.4);
    expect((parsed as any).type).toBe("expense");
  });

  it("mantém confirmação curta como confirmação", () => {
    expect(interpret("Confirmo").kind).toBe("confirm");
    expect(interpret("sim").kind).toBe("confirm");
  });
});

describe("roteamento de registro", () => {
  it("exige ferramenta de rascunho quando há valor", () => {
    const text = "registre cinquenta reais e quarenta centavos no KFC hoje";
    const decision = classifyCapability(text, interpret(text), null);
    expect(decision.name).toBe("transaction_entry");
    expect(decision.required_tool).toBe("create_transaction_draft");
  });

  it("mantém pedido sem valor na rota de lançamento", () => {
    const text = "registra um lançamento aí pra mim";
    const decision = classifyCapability(text, interpret(text), null);
    expect(decision.name).toBe("transaction_entry");
  });

  it("não confunde pergunta analítica com registro", () => {
    expect(hasEntryIntent("quanto gastei em alimentação?")).toBe(false);
    expect(hasEntryIntent("registre 50 no mercado")).toBe(true);
  });

  it("retoma o lançamento quando o usuário responde a categoria", () => {
    const resumed = resumeDeterministicCapability(
      "Alimentação",
      interpret("Alimentação"),
      "registre cinquenta reais e quarenta centavos no KFC hoje",
    );
    expect(resumed?.name).toBe("transaction_entry");
    expect(resumed?.required_tool).toBe("create_transaction_draft");
  });
});

describe("tipo do lançamento é inferido", () => {
  it("assume despesa em pedidos de gasto", () => {
    expect(inferDraftType(undefined, "registre 50,40 no KFC hoje")).toBe("expense");
    expect(inferDraftType(undefined, "paguei o boleto")).toBe("expense");
  });
  it("detecta receita", () => {
    expect(inferDraftType(undefined, "recebi meu salário hoje")).toBe("income");
  });
  it("respeita o tipo informado", () => {
    expect(inferDraftType("income", "gastei no mercado")).toBe("income");
  });
});

describe("cartão de rascunho não pode ser inventado", () => {
  it("bloqueia cartão em prosa sem ferramenta", () => {
    const result = validate("Certo! Rascunhei aqui: R$ 50,40 — KFC. Confirma?", {
      entryTurn: true,
      hasSuccessfulMutation: false,
      hasDraft: false,
    });
    expect(result.reasons.join(",")).toContain("hallucinated_draft_card");
    expect(result.body).not.toContain("Rascunhei");
  });

  it("mensagem de falha diz exatamente o que faltou", () => {
    expect(entryFailureMessage([{ tool_name: "create_transaction_draft", ok: false, error: "needs_amount" } as any]))
      .toMatch(/valor/i);
    expect(entryFailureMessage([{ tool_name: "create_transaction_draft", ok: false, error: "needs_type" } as any]))
      .toMatch(/gasto ou um recebimento/i);
    expect(entryFailureMessage()).not.toMatch(/algo deu errado/i);
  });
});
