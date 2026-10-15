import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { decideSplitReply } from "../../supabase/functions/_shared/split/replyTarget";

const now = new Date("2026-10-15T00:49:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const base = { firstName: "Lucas", title: "Ingresso Anitta - Parcela 1", amount: 291.33, now };

// Linha do tempo real: cobrança às 22:00Z, check-in "Um minuto para você" às 22:17Z.
const recent = [
  { kind: "proactive", created_at: ago(2.5) },
  { kind: "split_overdue", created_at: ago(2.8) },
];

describe("resposta a cobrança de rolê", () => {
  it("'Chega' citando a cobrança: pergunta (já paguei / parar lembretes / valor errado), não pausa nada", () => {
    const d = decideSplitReply({ ...base, text: "Chega", hasMedia: false, quotedKind: "split_overdue", recent });
    expect(d.action).toBe("clarify");
    expect((d as { reply: string }).reply).toContain("1️⃣ já paguei");
    expect((d as { reply: string }).reply).toContain("Ingresso Anitta");
  });
  it("'Chega' sem citar, com cobrança e check-in abertos: pergunta de qual assunto", () => {
    const d = decideSplitReply({ ...base, text: "chega", hasMedia: false, quotedKind: null, recent });
    expect(d.action).toBe("clarify");
    expect((d as { reply: string }).reply).toContain("cobrança");
  });
  it("comprovante logo depois da cobrança vai para o pipeline do rolê (não para o Assessor)", () => {
    expect(decideSplitReply({ ...base, text: "", hasMedia: true, quotedKind: null, recent }).action).toBe("participant_pipeline");
    expect(decideSplitReply({ ...base, text: "", hasMedia: true, quotedKind: "split_overdue", recent: [] }).action).toBe("participant_pipeline");
  });
  it("comprovante sem nenhuma cobrança recente segue o fluxo normal (Assessor)", () => {
    expect(decideSplitReply({ ...base, text: "", hasMedia: true, quotedKind: null, recent: [{ kind: "proactive", created_at: ago(1) }] }).action).toBe("pass");
    expect(decideSplitReply({ ...base, text: "", hasMedia: true, quotedKind: null, recent: [{ kind: "split_overdue", created_at: ago(30) }] }).action).toBe("pass");
  });
  it("relato de pagamento e perguntas viram pipeline do rolê", () => {
    expect(decideSplitReply({ ...base, text: "já paguei", hasMedia: false, quotedKind: null, recent }).action).toBe("participant_pipeline");
    expect(decideSplitReply({ ...base, text: "qual o pix?", hasMedia: false, quotedKind: null, recent }).action).toBe("participant_pipeline");
  });
  it("resposta 1/2/3 à pergunta de esclarecimento", () => {
    const withClar = [{ kind: "split_clarification", created_at: ago(0.1) }, ...recent];
    const d = decideSplitReply({ ...base, text: "1", hasMedia: false, quotedKind: null, recent: withClar });
    expect(d).toMatchObject({ action: "participant_pipeline", text: "já paguei" });
    expect(decideSplitReply({ ...base, text: "2", hasMedia: false, quotedKind: null, recent: withClar })).toMatchObject({ text: "para de mandar" });
  });
  it("sem cobrança no contexto, tudo segue como antes", () => {
    expect(decideSplitReply({ ...base, text: "chega", hasMedia: false, quotedKind: null, recent: [{ kind: "proactive", created_at: ago(1) }] }).action).toBe("pass");
  });
});

describe("fiação", () => {
  it("webhook roteia quem tem conta e é participante; histórico do agente enxerga a cobrança", () => {
    const hook = readFileSync("supabase/functions/whatsapp-webhook/index.ts", "utf8");
    expect(hook).toContain("decideSplitReply");
    expect(hook).toContain("supportSplitParticipant(openParticipant");
    expect(hook.indexOf("decideSplitReply({")).toBeLessThan(hook.indexOf("=== MEDIA PATH"));
    expect(readFileSync("supabase/functions/_shared/agent/core/ConversationHistory.ts", "utf8")).toContain('like("kind", "split');
  });

  it("atalho !ja com 'Valor: R$' NÃO vira pergunta sobre a cobrança (bug real do iPhone)", () => {
    const text = "!ja 💳 Registre esse novo gasto que tive\n\nValor: R$ 30,00\nEstabelecimento: A Ventana Itau Ceic\nData:15 de out. de 2026, 07:28\nConta Corrente Itaú";
    const d = decideSplitReply({ ...base, text, hasMedia: false, quotedKind: null, recent });
    expect(d.action).toBe("pass");
  });

  it("pergunta curta continua indo para o rolê, e citar a cobrança continua mandando para o rolê", () => {
    expect(decideSplitReply({ ...base, text: "quanto devo?", hasMedia: false, quotedKind: null, recent }).action).toBe("participant_pipeline");
    expect(decideSplitReply({ ...base, text: "qual o valor?", hasMedia: false, quotedKind: "split_overdue", recent }).action).toBe("participant_pipeline");
    expect(decideSplitReply({ ...base, text: "paguei R$ 20", hasMedia: false, quotedKind: null, recent }).action).toBe("participant_pipeline");
  });

  it("outras formas de registrar gasto também passam", () => {
    for (const text of ["registre um gasto de 45 no mercado", "gastei 30 no almoço #ja", "!ja 42 almoço"]) {
      expect(decideSplitReply({ ...base, text, hasMedia: false, quotedKind: null, recent }).action).toBe("pass");
    }
  });
});
