import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildGroupedReminderMessage, dispatchGroupedReminder, planReminderGroups, type GroupJob,
} from "../../supabase/functions/_shared/split/groupedReminder";

const clean = (t: string) => t.replace(/ /g, " ");

// Banco falso em memória: só o que o agrupamento usa. Nada aqui envia mensagem de verdade.
function fakeDb(seed: Record<string, any[]>) {
  const tables: Record<string, any[]> = JSON.parse(JSON.stringify(seed));
  const log: Array<{ table: string; op: string; row: any }> = [];
  const matches = (row: any, filters: Array<[string, string, any]>) =>
    filters.every(([op, col, val]) => (op === "eq" ? row[col] === val : (val as any[]).includes(row[col])));
  const from = (table: string) => {
    const filters: Array<[string, string, any]> = [];
    let mode = "select"; let patch: any = null; let inserted: any = null;
    const chain: any = {
      select() { return chain; },
      in(c: string, v: any[]) { filters.push(["in", c, v]); return chain; },
      eq(c: string, v: any) { filters.push(["eq", c, v]); return mode === "update" ? exec() : chain; },
      update(p: any) { mode = "update"; patch = p; return chain; },
      insert(r: any) { mode = "insert"; inserted = r; return chain; },
      upsert(r: any) { log.push({ table, op: "upsert", row: r }); return Promise.resolve({ error: null }); },
      single() { return Promise.resolve(run(true)); },
      maybeSingle() { return Promise.resolve(run(true)); },
      then(res: any, rej: any) { return Promise.resolve(run(false)).then(res, rej); },
    };
    const exec = () => { run(false); return Promise.resolve({ error: null }); };
    const run = (one: boolean) => {
      if (mode === "insert") {
        const row = { id: `${table}-${(tables[table] ??= []).length + 1}`, ...inserted };
        tables[table].push(row); log.push({ table, op: "insert", row });
        return { data: row, error: null };
      }
      const rows = (tables[table] ?? []).filter((r) => matches(r, filters));
      if (mode === "update") { rows.forEach((r) => Object.assign(r, patch)); log.push({ table, op: "update", row: { ...patch, filters } }); return { data: null, error: null }; }
      return { data: one ? rows[0] ?? null : rows, error: null };
    };
    return chain;
  };
  return { sb: { from }, tables, log };
}

const THALES = "+5511999990001";
const OWNER = "owner-1";
const jobs: GroupJob[] = [
  { id: "job-reveillon", kind: "due_today", installment_id: "inst-r1", shared_expense_id: "exp-reveillon", participant_id: "p-r-thales" },
  { id: "job-carro", kind: "due_today", installment_id: "inst-c2", shared_expense_id: "exp-carro", participant_id: "p-c-thales" },
];
function seed(over: Partial<Record<string, any[]>> = {}) {
  return {
    split_receivables_v1: [
      { installment_id: "inst-r1", due_date: "2026-11-07", owner_user_id: OWNER, installment_number: 1, total_installments: 6, balance_due: 151.05, settlement_status: "pending" },
      { installment_id: "inst-c2", due_date: "2026-11-07", owner_user_id: OWNER, installment_number: 2, total_installments: 2, balance_due: 116.12, settlement_status: "pending" },
    ],
    shared_expense_participants: [
      { id: "p-r-thales", name: "Thales", phone_e164: THALES, status: "pending", opt_out_at: null, reminders_paused_at: null, linked_user_id: null, reminder_count: 0 },
      { id: "p-c-thales", name: "Thales", phone_e164: THALES, status: "pending", opt_out_at: null, reminders_paused_at: null, linked_user_id: null, reminder_count: 0 },
    ],
    shared_expenses: [
      { id: "exp-reveillon", title: "Réveillon RJ", pix_key: "11977992569", owner_user_id: OWNER, status: "active", deleted_at: null },
      { id: "exp-carro", title: "Divisão Carro RJ - Dif Cartão Crédito", pix_key: "11977992569", owner_user_id: OWNER, status: "active", deleted_at: null },
    ],
    reminder_jobs: jobs.map((j) => ({ ...j, status: "processing" })),
    outbound_messages: [], shared_expense_events: [],
    ...over,
  } as Record<string, any[]>;
}
const ctx = {
  today: "2026-11-07",
  daysBetween: (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000),
  ownerName: async () => "Daniel Assis",
  splitContext: async (id: string) => (id === "exp-reveillon" ? { participantsCount: 8, totalAmount: 7250 } : { participantsCount: 2, totalAmount: 464.48 }),
};

describe("mensagem agrupada", () => {
  const items = [
    { title: "Réveillon RJ", installmentNumber: 1, totalInstallments: 6, amount: 151.05, splitTotal: 7250, participantsCount: 8, pixKey: "11977992569" },
    { title: "Divisão Carro RJ - Dif Cartão Crédito", installmentNumber: 2, totalInstallments: 2, amount: 116.12, splitTotal: 464.48, participantsCount: 2, pixKey: "11977992569" },
  ];
  it("vence hoje: total, rolês com total e pessoas, Pix uma vez", () => {
    const { text } = buildGroupedReminderMessage({ kind: "due_today", participantName: "Thales", ownerName: "Daniel Assis", dueDate: "2026-11-07", today: "2026-11-07", items });
    const t = clean(text);
    expect(t).toContain("Vence hoje — 2 parcelas com Daniel Assis");
    expect(t).toContain("Hoje, *07/11*, vencem duas parcelas das suas divisões com Daniel Assis, somando *R$ 267,17*");
    expect(t).toContain("• *Réveillon RJ* (rolê de R$ 7.250,00, 8 pessoas)\n  1ª parcela de 6 · *R$ 151,05*");
    expect(t).toContain("2ª parcela de 2 · *R$ 116,12*");
    expect(t.match(/Pix:/g)?.length).toBe(1);
  });
  it("atraso: tom amigável, dias em atraso e fecho", () => {
    const { text } = buildGroupedReminderMessage({ kind: "overdue", participantName: "Thales", ownerName: "Daniel Assis", dueDate: "2026-11-07", today: "2026-11-09", daysOverdue: 2, items });
    const t = clean(text);
    expect(t).toContain("Um lembrete amigo");
    expect(t).toContain("venceram em *07/11* e estão em aberto há *2 dias*, somando *R$ 267,17*");
    expect(t).toContain("Se já pagou, é só me responder por aqui que eu confiro 😉");
  });
  it("vence amanhã usa 'Amanhã'", () => {
    const { text } = buildGroupedReminderMessage({ kind: "due_soon", participantName: "Thales", ownerName: "Daniel", dueDate: "2026-11-07", today: "2026-11-06", items });
    expect(text).toContain("Amanhã, *07/11*");
  });
  it("Pix diferentes ficam todos; lista longa é cortada com 'e mais N'", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ ...items[0], title: `Rolê ${i}`, pixKey: i === 0 ? "a@b.com" : "11977992569" }));
    const t = clean(buildGroupedReminderMessage({ kind: "due_today", participantName: "T", ownerName: "D", dueDate: "2026-11-07", today: "2026-11-07", items: many }).text);
    expect(t).toContain("• e mais 2 parcelas");
    expect(t).toContain("Pix: a@b.com · 11977992569");
    expect(t).toContain("vencem sete parcelas");
  });
  it("não vaza origem do pagamento nem outros integrantes", () => {
    const t = clean(buildGroupedReminderMessage({ kind: "due_today", participantName: "Thales", ownerName: "Daniel Assis", dueDate: "2026-11-07", today: "2026-11-07", items }).text);
    expect(t).not.toMatch(/cart[ãa]o de|d[ií]vida|conta |tia|fatura|Roger|Wesley/i);
  });
});

describe("planejamento do grupo", () => {
  it("agrupa mesma pessoa + dono + tipo + vencimento em rolês diferentes", async () => {
    const { sb } = fakeDb(seed());
    const plan = await planReminderGroups(sb, jobs);
    expect(plan.get("job-reveillon")?.jobs.map((j) => j.id)).toEqual(["job-reveillon", "job-carro"]);
    expect(plan.get("job-carro")).toBe(plan.get("job-reveillon"));
  });
  it("não agrupa vencimentos diferentes, nem tipos diferentes, nem donos diferentes, nem telefones diferentes", async () => {
    const s = seed();
    s.split_receivables_v1[1].due_date = "2026-11-08";
    expect((await planReminderGroups(fakeDb(s).sb, jobs)).size).toBe(0);
    const s2 = seed(); s2.split_receivables_v1[1].owner_user_id = "owner-2";
    expect((await planReminderGroups(fakeDb(s2).sb, jobs)).size).toBe(0);
    const s3 = seed(); s3.shared_expense_participants[1].phone_e164 = "+5511999990002";
    expect((await planReminderGroups(fakeDb(s3).sb, jobs)).size).toBe(0);
    expect((await planReminderGroups(fakeDb(seed()).sb, [jobs[0], { ...jobs[1], kind: "overdue" }])).size).toBe(0);
  });
  it("duas parcelas do mesmo rolê no mesmo dia não formam grupo", async () => {
    const same = [jobs[0], { ...jobs[1], shared_expense_id: "exp-reveillon" }];
    expect((await planReminderGroups(fakeDb(seed()).sb, same)).size).toBe(0);
  });
});

describe("envio agrupado (banco falso, nada sai)", () => {
  it("cria UMA mensagem, marca os dois jobs com o mesmo outbound e não envia nada a ninguém além do telefone do grupo", async () => {
    const db = fakeDb(seed());
    const group = (await planReminderGroups(db.sb, jobs)).get("job-reveillon")!;
    const res = await dispatchGroupedReminder(db.sb, group, ctx);
    expect(res.enqueued).toBe(1);
    expect(db.tables.outbound_messages).toHaveLength(1);
    const ob = db.tables.outbound_messages[0];
    expect(ob.to_phone).toBe(THALES);
    expect(ob.metadata.grouped).toBe(true);
    expect(clean(ob.body)).toContain("somando *R$ 267,17*");
    expect(res.finalized.sort()).toEqual(["job-carro", "job-reveillon"]);
    for (const j of db.tables.reminder_jobs) { expect(j.status).toBe("enqueued"); expect(j.outbound_message_id).toBe(ob.id); }
    expect(db.tables.shared_expense_participants.every((p) => p.reminder_count === 1)).toBe(true);
  });
  it("se uma parcela já foi paga, não agrupa e deixa a outra para o envio individual", async () => {
    const s = seed(); s.split_receivables_v1[1].settlement_status = "paid";
    const db = fakeDb(s);
    const group = (await planReminderGroups(db.sb, jobs)).get("job-reveillon")!;
    const res = await dispatchGroupedReminder(db.sb, group, ctx);
    expect(res.enqueued).toBe(0);
    expect(db.tables.outbound_messages).toHaveLength(0);
    expect(res.finalized).toEqual(["job-carro"]);
    expect(db.tables.reminder_jobs.find((j) => j.id === "job-carro")?.status).toBe("skipped");
    expect(db.tables.reminder_jobs.find((j) => j.id === "job-reveillon")?.status).toBe("processing");
  });
  it("cobranças pausadas ou participante que saiu não entram no grupo", async () => {
    const s = seed(); s.shared_expense_participants[0].reminders_paused_at = "2026-11-01";
    const db = fakeDb(s);
    const group = (await planReminderGroups(db.sb, jobs)).get("job-reveillon")!;
    const res = await dispatchGroupedReminder(db.sb, group, ctx);
    expect(res.enqueued).toBe(0);
    expect(db.tables.outbound_messages).toHaveLength(0);
  });
  it("a chave de idempotência é estável (mesmo grupo = mesma chave)", async () => {
    const db = fakeDb(seed());
    const group = (await planReminderGroups(db.sb, jobs)).get("job-reveillon")!;
    const a = await dispatchGroupedReminder(db.sb, group, ctx);
    expect(a.enqueued).toBe(1);
    expect(db.tables.outbound_messages[0].idempotency_key).toMatch(/^split:group:due_today:\+5511999990001:2026-11-07:/);
  });
});

describe("ligação no despachante", () => {
  const src = readFileSync("supabase/functions/split-reminders-dispatch-v2/index.ts", "utf8");
  it("planeja grupos depois do claim, só agrupa lembretes e cai no envio individual se o plano falhar", () => {
    expect(src).toContain("planReminderGroups(sb, jobs as any[])");
    expect(src).toContain("split_group_plan_failed");
    expect(src).toMatch(/groupHandled\.has\(job\.id\)\) continue/);
    const grouped = readFileSync("supabase/functions/_shared/split/groupedReminder.ts", "utf8");
    expect(grouped).toContain('GROUPABLE_KINDS = ["due_soon", "due_today", "overdue"]');
    expect(grouped).not.toMatch(/payment_confirmation|"invite"/);
  });
});
