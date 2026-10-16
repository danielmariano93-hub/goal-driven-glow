import { describe, expect, it } from "vitest";
import { validateMapaReading } from "@/lib/engine/mapaContracts";
import { loadMapaReading, weekStartOf, mapaAccess } from "../../supabase/functions/_shared/mapa/runtime";
import { getMapaForAgent, formatMapaForChat } from "../../supabase/functions/_shared/mapa/agentTool";

// Carga do servidor de ponta a ponta, com um banco simulado que responde por tabela. Antes deste teste a carga nunca tinha rodado:
// um erro de tipo (`status.items`) derrubaria a leitura de qualquer conta com dívida ativa.
const ASOF = "2026-10-16";
const USER = "u1";

function fakeDb(tables: Record<string, any[]>) {
  const writes: Array<{ table: string; op: string; value: any; opts?: any }> = [];
  const from = (table: string) => {
    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === "then") return (resolve: any) => resolve({ data: tables[table] ?? [], error: null });
        if (prop === "maybeSingle") return async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
        if (prop === "upsert" || prop === "insert") return async (value: any, opts?: any) => { writes.push({ table, op: prop, value, opts }); return { error: null }; };
        return () => chain;
      },
    });
    return chain;
  };
  return { sb: { from } as any, writes };
}

const tx = (id: string, type: "income" | "expense", amount: number, ym: string, day: number, category_id: string | null = null) => ({
  id, account_id: "a1", category_id, type, status: "confirmed", amount, occurred_at: `${ym}-${String(day).padStart(2, "0")}T12:00:00`,
  description: "x", transfer_group_id: null, payment_method: null, credit_card_id: null, settles_card_id: null, movement_kind: "transaction",
  posted_at: null, competence_date: null, refund_of_transaction_id: null,
});
const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const txs = months.flatMap((m, i) => [tx(`i${i}`, "income", 9000, m, 5), tx(`e${i}`, "expense", 3000, m, 10, "c-moradia"), tx(`l${i}`, "expense", 1500, m, 12, "c-lazer")]);

const baseTables = (extra: Record<string, any[]> = {}): Record<string, any[]> => ({
  mapa_access: [{ enabled: true }],
  transactions: txs,
  categories: [{ id: "c-moradia", name: "Moradia" }, { id: "c-lazer", name: "Lazer" }],
  financial_current_snapshots: [{ payload: { snapshot: { availableToday: 2000, projection: { estimatedFixedInflows: 0 }, netWorth: { net: -10000 } } } }],
  category_essential_flags: [{ category_id: "c-moradia", essential: true }, { category_id: "c-lazer", essential: false }],
  debts: [
    { id: "d1", name: "Cartão", status: "active", kind: "cartao_rotativo", outstanding_balance: 5000, installment_amount: 400, interest_rate_pct: 12, interest_rate_period: "mes", first_due_date: "2026-01-10", installments_total: 12, installments_paid: 3, contract_total_amount: 6000, original_amount: 6000, principal_amount: 5000 },
    { id: "d2", name: "Celular", status: "active", kind: null, outstanding_balance: 2000, installment_amount: 200, interest_rate_pct: null, interest_rate_period: null, first_due_date: "2026-02-10", installments_total: 10, installments_paid: 2, contract_total_amount: 2500, original_amount: 2500, principal_amount: 2000 },
  ],
  ...extra,
});

describe("carga do servidor do Mapa (banco simulado)", () => {
  it("conta com dívidas ativas: carrega, monta e passa pelo contrato", async () => {
    const { sb } = fakeDb(baseTables());
    const reading = await loadMapaReading(sb, USER, ASOF);
    expect(validateMapaReading(reading)).toEqual([]);
    const debt = reading.indicators.find((i) => i.id === "dividas.comprometimento_renda")!;
    expect(debt.status).not.toBe("sem_dados");
    expect(debt.inputs).toMatchObject({ parcelas_mensais: 600 });
    expect(reading.indicators.find((i) => i.id === "seguranca.meses_cobertos")!.inputs.base).toBe("essenciais");
    expect(reading.indicators.find((i) => i.id === "dividas.atrasos")).toBeDefined();
  });

  it("uma fonte quebrada degrada só aquele pedaço (não derruba a leitura)", async () => {
    const tables = baseTables();
    const { sb } = fakeDb(tables);
    const broken = { from: (t: string) => (t === "habit_context_answers" || t === "weekend_commitments" ? { select: () => { throw new Error("boom"); } } : sb.from(t)) } as any;
    const reading = await loadMapaReading(broken, USER, ASOF);
    expect(validateMapaReading(reading)).toEqual([]);
    expect(reading.indicators.find((i) => i.id === "planejamento.intencionalidade")!.status).toBe("sem_dados");
  });

  it("persist grava uma linha por indicador, chaveada pela segunda-feira da semana", async () => {
    const { sb, writes } = fakeDb(baseTables());
    const reading = await loadMapaReading(sb, USER, ASOF, { persist: true });
    const w = writes.find((x) => x.table === "map_readings" && x.op === "upsert")!;
    expect(w.opts).toEqual({ onConflict: "user_id,as_of,period_kind,indicator_id" });
    expect(w.value).toHaveLength(reading.indicators.length);
    expect(new Set(w.value.map((r: any) => r.as_of))).toEqual(new Set(["2026-10-12"])); // 16/10/2026 é sexta
    expect(w.value.every((r: any) => r.period_kind === "semanal" && r.user_id === USER)).toBe(true);
    expect(weekStartOf("2026-10-12")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-18")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-19")).toBe("2026-10-19");
  });

  it("sem persist não grava nada", async () => {
    const { sb, writes } = fakeDb(baseTables());
    await loadMapaReading(sb, USER, ASOF);
    expect(writes.filter((x) => x.table === "map_readings")).toEqual([]);
  });

  it("o que foi gravado numa semana vira histórico comparável na seguinte", async () => {
    const first = fakeDb(baseTables());
    await loadMapaReading(first.sb, USER, "2026-10-09", { persist: true });
    const saved = first.writes.find((x) => x.table === "map_readings")!.value as any[];
    const history = saved.map((r) => ({ indicator_id: r.indicator_id, as_of: r.as_of, value: r.value, formula_version: r.formula_version, data: r.data }));
    const second = fakeDb(baseTables({ map_readings: history }));
    const reading = await loadMapaReading(second.sb, USER, "2026-10-20");
    expect(validateMapaReading(reading)).toEqual([]);
    expect(reading.indicators.some((i) => i.change?.comparable)).toBe(true);
  });

  it("recusa guardada na semana suprime a mesma recomendação", async () => {
    const tables = baseTables({
      financial_current_snapshots: [{ payload: { snapshot: { availableToday: 300, projection: {}, netWorth: { net: 0 } } } }],
    });
    const a = await loadMapaReading(fakeDb(tables).sb, USER, ASOF);
    const rec = a.recommendation;
    expect(rec).not.toBeNull();
    const b = await loadMapaReading(fakeDb({ ...tables, map_recommendation_events: [{ rec_id: rec!.id, event: "dismissed", created_at: "2026-10-10T12:00:00Z" }] }).sb, USER, ASOF);
    expect(b.recommendation?.id).not.toBe(rec!.id);
  });

  it("acesso: só contas com mapa_access.enabled", async () => {
    expect(await mapaAccess(fakeDb({ mapa_access: [{ enabled: true }] }).sb, USER)).toBe(true);
    expect(await mapaAccess(fakeDb({ mapa_access: [{ enabled: false }] }).sb, USER)).toBe(false);
    expect(await mapaAccess(fakeDb({ mapa_access: [] }).sb, USER)).toBe(false);
  });
});

describe("Mapa para o agente (app e WhatsApp)", () => {
  it("conta liberada: devolve leitura rotulada, sem nota e sem respostas do CFPB", async () => {
    const r = await getMapaForAgent(fakeDb(baseTables({ financial_wellbeing_responses: [{ answered_at: "2026-10-10T00:00:00Z", score: 55, total: 22 }] })).sb, USER, ASOF);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const json = JSON.stringify({ ...r.result, regras: undefined });
    expect(r.result.engine).toBe("mapa_financeiro");
    expect(r.result.indicadores.length).toBeGreaterThan(5);
    expect(json).not.toMatch(/\bnota\b|\bscore\b|cfpb|"total"/i);
    expect(r.result.regras.join(" ")).toContain("não diga para gastar ou cortar menos");
  });

  it("conta sem acesso: mapa_not_enabled, e nenhuma leitura é montada", async () => {
    const { sb, writes } = fakeDb(baseTables({ mapa_access: [] }));
    expect(await getMapaForAgent(sb, USER, ASOF)).toEqual({ ok: false, error: "mapa_not_enabled" });
    expect(writes).toEqual([]);
  });

  it("texto de chat para 'como estão meus hábitos?': título, o que mudou e aviso da tela", async () => {
    const r = await getMapaForAgent(fakeDb(baseTables()).sb, USER, ASOF);
    if (!r.ok) throw new Error("esperava ok");
    const text = formatMapaForChat({ ...r.result, o_que_mudou: [{ indicador: "Parcelas sobre a renda", mudou: "melhorou", antes: "20,0%" }] });
    expect(text).toContain(`*${r.result.leitura.titulo}*`);
    expect(text).toContain("▲ Parcelas sobre a renda (antes: 20,0%)");
    expect(text).toContain("Mapa Financeiro, no app.");
  });
});
