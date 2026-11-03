// F2b — livro de causas alimentado pelo ledger canônico real, conferido contra SQL independente (conta do dono, 03/11/2026).
import { describe, expect, it } from "vitest";
import { buildCauseMonths, causeCategoryKey, causeLedgerForMonth, classifyCauseExpense, toCauseEntry, CAUSE_PONTUAL_MIN, type CauseSourceTx } from "@/lib/engine/causeEntries";
import type { CauseMonth } from "@/lib/engine/causeLedger";
import { GOLD_ROWS, GOLD_SQL_TOTALS } from "./fixtures/cause-gold-rows";

// Expande cada linha agregada em `n` lançamentos de valor médio (a regra de ≥ R$ 1.000 vale por lançamento e a média preserva o lado).
function expand(): { txs: CauseSourceTx[]; categories: Array<{ id: string; name: string }> } {
  const names = new Set<string>();
  const txs: CauseSourceTx[] = [];
  let seq = 0;
  for (const [m, type, mk, st, tg, sc, ant, card, inst, rec, cn, , n, total] of GOLD_ROWS) {
    if (cn) names.add(cn);
    for (let i = 0; i < n; i++) {
      txs.push({
        id: `t${++seq}`, account_id: "a", category_id: cn ? `cat:${cn}` : null,
        type: type as "income" | "expense", status: st as "confirmed" | "planned", amount: total / n,
        occurred_at: `${m}-15`, description: null, transfer_group_id: tg ? "g1" : null,
        payment_method: card ? "credit_card" : "account", credit_card_id: card ? "card1" : null,
        competence_date: card ? `${m}-01` : null, settles_card_id: sc ? "card1" : null,
        movement_kind: mk, installments_total: inst ? 6 : 1, installment_anticipated: ant === 1,
        origin: rec ? "recurring" : "manual",
      } as CauseSourceTx);
    }
  }
  return { txs, categories: [...names].map((name) => ({ id: `cat:${name}`, name })) };
}

const { txs, categories } = expand();
const months = buildCauseMonths(txs, categories);
const byMonth = new Map(months.map((m) => [m.month, m]));
const near = (a: number, b: number) => Math.abs(a - b) <= 0.03;

describe("gabarito SQL: totais por mês e natureza", () => {
  for (const [month, gold] of Object.entries(GOLD_SQL_TOTALS)) {
    it(`${month}: renda e cada natureza fecham com o SQL independente`, () => {
      const m = byMonth.get(month)!;
      expect(m, month).toBeTruthy();
      expect(near(m.income, gold.renda), `renda ${m.income} x ${gold.renda}`).toBe(true);
      for (const k of ["fixa", "parcela_cartao", "variavel", "pontual", "antecipacao", "desconhecida"] as const) {
        expect(near(m[k], gold[k]), `${month} ${k}: ${m[k]} x ${gold[k]}`).toBe(true);
      }
    });
  }

  it("a renda dos meses de maio a agosto bate com a agregação diária do banco (fonte independente: financial_daily_facts)", () => {
    const facts: Record<string, number> = { "2026-05": 10682.12, "2026-06": 34455.79, "2026-07": 7720.9, "2026-08": 8526.59 };
    for (const [month, income] of Object.entries(facts)) expect(near(byMonth.get(month)!.income, income), month).toBe(true);
  });

  it("nada que não seja renda ou consumo entra: Pix de terceiros, resgates, aportes, faturas, dívidas e pendentes ficam de fora", () => {
    // Junho tem R$ 18.000 de aplicações, R$ 16.502,66 de resgates e R$ 5.547,06 de faturas pagas: nenhum vira causa.
    const jun = byMonth.get("2026-06")!;
    expect(jun.income).toBeCloseTo(34455.79, 1);
    expect(jun.fixa + jun.parcela_cartao + jun.variavel + jun.pontual + jun.antecipacao + jun.desconhecida).toBeCloseTo(34494.02, 0);
  });
});

describe("livro de causas dos meses da piora (julho, agosto, outubro)", () => {
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const mid = Math.floor(s.length / 2); return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2; };
  const free = (g: (typeof GOLD_SQL_TOTALS)[string]) => g.renda - (g.fixa + g.parcela_cartao + g.variavel + g.pontual + g.antecipacao + g.desconhecida);

  for (const month of ["2026-07", "2026-08", "2026-10"]) {
    it(`${month}: a soma dos efeitos fecha com a variação e o resíduo é só o que não tem natureza`, () => {
      const ledger = causeLedgerForMonth(months, month)!;
      expect(ledger).toBeTruthy();
      // Conta feita à parte, direto dos totais do SQL: mediana (3+ meses) ou média dos meses anteriores.
      const prior = Object.entries(GOLD_SQL_TOTALS).filter(([m]) => m < month).slice(-6).map(([, g]) => g);
      const center = (f: (g: (typeof prior)[number]) => number) => prior.length >= 3 ? median(prior.map(f)) : prior.reduce((s, g) => s + f(g), 0) / prior.length;
      const baselineFree = center((g) => g.renda) - ["fixa", "parcela_cartao", "variavel", "pontual", "antecipacao", "desconhecida"].reduce((s, k) => s + center((g) => g[k as "fixa"]), 0);
      const expectedDelta = free(GOLD_SQL_TOTALS[month]) - baselineFree;
      expect(near(ledger.free_cash_current, free(GOLD_SQL_TOTALS[month]))).toBe(true);
      expect(Math.abs(ledger.free_cash_baseline - baselineFree)).toBeLessThan(0.1);
      expect(Math.abs(ledger.delta - expectedDelta)).toBeLessThan(0.1);
      const known = ledger.drivers.filter((d) => d.key !== "desconhecida").reduce((s, d) => s + d.effect, 0);
      expect(Math.abs(known + ledger.residual - ledger.delta)).toBeLessThan(0.05);
      const unknown = ledger.drivers.find((d) => d.key === "desconhecida");
      // Resíduo = efeito dos lançamentos sem categoria (declarado), não uma causa.
      expect(Math.abs(ledger.residual - (unknown?.effect ?? 0))).toBeLessThan(0.05);
    });
  }

  it("julho: a renda cai e a causa principal é a renda (fato), com mecanismo 'renda'", () => {
    const ledger = causeLedgerForMonth(months, "2026-07")!;
    expect(ledger.delta).toBeLessThan(0);
    expect(ledger.main_driver).toBe("renda");
    expect(ledger.mechanism).toBe("renda");
  });

  it("outubro: parcelas de cartão sobem contra o normal e entram como driver estrutural; o aluguel não vira 'pontual'", () => {
    const ledger = causeLedgerForMonth(months, "2026-10")!;
    const parcelas = ledger.drivers.find((d) => d.key === "parcela_cartao")!;
    expect(parcelas.current).toBeCloseTo(4536.41, 1);
    expect(parcelas.effect).toBeLessThan(0);
    expect(byMonth.get("2026-10")!.pontual).toBe(0);
  });

  it("julho: base de só 2 meses com renda extraordinária em junho (R$ 34 mil) = confiança BAIXA, com o motivo declarado", () => {
    const ledger = causeLedgerForMonth(months, "2026-07")!;
    expect(ledger.reasons).toContain("base_atipica");
    expect(ledger.confidence).toBe("baixa");
  });

  it("agosto (3 meses de base) deixa de ser 'base atípica' e a confiança sobe", () => {
    const ledger = causeLedgerForMonth(months, "2026-08")!;
    expect(ledger.reasons).not.toContain("base_atipica");
    expect(ledger.confidence).toBe("alta");
  });

  it("sem mês anterior não há comparação honesta (null), e com um mês a confiança não é alta", () => {
    expect(causeLedgerForMonth(months, "2026-05")).toBeNull();
    const second = causeLedgerForMonth(months, "2026-06")!;
    expect(second.confidence).not.toBe("alta");
  });
});

describe("regras de natureza (uma por vez)", () => {
  const base = (over: Partial<CauseSourceTx> = {}): CauseSourceTx => ({
    id: "x", account_id: "a", category_id: "c1", type: "expense", status: "confirmed", amount: 50, occurred_at: "2026-10-10",
    description: null, transfer_group_id: null, payment_method: "account", movement_kind: "transaction", ...over,
  } as CauseSourceTx);

  it("ordem: antecipação > parcela de cartão > fixa > sem categoria > pontual > variável", () => {
    expect(classifyCauseExpense(base({ installment_anticipated: true, credit_card_id: "k", installments_total: 6 }), "Moradia")).toBe("antecipacao");
    expect(classifyCauseExpense(base({ credit_card_id: "k", payment_method: "credit_card", installments_total: 6 }), "Moradia")).toBe("parcela_cartao");
    expect(classifyCauseExpense(base(), "Moradia")).toBe("fixa");
    expect(classifyCauseExpense(base({ origin: "recurring" }), "Lazer")).toBe("fixa");
    expect(classifyCauseExpense(base({ category_id: null }), null)).toBe("desconhecida");
    expect(classifyCauseExpense(base({ amount: CAUSE_PONTUAL_MIN }), "Lazer")).toBe("pontual");
    expect(classifyCauseExpense(base({ amount: CAUSE_PONTUAL_MIN - 0.01 }), "Lazer")).toBe("variavel");
  });
  it("compra à vista no cartão (1 parcela) não é parcela de cartão", () => {
    expect(classifyCauseExpense(base({ credit_card_id: "k", payment_method: "credit_card", installments_total: 1 }), "Lazer")).toBe("variavel");
  });
  it("categoria fixa ignora acento e caixa", () => {
    expect(causeCategoryKey("EDUCAÇÃO ")).toBe("educacao");
    expect(classifyCauseExpense(base(), "Educação")).toBe("fixa");
    expect(classifyCauseExpense(base(), "Dívidas e empréstimos")).toBe("fixa");
  });
  it("estorno abate gasto variável do mês; Pix de terceiros e fatura paga não são nada", () => {
    const refund = toCauseEntry(base({ type: "income", movement_kind: "refund", amount: 30 }), "Estornos");
    expect(refund?.entry).toEqual({ kind: "expense", amount: -30, class: "variavel" });
    expect(toCauseEntry(base({ type: "income", movement_kind: "external_transfer_in", amount: 900 }), null)).toBeNull();
    expect(toCauseEntry(base({ settles_card_id: "k", movement_kind: "card_payment" }), "Fatura Cartão")).toBeNull();
    expect(toCauseEntry(base({ status: "planned" }), "Lazer")).toBeNull();
  });
  it("cartão entra no mês da fatura; parcela antecipada no mês em que venceria", () => {
    const card = toCauseEntry(base({ credit_card_id: "k", payment_method: "credit_card", competence_date: "2026-11-01", occurred_at: "2026-10-30" }), "Lazer");
    expect(card?.month).toBe("2026-11");
    const anticipated = toCauseEntry(base({ credit_card_id: "k", payment_method: "credit_card", installment_anticipated: true, competence_date: "2026-10-01", economic_competence_date: "2027-01-01" }), "Serviços");
    expect(anticipated?.month).toBe("2027-01");
  });
});
