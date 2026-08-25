// Contrato do `nino_context.v1` + `nino_safety.v1`:
//  - resposta curta depois de um lançamento sem categoria É a categoria;
//  - nenhum texto para o usuário menciona infraestrutura (créditos, provedor,
//    status HTTP, "responsável pelo app");
//  - degradação de IA nunca vira mensagem de cobrança.
import { describe, it, expect } from "vitest";
import {
  classifyUserSafe, leaksInfrastructure, sanitizeUserFacingText, userSafeMessage,
  USER_SAFE_MESSAGES,
} from "../../supabase/functions/_shared/agent/core/UserSafeError";
import {
  readCategoryAnswer, normalizeCategoryName, categorySlug, titleizeCategory,
} from "../../supabase/functions/_shared/agent/core/PendingAction";
import {
  amountFromQuotedBody, resolveQuoted,
} from "../../supabase/functions/_shared/messaging/wahaInbound";
import { friendlyFor } from "../../supabase/functions/_shared/agent/core/ErrorRecovery";
import { aiBlockReply } from "../../supabase/functions/_shared/aiCircuit";

describe("P0 — contexto: resposta curta é a categoria do lançamento pendente", () => {
  it("“Beleza” depois do recibo é lida como categoria", () => {
    const answer = readCategoryAnswer("Beleza", true);
    expect(answer).not.toBeNull();
    expect(answer!.name).toBe("Beleza");
    expect(answer!.explicit).toBe(false);
  });

  it("sem lançamento pendente, “Beleza” NÃO vira categoria", () => {
    expect(readCategoryAnswer("Beleza", false)).toBeNull();
  });

  it("acknowledgements nunca são categoria", () => {
    for (const t of ["ok", "Sim", "obrigado", "valeu", "certo", "isso", "pode"]) {
      expect(readCategoryAnswer(t, true), t).toBeNull();
    }
  });

  it("mensagem com valor/pergunta nunca é categoria", () => {
    expect(readCategoryAnswer("gastei 50 no mercado", true)).toBeNull();
    expect(readCategoryAnswer("quanto gastei este mês?", true)).toBeNull();
    expect(readCategoryAnswer("R$ 42,90", true)).toBeNull();
  });

  it("pedido explícito de criação é reconhecido mesmo sem pendência de contexto", () => {
    const a = readCategoryAnswer("Nino, cria a categoria beleza e registre", false);
    expect(a).toMatchObject({ name: "beleza", explicit: true, create: true });
  });

  it("atribuição explícita (“coloca em Lazer”) é reconhecida", () => {
    const a = readCategoryAnswer("coloca isso em Lazer", false);
    expect(a).toMatchObject({ explicit: true, create: false });
    expect(a!.name.toLowerCase()).toBe("lazer");
    expect(readCategoryAnswer("categoriza como Beleza", false)?.name).toBe("Beleza");
  });

  it("normalização de nome ignora acento e caixa; slug é estável", () => {
    expect(normalizeCategoryName("Alimentação")).toBe(normalizeCategoryName("alimentacao"));
    expect(categorySlug("Cuidados Pessoais")).toBe("cuidados-pessoais");
    expect(titleizeCategory("beleza")).toBe("Beleza");
  });
});

describe("P0 — resposta citada do WhatsApp vira sinal estruturado", () => {
  it("extrai id e valor citados do payload WAHA", () => {
    const payload = {
      _data: { quotedMsg: { id: "ABC123", body: "Despesa registrada • R$ 42,90 na Adega" } },
    };
    const quoted = resolveQuoted(payload);
    expect(quoted?.message_id).toBe("ABC123");
    expect(amountFromQuotedBody(quoted?.body)).toBeCloseTo(42.9, 2);
  });

  it("extrai contexto no formato contextInfo (NOWEB)", () => {
    const payload = {
      message: {
        extendedTextMessage: {
          text: "Beleza",
          contextInfo: { stanzaId: "XYZ", quotedMessage: { conversation: "Registrei R$ 1.250,00" } },
        },
      },
    };
    const quoted = resolveQuoted(payload);
    expect(quoted?.message_id).toBe("XYZ");
    expect(amountFromQuotedBody(quoted?.body)).toBeCloseTo(1250, 2);
  });

  it("mensagem sem citação não produz contexto", () => {
    expect(resolveQuoted({ body: "oi" })).toBeUndefined();
    expect(amountFromQuotedBody(null)).toBeNull();
  });
});

describe("P0 — nenhum texto ao usuário expõe infraestrutura", () => {
  const userFacing = [
    ...Object.values(USER_SAFE_MESSAGES),
    aiBlockReply({ status: 402, requires: "top_up", message: "" }),
    aiBlockReply({ status: 403, requires: "admin_action", message: "" }),
    friendlyFor(new Error("gateway_402 payment required")),
    friendlyFor(new Error("gateway_403 blocked")),
    userSafeMessage(new Error("402 insufficient credits")),
  ];

  it("catálogo de mensagens é limpo", () => {
    for (const text of userFacing) {
      expect(leaksInfrastructure(text), text).toBe(false);
    }
  });

  it("402/403 recebem o MESMO texto neutro (nada de cobrança)", () => {
    expect(aiBlockReply({ status: 402, requires: "top_up", message: "" }))
      .toBe(USER_SAFE_MESSAGES.AI_TEMPORARY_UNAVAILABLE);
    expect(aiBlockReply({ status: 403, requires: "admin_action", message: "" }))
      .toBe(USER_SAFE_MESSAGES.AI_TEMPORARY_UNAVAILABLE);
  });

  it("guarda de saída substitui qualquer vazamento", () => {
    const leaked = "Os créditos do app acabaram, o responsável pelo app precisa reativar.";
    expect(leaksInfrastructure(leaked)).toBe(true);
    expect(sanitizeUserFacingText(leaked)).toBe(USER_SAFE_MESSAGES.AI_TEMPORARY_UNAVAILABLE);
    expect(sanitizeUserFacingText("Erro no gateway do provider (HTTP 402)"))
      .toBe(USER_SAFE_MESSAGES.AI_TEMPORARY_UNAVAILABLE);
  });

  it("assunto legítimo do produto NÃO é bloqueado pela guarda", () => {
    const ok = [
      "Registrei R$ 42,90 no cartão de crédito Nubank. ✅",
      "Sua fatura fecha dia 28 e vence dia 5.",
      "Você tem R$ 300,00 de crédito disponível na conta.",
      "Foram 3 parcelas de R$ 100,00 no crédito.",
      "Você gastou R$ 500,00 em Mercado neste mês.",
      "Sobraram R$ 402,00 até o fechamento.",
      "Sua meta subiu 429 reais em agosto.",
      "Total de 503 lançamentos no período.",
    ];
    for (const text of ok) {
      expect(leaksInfrastructure(text), text).toBe(false);
      expect(sanitizeUserFacingText(text)).toBe(text);
    }
  });

  it("número com contexto HTTP ainda é bloqueado", () => {
    for (const text of ["Falhou com status 402", "erro 503 ao processar", "retornou HTTP 500"]) {
      expect(leaksInfrastructure(text), text).toBe(true);
    }
  });


  it("classificação segura cobre as famílias de erro", () => {
    expect(classifyUserSafe(new Error("gateway_402"))).toBe("AI_TEMPORARY_UNAVAILABLE");
    expect(classifyUserSafe(new Error("rate limit 429"))).toBe("AI_TEMPORARY_UNAVAILABLE");
    expect(classifyUserSafe(new Error("permission denied by rls"))).toBe("PERMISSION_ERROR");
    expect(classifyUserSafe(new Error("not_found"))).toBe("NOT_FOUND");
    expect(classifyUserSafe(new Error("missing required field"))).toBe("VALIDATION_ERROR");
  });
});
