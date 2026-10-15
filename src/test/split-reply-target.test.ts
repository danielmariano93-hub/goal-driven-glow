import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { decideSplitReply } from "../../supabase/functions/_shared/split/replyTarget";
import type { AddresseeReader, AddresseeReading } from "../../supabase/functions/_shared/split/inboundAddressee";
import { parseAddressee } from "../../supabase/functions/_shared/split/inboundAddressee";

const now = new Date("2026-10-15T10:28:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const base = { firstName: "Lucas", title: "Mc pro macarrazinho das desculpas", amount: 20, now };
// Linha do tempo real: cobrança de ontem 22:00Z (≈12h antes) abre o contexto do rolê.
const recent = [{ kind: "split_overdue", created_at: ago(12) }];

const reading = (addressee: AddresseeReading["addressee"], confidence: number, source: AddresseeReading["source"] = "llm"): AddresseeReading =>
  ({ version: "inbound_addressee.v1", addressee, confidence, reason: "", source, latency_ms: 1, error: source === "llm" ? null : "down" });
const reader = (r: AddresseeReading): AddresseeReader => vi.fn(async () => r);

const SHORTCUT = "!ja 💳 Registre esse novo gasto que tive\n\nValor: R$ 30,00\nEstabelecimento: A Ventana Itau Ceic\nData:15 de out. de 2026, 07:28\nConta Corrente Itaú";

describe("roteamento rolê × finanças próprias (entendimento, não palavra-chave)", () => {
  it("comando explícito do produto nunca é desviado — e o modelo nem é consultado", async () => {
    const r = reader(reading("split_charge", 0.99));
    const d = await decideSplitReply({ ...base, text: SHORTCUT, hasMedia: false, quotedKind: null, recent, explicitCommand: true, readAddressee: r });
    expect(d.action).toBe("pass");
    expect(d.evidence.basis).toBe("explicit_command");
    expect(r).not.toHaveBeenCalled();
  });

  it("registro de gasto sem atalho: quem decide é a leitura do modelo (own_finance → fluxo normal)", async () => {
    const d = await decideSplitReply({ ...base, text: SHORTCUT.replace("!ja ", ""), hasMedia: false, quotedKind: null, recent, readAddressee: reader(reading("own_finance", 0.97)) });
    expect(d.action).toBe("pass");
    expect(d.evidence.basis).toBe("understanding");
  });

  it("o contexto do rolê (valor pendente, vencimento, mensagens recentes) é entregue ao modelo", async () => {
    const r = vi.fn(async () => reading("own_finance", 0.9));
    await decideSplitReply({ ...base, text: "gastei 40 no mercado", hasMedia: false, quotedKind: null, recent, dueDate: "2026-08-02", readAddressee: r });
    expect(r).toHaveBeenCalledWith(expect.objectContaining({
      text: "gastei 40 no mercado",
      split: { title: base.title, pending_amount: 20, due_date: "2026-08-02" },
      recent_bot: [{ kind: "split_overdue", hours_ago: 12 }],
    }));
  });

  it("pergunta sobre a cobrança só vai para o rolê com confiança alta", async () => {
    const hi = await decideSplitReply({ ...base, text: "quanto eu devo mesmo?", hasMedia: false, quotedKind: null, recent, readAddressee: reader(reading("split_charge", 0.93)) });
    expect(hi.action).toBe("participant_pipeline");
    const lo = await decideSplitReply({ ...base, text: "quanto eu devo mesmo?", hasMedia: false, quotedKind: null, recent, readAddressee: reader(reading("split_charge", 0.6)) });
    expect(lo.action).toBe("clarify");
  });

  it("incerteza real vira pergunta, nunca palpite", async () => {
    const d = await decideSplitReply({ ...base, text: "chega", hasMedia: false, quotedKind: null, recent, readAddressee: reader(reading("unclear", 0.4)) });
    expect(d.action).toBe("clarify");
    if (d.action === "clarify") expect(d.reply).toContain(base.title);
  });

  it("modelo indisponível ou sem leitor: fluxo normal (nunca o do rolê)", async () => {
    const down = await decideSplitReply({ ...base, text: "quanto devo?", hasMedia: false, quotedKind: null, recent, readAddressee: reader(reading("unclear", 0, "unavailable")) });
    expect(down.action).toBe("pass");
    expect(down.evidence.basis).toBe("understanding_unavailable");
    const none = await decideSplitReply({ ...base, text: "quanto devo?", hasMedia: false, quotedKind: null, recent });
    expect(none.action).toBe("pass");
  });

  it("sinais explícitos do rolê continuam valendo: citar a cobrança e responder à pergunta do Nino", async () => {
    const r = reader(reading("own_finance", 0.99));
    const quoted = await decideSplitReply({ ...base, text: "qualquer coisa", hasMedia: false, quotedKind: "split_overdue", recent, readAddressee: r });
    expect(quoted.action).toBe("participant_pipeline");
    const receipt = await decideSplitReply({ ...base, text: "", hasMedia: true, quotedKind: "split_overdue", recent, readAddressee: r });
    expect(receipt.action).toBe("participant_pipeline");
    const answer = await decideSplitReply({ ...base, text: "2", hasMedia: false, quotedKind: null, recent: [{ kind: "split_clarification", created_at: ago(0.1) }], readAddressee: r });
    expect(answer).toMatchObject({ action: "participant_pipeline", text: "para de mandar" });
    expect(r).not.toHaveBeenCalled();
  });

  it("sem contexto de cobrança recente, nada é desviado e o modelo nem é chamado", async () => {
    const r = reader(reading("split_charge", 0.99));
    const d = await decideSplitReply({ ...base, text: "quanto devo?", hasMedia: false, quotedKind: null, recent: [{ kind: "agent", created_at: ago(1) }], readAddressee: r });
    expect(d.action).toBe("pass");
    expect(r).not.toHaveBeenCalled();
  });

  it("arquivo sem citar a cobrança não é adivinhado como comprovante do rolê", async () => {
    const d = await decideSplitReply({ ...base, text: "", hasMedia: true, quotedKind: null, recent, readAddressee: reader(reading("split_charge", 0.99)) });
    expect(d.action).toBe("pass");
  });
});

describe("saída do leitor", () => {
  it("valida o contrato e descarta lixo", () => {
    expect(parseAddressee('{"addressee":"own_finance","confidence":0.9,"reason":"registro de gasto"}')).toMatchObject({ addressee: "own_finance", confidence: 0.9 });
    expect(parseAddressee('{"addressee":"banana","confidence":1}')).toBeNull();
    expect(parseAddressee("não é json")).toBeNull();
    expect(parseAddressee('{"addressee":"split_charge","confidence":7}')?.confidence).toBe(1);
  });
});

describe("guarda de arquitetura: palavra-chave não decide destino", () => {
  const router = readFileSync("supabase/functions/_shared/split/replyTarget.ts", "utf8");
  const webhook = readFileSync("supabase/functions/whatsapp-webhook/index.ts", "utf8");

  it("o roteador não importa nem usa o classificador por palavras do pipeline do rolê", () => {
    expect(router).not.toMatch(/detectParticipantIntent/);
    expect(router).not.toMatch(/AMBIGUOUS_STOP|looksLikeExpenseLog/);
  });

  it("o webhook consulta o comando explícito e o leitor de entendimento antes de desviar para o rolê", () => {
    expect(webhook).toMatch(/explicitCommand:\s*detectFastLog\(/);
    expect(webhook).toMatch(/readAddressee:\s*makeAddresseeReader\(/);
    expect(webhook).toMatch(/await decideSplitReply\(/);
  });

  it("toda decisão registra a base (explícito/entendimento/falha segura) para auditoria", () => {
    expect(webhook).toMatch(/basis:\s*decision\.evidence\.basis/);
  });
});
