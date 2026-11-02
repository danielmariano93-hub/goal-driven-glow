// Caso real de 02/11: "me diga que gasto foi esse que eu tive com serviços em novembro?" foi bloqueado, e
// "quanto gastei no JIM.COM em novembro?" respondia R$ 0. As ferramentas de estabelecimento recortavam pela data da
// compra; categoria e relatório recortam pela competência (cartão = mês da fatura; parcela antecipada = mês em que venceria).
import { describe, expect, it } from "vitest";
import { analyze_merchants, merchant_distribution, merchant_profile } from "../../supabase/functions/_shared/agent/engineToolsImpl";
import { buildEvidenceClaims } from "../../supabase/functions/_shared/agent/core/EvidenceClaims";
import { checkCompleteness } from "../../supabase/functions/_shared/agent/core/CompletenessGate";

const base = {
  account_id: null, type: "expense", status: "confirmed", transfer_group_id: null, settles_card_id: null,
  movement_kind: "transaction", refund_of_transaction_id: null, payment_method: "credit_card", credit_card_id: "card-1",
};
const rows = [
  { ...base, id: "jim-1", category_id: "serv", amount: 545.13, occurred_at: "2026-09-30", description: "JIM.COM", competence_date: "2026-10-01", economic_competence_date: "2026-11-01" },
  { ...base, id: "jim-2", category_id: "serv", amount: 508.79, occurred_at: "2026-07-30", description: "JIM.COM", competence_date: "2026-10-01", economic_competence_date: "2026-11-01" },
  { ...base, id: "claude", category_id: "assin", amount: 129.9, occurred_at: "2026-10-27", description: "Claude Code", competence_date: "2026-11-01", economic_competence_date: null },
  { ...base, id: "zig", category_id: "lazer", amount: 108, occurred_at: "2026-11-01", description: "Zigpay", payment_method: "account", credit_card_id: null, competence_date: null, economic_competence_date: null },
];
const categories = [{ id: "serv", name: "Serviços" }, { id: "assin", name: "Assinaturas" }, { id: "lazer", name: "Lazer" }, { id: "saude", name: "Saúde" }];
const builder = (data: unknown): any => new Proxy({}, { get: (_t, prop) => prop === "then" ? (res: (v: unknown) => void) => res({ data, error: null }) : () => builder(data) });
const ctx: any = { sb: { from: (table: string) => builder(table === "transactions" ? rows : table === "categories" ? categories : []) }, user_id: "u" };
const unwrap = (r: any) => { if (!r.ok) throw new Error(r.error); return r.result; };
const NOV = { from: "2026-11-01", to: "2026-11-02" };

describe("estabelecimento pela competência", () => {
  it("Serviços em novembro lista o JIM.COM antecipado (R$ 1.053,92), não zero", async () => {
    const out: any = unwrap(await merchant_distribution(ctx, { ...NOV, category_name: "Serviços" }));
    expect(out.category_total).toBe(1053.92);
    expect(out.merchants.map((m: any) => [String(m.merchant).toUpperCase(), m.amount])).toEqual([["JIM.COM", 1053.92]]);
  });

  it("compra no cartão feita em outubro e cobrada em novembro entra em Assinaturas de novembro", async () => {
    const out: any = unwrap(await merchant_distribution(ctx, { ...NOV, category_name: "Assinaturas" }));
    expect(out.category_total).toBe(129.9);
  });

  it("o total por estabelecimento fecha com o do mês inteiro (R$ 1.291,82)", async () => {
    const out: any = unwrap(await analyze_merchants(ctx, NOV));
    expect(out.facts.period_net_total).toBe(1291.82);
  });

  it("perfil do JIM.COM em novembro não diz que não houve gasto", async () => {
    const out: any = unwrap(await merchant_profile(ctx, { query: "JIM.COM", ...NOV }));
    expect(out.facts.found).toBe(true);
    expect(out.facts.net_total).toBe(1053.92);
  });
});

describe("categoria sem gasto no recorte responde ausência, não bloqueia", () => {
  it("merchant_distribution vazio gera claim de ausência e a resposta é considerada completa", async () => {
    const result: any = unwrap(await merchant_distribution(ctx, { ...NOV, category_name: "Saúde" }));
    expect(result.category_total).toBe(0);
    expect(result.merchants).toEqual([]);
    const ir: any = {
      period: NOV, queries: [{ id: "q1" }],
      completeness_targets: [{ id: "q1.result", query_id: "q1", claim: "entity", required: true }],
    };
    const execution: any = { outcomes: [{ query_id: "q1", engine: "merchant_distribution", status: "ok", result }], failed_queries: [] };
    const claims = buildEvidenceClaims(ir, execution);
    expect(claims.claims.some((c) => c.type === "absence")).toBe(true);
    expect(checkCompleteness({ ir, execution, claims }).complete).toBe(true);
  });
});
