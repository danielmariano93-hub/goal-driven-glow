import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  handleWeekendReply,
  loadAcceptedCommitments,
  matchWeekendReply,
  persistWeekendOffer,
  recordCommitmentOutcomes,
} from "../../supabase/functions/_shared/proactive/weekendCommitments";
import { buildWeekendForecasts } from "../../supabase/functions/_shared/proactive/weekendForecast";
import { composeWeekendMessage } from "../../supabase/functions/_shared/proactive/weekendMessages";
import { buildWeekendRecaps, weekendRecapSituation } from "../../supabase/functions/_shared/proactive/weekendRecap";
import { renderWhatsappMessage } from "../../supabase/functions/_shared/agent/core/MessageContract";

type Row = Record<string, any>;

/** Banco em memória com a API encadeada do supabase-js que o módulo usa. */
function fakeDb(initial: Row[] = []) {
  const rows: Row[] = [...initial];
  const query = (filters: Array<(r: Row) => boolean> = [], orders: Array<[string, boolean]> = [], max = 1000) => {
    const q: any = {
      eq: (k: string, v: any) => query([...filters, (r) => r[k] === v], orders, max),
      gte: (k: string, v: any) => query([...filters, (r) => r[k] >= v], orders, max),
      in: (k: string, vs: any[]) => query([...filters, (r) => vs.includes(r[k])], orders, max),
      not: (k: string, _op: string, _v: any) => query([...filters, (r) => r[k] != null], orders, max),
      order: (k: string, o: { ascending: boolean }) => query(filters, [...orders, [k, o.ascending]], max),
      limit: (n: number) => query(filters, orders, n),
      then: (resolve: any) => {
        let out = rows.filter((r) => filters.every((f) => f(r)));
        for (const [k, asc] of [...orders].reverse()) out = out.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1));
        resolve({ data: out.slice(0, max), error: null });
      },
    };
    return q;
  };
  const sb: any = {
    from: () => ({
      select: () => query(),
      upsert: (row: Row, opts: { ignoreDuplicates?: boolean }) => {
        const dup = rows.find((r) => r.user_id === row.user_id && r.friday === row.friday && r.category === row.category);
        if (dup && opts?.ignoreDuplicates) return Promise.resolve({ error: null });
        rows.push({ id: `id${rows.length + 1}`, offered_at: "2026-10-09T10:00:00Z", ...row });
        return Promise.resolve({ error: null });
      },
      update: (patch: Row) => {
        const filters: Array<(r: Row) => boolean> = [];
        const chain: any = {
          eq: (k: string, v: any) => { filters.push((r) => r[k] === v); return chain; },
          then: (resolve: any) => {
            for (const r of rows.filter((x) => filters.every((f) => f(x)))) Object.assign(r, patch);
            resolve({ error: null });
          },
        };
        return chain;
      },
    }),
  };
  return { sb, rows };
}

const U = "u1";
const FRIDAY = "2026-10-09";
const NOW = new Date("2026-10-09T15:00:00Z");

describe("resposta ao convite do fim de semana", () => {
  it("só reconhece respostas curtas e inequívocas", () => {
    for (const t of ["topo", "Topo!", "eu topo", "topo sim", "Bora tentar", "vamos tentar", "aceito", "combinado"]) {
      expect(matchWeekendReply(t), t).toBe("accept");
    }
    for (const t of ["detalhes", "Ver detalhes", "quero ver os detalhes", "me mostra detalhes"]) {
      expect(matchWeekendReply(t), t).toBe("details");
    }
    for (const t of ["topo comprar um carro novo", "sim", "ok", "quanto gastei com lazer?", "detalhes do meu gasto de ontem no mercado por favor"]) {
      expect(matchWeekendReply(t), t).toBeNull();
    }
  });

  it("sem oferta aberta, 'topo' segue para o agente (null)", async () => {
    const { sb } = fakeDb();
    expect(await handleWeekendReply(sb, { userId: U, text: "topo", now: NOW })).toBeNull();
    const old = fakeDb([{ id: "a", user_id: U, friday: "2026-09-18", category: "Lazer", status: "offered", target_amount: 100, offered_at: "2026-09-18T10:00:00Z" }]);
    expect(await handleWeekendReply(old.sb, { userId: U, text: "topo", now: NOW })).toBeNull();
  });

  it("'topo' grava o combinado, confirma o limite e o efeito no mês", async () => {
    const { sb, rows } = fakeDb();
    await persistWeekendOffer(sb, U, {
      friday: FRIDAY, category: "Lazer", detail: "📊 *Detalhes do fim de semana*",
      offer: { category: "Lazer", friday: FRIDAY, target: 170, expected: 290, projected_before: 1820, projected_if_target: 1700, anchor: { kind: "goal", amount: 1060 } },
    });
    const reply = await handleWeekendReply(sb, { userId: U, text: "Topo!", now: NOW });
    expect(reply?.action).toBe("accept");
    expect(reply?.reply).toMatch(/\*Combinado!\*.*\*Lazer\* até \*R\$ 170\*/s);
    expect(reply?.reply).toMatch(/o mês fecha em \*R\$ 1\.700\*/);
    expect(reply?.reply).toMatch(/Na segunda eu te conto como foi/);
    expect(rows[0].status).toBe("accepted");
    expect(rows[0].accepted_at).toBeTruthy();
    // repetir não duplica nem reescreve
    const again = await handleWeekendReply(sb, { userId: U, text: "topo", now: NOW });
    expect(again?.reply).toMatch(/Já está combinado/);
    expect(rows).toHaveLength(1);
  });

  it("'detalhes' devolve o texto guardado, mesmo sem limite oferecido", async () => {
    const { sb } = fakeDb();
    await persistWeekendOffer(sb, U, { friday: FRIDAY, category: "Lazer", offer: null, detail: "📊 *Detalhes do fim de semana*\n\n*Lazer*" });
    const reply = await handleWeekendReply(sb, { userId: U, text: "detalhes", now: NOW });
    expect(reply?.reply).toMatch(/Detalhes do fim de semana/);
    // "topo" sem limite oferecido não cria combinado
    expect(await handleWeekendReply(sb, { userId: U, text: "topo", now: NOW })).toBeNull();
  });

  it("a oferta de sexta é idempotente e não desfaz um combinado aceito", async () => {
    const { sb, rows } = fakeDb();
    const args = { friday: FRIDAY, category: "Lazer", detail: "d", offer: { category: "Lazer", friday: FRIDAY, target: 170, expected: 290, projected_before: 1820, projected_if_target: 1700, anchor: { kind: "goal" as const, amount: 1060 } } };
    await persistWeekendOffer(sb, U, args);
    await handleWeekendReply(sb, { userId: U, text: "topo", now: NOW });
    await persistWeekendOffer(sb, U, args);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("accepted");
    expect(await loadAcceptedCommitments(sb, U, FRIDAY)).toEqual({ Lazer: { target_amount: 170 } });
  });
});

describe("fechamento de segunda com combinado", () => {
  const tx: Array<{ occurred_at: string; amount: number; category: string }> = [];
  for (let t = Date.UTC(2026, 6, 1); t < Date.UTC(2026, 9, 9); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const w = new Date(t).getUTCDay();
    const idx = Math.floor((t - Date.UTC(2026, 6, 3)) / (7 * 86_400_000));
    if (idx % 3 !== 0) {
      if (w === 5) tx.push({ occurred_at: d, amount: 80 * (d.startsWith("2026-10") ? 4 : 1), category: "Lazer" });
      if (w === 6) tx.push({ occurred_at: d, amount: 150 * (d.startsWith("2026-10") ? 4 : 1), category: "Lazer" });
      if (w === 0) tx.push({ occurred_at: d, amount: 300 * (d.startsWith("2026-10") ? 4 : 1), category: "Lazer" });
    }
  }
  const [forecast] = buildWeekendForecasts(tx, FRIDAY);
  const ctx = { as_of: "2026-10-12", snapshot_ref: { reconciliation_id: "r", formula_version: "f" } };
  const monday = new Date("2026-10-12T11:00:00Z");

  it("cumpriu: mostra o combinado, a economia e o fechamento do mês", () => {
    const [recap] = buildWeekendRecaps([{ forecast }], [{ occurred_at: "2026-10-10", amount: 120, category: "Lazer" }], "2026-10-12", {}, { Lazer: { target_amount: 170 } });
    expect(recap.commitment_kept).toBe(true);
    const sit = weekendRecapSituation(recap, ctx, monday)!;
    expect(sit.title).toBe("✅ Combinado cumprido: Lazer");
    const wa = (sit.evidence as any).whatsapp.body as string;
    expect(wa).toMatch(/Você combinou ficar em \*R\$ 170\* com Lazer e gastou \*R\$ 120\*\./);
    expect(wa).toMatch(/🎉 Cumpriu! Foram \*R\$ [\d.]+ a menos\* do que o seu padrão/);
    expect(wa).toMatch(/📅 Com isso, o mês de Lazer fecha em \*R\$ [\d.]+\*/);
    expect((sit.evidence as any).commitment_outcomes).toEqual([{ category: "Lazer", friday: FRIDAY, realized: 120, kept: true }]);
    expect(sit.body).not.toMatch(/\*/);
  });

  it("não cumpriu: sem julgamento, mostra o quanto passou e o novo fechamento", () => {
    const [recap] = buildWeekendRecaps([{ forecast }], [{ occurred_at: "2026-10-10", amount: 300, category: "Lazer" }], "2026-10-12", {}, { Lazer: { target_amount: 170 } });
    expect(recap.commitment_kept).toBe(false);
    const sit = weekendRecapSituation(recap, ctx, monday)!;
    expect(sit.title).toBe("🔎 Como foi o fim de semana: Lazer");
    expect(sit.body).toMatch(/Ficou R\$ 130 acima do combinado\. Acontece: ainda dá para compensar/);
    expect(sit.body).not.toMatch(/falhou|culpa|errou/i);
  });

  it("o resultado do combinado é gravado (kept/missed) só se estava aceito", async () => {
    const { sb, rows } = fakeDb([
      { id: "a", user_id: U, friday: FRIDAY, category: "Lazer", status: "accepted", target_amount: 170 },
      { id: "b", user_id: U, friday: FRIDAY, category: "Transporte", status: "offered", target_amount: 100 },
    ]);
    await recordCommitmentOutcomes(sb, U, [
      { category: "Lazer", friday: FRIDAY, realized: 120, kept: true },
      { category: "Transporte", friday: FRIDAY, realized: 400, kept: false },
    ]);
    expect(rows.find((r) => r.id === "a")).toMatchObject({ status: "kept", realized_amount: 120 });
    expect(rows.find((r) => r.id === "b")?.status).toBe("offered");
  });
});

describe("layout da mensagem no WhatsApp (renderizador real)", () => {
  const rows: Array<{ occurred_at: string; amount: number; category: string }> = [];
  for (let t = Date.UTC(2026, 6, 1); t < Date.UTC(2026, 9, 9); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10);
    const w = new Date(t).getUTCDay();
    const mult = d.startsWith("2026-10") ? 4 : 1;
    if (w === 5) rows.push({ occurred_at: d, amount: 80 * mult, category: "Lazer" });
    if (w === 6) rows.push({ occurred_at: d, amount: 150 * mult, category: "Lazer" });
    if (w === 0) rows.push({ occurred_at: d, amount: 300 * mult, category: "Lazer" });
  }

  it("título e blocos em negrito/emoji, pergunta sozinha e inteira em negrito, sem asteriscos soltos", () => {
    const msg = composeWeekendMessage(buildWeekendForecasts(rows, FRIDAY, { Lazer: { name: "Lazer", limit: 2400 } }))!;
    const { message, guards } = renderWhatsappMessage(msg.whatsapp.title, msg.whatsapp.body);
    expect(guards).toEqual([]);
    const blocks = message.split("\n\n");
    expect(blocks[0]).toBe("*🎯 Sextou! Antes do fim de semana: Lazer*");
    expect(blocks.some((b) => b === "*Topa tentar?*")).toBe(true);
    // todo asterisco abre e fecha no mesmo bloco (nada de negrito vazando entre linhas)
    for (const block of blocks) expect((block.match(/\*/g) ?? []).length % 2).toBe(0);
    // nenhuma pergunta dentro de um bloco com negrito interno (evita *...*...*)
    for (const block of blocks.filter((b) => b.endsWith("?*"))) expect(block.slice(1, -2)).not.toMatch(/\*/);
    expect(message.length).toBeLessThan(1000);
    expect(message).not.toMatch(/undefined|NaN|null/);
  });

  it("meta desalinhada com o padrão troca o convite por 'Quer revisar a meta?'", () => {
    const [f] = buildWeekendForecasts(rows, FRIDAY, { Lazer: { name: "Lazer", limit: 700 } });
    expect(f.misaligned).toBe(true);
    const msg = composeWeekendMessage([f])!;
    expect(msg.whatsapp.title).toBe("🧭 Sextou! Sobre a meta de Lazer");
    expect(msg.whatsapp.body).toMatch(/A meta está bem abaixo do seu padrão/);
    expect(msg.whatsapp.body).toMatch(/\n\nQuer revisar a meta\?(\n\n|$)/);
    expect(msg.offer).toBeNull();
    expect(msg.whatsapp.body).not.toMatch(/Topa tentar/);
  });

  it("o app recebe o texto simples e o WhatsApp o layout próprio (dispatcher)", () => {
    const dispatcher = readFileSync("supabase/functions/_shared/agent/core/CommunicationDispatcherV3.ts", "utf8");
    expect(dispatcher).toMatch(/target === "whatsapp"[\s\S]{0,200}evidence as any\)\?\.whatsapp/);
    const webhook = readFileSync("supabase/functions/whatsapp-webhook/index.ts", "utf8");
    expect(webhook).toMatch(/import \{ handleWeekendReply \} from "\.\.\/_shared\/proactive\/weekendCommitments\.ts"/);
    expect(webhook.indexOf("handleWeekendReply(sb")).toBeLessThan(webhook.indexOf("runOrchestrator({"));
  });
});
