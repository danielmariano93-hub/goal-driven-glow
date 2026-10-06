import { describe, expect, it } from "vitest";
import {
  coalesceWindowFromEnv,
  planCoalescing,
  resolveInboundTurn,
  type InboundRow,
} from "../../supabase/functions/_shared/messaging/inboundCoalescing";

const t0 = Date.parse("2026-10-06T18:09:20Z");
const row = (id: string, sec: number, body: string, over: Partial<InboundRow> = {}): InboundRow => ({
  id, body, received_at: new Date(t0 + sec * 1000).toISOString(), processed_at: null, ignored_reason: null, has_media: false, ...over,
});

describe("rajada de mensagens vira um turno", () => {
  it("caso real: duas mensagens seguidas → a primeira cede, a segunda responde com as duas", () => {
    const rows = [row("a", 0, "Nino estou desesperado"), row("b", 1, "Como bloqueio meus gastos")];
    expect(planCoalescing(rows, "a", 2500)).toEqual({ role: "follower", leaderHint: "b" });
    const leader = planCoalescing(rows, "b", 2500);
    expect(leader).toEqual({ role: "leader", text: "Nino estou desesperado\nComo bloqueio meus gastos", mergedIds: ["a"] });
  });

  it("mensagem isolada responde sozinha", () => {
    expect(planCoalescing([row("a", 0, "gastei 30 no mercado")], "a", 2500))
      .toEqual({ role: "leader", text: "gastei 30 no mercado", mergedIds: [] });
  });

  it("mensagem antiga já respondida não entra na rajada nova", () => {
    const rows = [row("old", -60, "oi", { processed_at: "x" }), row("a", 0, "quanto gastei?")];
    expect(planCoalescing(rows, "a", 2500)).toMatchObject({ role: "leader", text: "quanto gastei?", mergedIds: [] });
  });

  it("turno anterior ainda em andamento (fora da janela) não é refeito", () => {
    const rows = [row("a", 0, "gastei 30"), row("b", 4, "e 20 no uber")];
    expect(planCoalescing(rows, "b", 2500)).toMatchObject({ role: "leader", text: "e 20 no uber", mergedIds: [] });
  });

  it("três mensagens: só a última responde, com tudo na ordem", () => {
    const rows = [row("a", 0, "oi"), row("b", 1, "preciso de ajuda"), row("c", 2, "com meus gastos")];
    expect(planCoalescing(rows, "a", 2500).role).toBe("follower");
    expect(planCoalescing(rows, "b", 2500).role).toBe("follower");
    expect(planCoalescing(rows, "c", 2500)).toMatchObject({ role: "leader", text: "oi\npreciso de ajuda\ncom meus gastos" });
  });

  it("seguidoras já marcadas continuam ligadas à rajada, mesmo que a janela tenha passado", () => {
    const rows = [
      row("a", 0, "oi", { processed_at: "x", ignored_reason: "coalesced:b" }),
      row("b", 3, "preciso de ajuda", { processed_at: "x", ignored_reason: "coalesced:c" }),
      row("c", 6, "com meus gastos"),
    ];
    expect(planCoalescing(rows, "c", 2500)).toMatchObject({ role: "leader", text: "oi\npreciso de ajuda\ncom meus gastos" });
  });

  it("seguidora marcada para OUTRO líder não é reaproveitada", () => {
    const rows = [row("a", 0, "oi", { processed_at: "x", ignored_reason: "coalesced:zzz" }), row("c", 9, "novo assunto")];
    expect(planCoalescing(rows, "c", 2500)).toMatchObject({ text: "novo assunto", mergedIds: [] });
  });

  it("mídia nunca é fundida nem faz a anterior ceder", () => {
    const rows = [row("a", 0, "olha isso"), row("m", 1, "", { has_media: true })];
    expect(planCoalescing(rows, "a", 2500).role).toBe("leader");
  });

  it("teto de mensagens fundidas", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`m${i}`, i * 0.5, `msg ${i}`));
    const plan = planCoalescing(rows, "m9", 2500);
    expect(plan.role).toBe("leader");
    if (plan.role === "leader") expect(plan.mergedIds.length).toBe(5);
  });

  it("janela configurável e protegida contra valor inválido", () => {
    expect(coalesceWindowFromEnv(undefined)).toBe(2500);
    expect(coalesceWindowFromEnv("0")).toBe(0);
    expect(coalesceWindowFromEnv("1500")).toBe(1500);
    expect(coalesceWindowFromEnv("abc")).toBe(2500);
    expect(coalesceWindowFromEnv("999999")).toBe(2500);
  });
});

// Banco em memória: dois webhooks concorrentes leem e gravam a mesma tabela.
function fakeDb(initial: InboundRow[]) {
  const rows = initial.map((r) => ({ ...r }));
  const sb = {
    from: () => ({
      select: () => ({
        eq: () => ({ gte: () => ({ order: () => ({ limit: async () => ({ data: rows.map((r) => ({ ...r })), error: null }) }) }) }),
      }),
      update: (patch: Partial<InboundRow>) => ({
        eq: (_c: string, id: string) => ({
          is: async () => {
            const r = rows.find((x) => x.id === id);
            if (r && r.processed_at === null) Object.assign(r, patch);
            return { error: null };
          },
        }),
      }),
    }),
  };
  return { sb, rows };
}

describe("resolveInboundTurn — webhooks concorrentes", () => {
  it("duas mensagens em paralelo geram exatamente uma resposta (a do líder)", async () => {
    const { sb, rows } = fakeDb([row("a", 0, "Nino estou desesperado"), row("b", 1, "Como bloqueio meus gastos")]);
    const common = { fromPhone: "5511", hasMedia: false, windowMs: 2500, sleep: async () => {}, now: () => t0 + 5000 };
    const [ra, rb] = await Promise.all([
      resolveInboundTurn(sb, { ...common, inboundId: "a", ownBody: "Nino estou desesperado" }),
      resolveInboundTurn(sb, { ...common, inboundId: "b", ownBody: "Como bloqueio meus gastos" }),
    ]);
    expect(ra.role).toBe("follower");
    expect(rb).toMatchObject({ role: "leader", text: "Nino estou desesperado\nComo bloqueio meus gastos" });
    expect(rows.find((r) => r.id === "a")?.ignored_reason).toBe("coalesced:b");
    expect([ra, rb].filter((r) => r.role === "leader").length).toBe(1);
  });

  it("falha de leitura nunca bloqueia: responde com o próprio texto", async () => {
    const sb = { from: () => { throw new Error("db down"); } };
    const r = await resolveInboundTurn(sb, { fromPhone: "x", inboundId: "a", ownBody: "oi", hasMedia: false, sleep: async () => {} });
    expect(r).toEqual({ role: "leader", text: "oi", mergedIds: [] });
  });

  it("janela 0 desliga a fusão", async () => {
    const r = await resolveInboundTurn({ from: () => { throw new Error("não deveria ler"); } }, { fromPhone: "x", inboundId: "a", ownBody: "oi", hasMedia: false, windowMs: 0 });
    expect(r.role).toBe("leader");
  });
});
