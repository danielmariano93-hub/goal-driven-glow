// F3 — "Por que está assim?" na Home: o card só aparece com segurança e só para quem foi liberado.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCauseMonths, causeLedgerForLastClosedMonth, causeLedgerForMonth } from "@/lib/engine/causeEntries";
import { causeTolerance, describeCauseLedger } from "@/lib/engine/causePresentation";
import { computeCauseLedger, type CauseMonth } from "@/lib/engine/causeLedger";
import { GOLD_ROWS } from "./fixtures/cause-gold-rows";

function goldMonths(): CauseMonth[] {
  const names = new Set<string>(); const txs: any[] = []; let s = 0;
  for (const [m, type, mk, st, tg, sc, ant, card, inst, rec, cn, , n, total] of GOLD_ROWS) {
    if (cn) names.add(cn);
    for (let i = 0; i < n; i++) txs.push({ id: `t${++s}`, account_id: "a", category_id: cn ? `c:${cn}` : null, type, status: st, amount: total / n, occurred_at: `${m}-15`, description: null, transfer_group_id: tg ? "g" : null, payment_method: card ? "credit_card" : "account", credit_card_id: card ? "k" : null, competence_date: card ? `${m}-01` : null, settles_card_id: sc ? "k" : null, movement_kind: mk, installments_total: inst ? 6 : 1, installment_anticipated: ant === 1, origin: rec ? "recurring" : "manual" });
  }
  return buildCauseMonths(txs, [...names].map((name) => ({ id: `c:${name}`, name })));
}
const months = goldMonths();
const m = (month: string, o: Partial<CauseMonth>): CauseMonth => ({ month, income: 8000, fixa: 3000, parcela_cartao: 0, variavel: 2000, pontual: 0, antecipacao: 0, desconhecida: 0, ...o });
const base3 = [m("2026-07", {}), m("2026-08", {}), m("2026-09", {})];

describe("quando o card NÃO aparece", () => {
  it("confiança baixa (julho do dono: base de 2 meses com renda extraordinária) não vira card", () => {
    expect(describeCauseLedger(causeLedgerForMonth(months, "2026-07"))).toBeNull();
  });
  it("variação dentro da tolerância (outubro do dono: −R$ 27) não vira card", () => {
    const ledger = causeLedgerForMonth(months, "2026-10")!;
    expect(Math.abs(ledger.delta)).toBeLessThan(causeTolerance(ledger));
    expect(describeCauseLedger(ledger)).toBeNull();
  });
  it("sem ledger, sem card", () => {
    expect(describeCauseLedger(null)).toBeNull();
    expect(describeCauseLedger(undefined)).toBeNull();
  });
  it("causa só em lançamentos sem categoria não é afirmada", () => {
    const ledger = computeCauseLedger(m("2026-10", { desconhecida: 3000 }), base3);
    expect(ledger.delta).toBeLessThan(-100);
    expect(describeCauseLedger(ledger)).toBeNull();
  });
});

describe("quando aparece, só diz fato", () => {
  it("agosto do dono: melhora contra o normal, fixos como maior peso, confiança alta", () => {
    const card = describeCauseLedger(causeLedgerForMonth(months, "2026-08"))!;
    expect(card).toBeTruthy();
    expect(card.tone).toBe("better");
    expect(card.title).toMatch(/^Agosto fechou R\$\s2\.363,\d{2} acima do seu normal$/);
    expect(card.lines[0].key).toBe("fixa");
    expect(card.lines[0].text).toMatch(/Gastos fixos R\$\s6\.887,\d{2} abaixo do normal\./);
    expect(card.confidence).toBe("alta");
  });
  it("piora: mostra só o que puxou para baixo, no máximo 3, e nunca atribui intenção", () => {
    const ledger = computeCauseLedger(m("2026-10", { renda: 6000, variavel: 5500, fixa: 3600 }), base3);
    const card = describeCauseLedger(ledger)!;
    expect(card.tone).toBe("worse");
    expect(card.lines.length).toBeLessThanOrEqual(3);
    expect(card.lines.every((l) => l.effect < 0)).toBe(true);
    const text = JSON.stringify(card);
    expect(text).not.toMatch(/culpa|devia|gastou demais|descuido|impulsiv/i);
  });
  it("comportamento como maior peso vira PERGUNTA, não afirmação", () => {
    const card = describeCauseLedger(computeCauseLedger(m("2026-10", { variavel: 6500 }), base3))!;
    expect(card.lines[0].key).toBe("variavel");
    expect(card.question).toBe("Quer que eu mostre em quais categorias o gasto variável cresceu?");
    const rent = describeCauseLedger(computeCauseLedger(m("2026-10", { fixa: 6500 }), base3))!;
    expect(rent.question).toBeNull();
  });
  it("antecipação é dita como calendário, não hábito", () => {
    const card = describeCauseLedger(computeCauseLedger(m("2026-10", { antecipacao: 2500 }), base3))!;
    expect(card.lines[0].text).toContain("calendário, não hábito");
  });
  it("parte não classificada é declarada ao lado das causas", () => {
    const card = describeCauseLedger(computeCauseLedger(m("2026-10", { variavel: 5000, desconhecida: 400 }), base3))!;
    expect(card.unclassified).toBeGreaterThan(0);
  });
});

describe("último mês fechado", () => {
  it("em 03/11 o mês é outubro; em 05/01 é dezembro do ano anterior; o mês corrente nunca entra", () => {
    expect(causeLedgerForLastClosedMonth([], [], "2026-11-03")).toBeNull();
    const fixed = (today: string) => causeLedgerForLastClosedMonth(
      [{ id: "1", account_id: "a", category_id: null, type: "income", status: "confirmed", amount: 100, occurred_at: "2025-11-10", description: null, transfer_group_id: null, movement_kind: "transaction" },
       { id: "2", account_id: "a", category_id: null, type: "income", status: "confirmed", amount: 100, occurred_at: "2025-12-10", description: null, transfer_group_id: null, movement_kind: "transaction" }] as never,
      [], today);
    expect(fixed("2026-01-05")?.month).toBe("2025-12");
  });
});

describe("liberação por usuário e custo", () => {
  const edge = readFileSync("supabase/functions/home-snapshot/index.ts", "utf8");
  const migration = readFileSync("supabase/migrations/20261103180000_cause_ledger_access.sql", "utf8");
  it("o snapshot só calcula `causes` para quem está em cause_ledger_access (sem consulta nova para os demais)", () => {
    const accessAt = edge.indexOf('from("cause_ledger_access")');
    const computeAt = edge.indexOf("causeLedgerForMonth(");
    expect(accessAt).toBeGreaterThan(0);
    expect(computeAt).toBeGreaterThan(accessAt);
    expect(edge).toContain("const snapshot = causes ? { ...snapshotBase, causes } : snapshotBase;");
    // a leitura é uma por PK, dentro do caminho de cálculo (falha de cache), nunca antes do cache
    expect(accessAt).toBeGreaterThan(edge.indexOf("readDerivedCache("));
  });
  it("a migration é aditiva, com RLS e sem acesso anônimo", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON public.cause_ledger_access FROM anon, public");
    expect(migration).not.toMatch(/\bDROP\b(?! TABLE)|ALTER TABLE public\.transactions/i);
  });
  it("a Home usa o campo do snapshot e não abre leitura própria", () => {
    const home = readFileSync("src/pages/Index.tsx", "utf8");
    const card = readFileSync("src/components/home/HomeCausasCard.tsx", "utf8");
    expect(home).toContain("<HomeCausasCard causes={snap?.causes} />");
    expect(card).not.toMatch(/supabase|useQuery|fetch\(/);
  });
});
