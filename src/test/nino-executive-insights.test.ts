// nino_executive_insights.v1 — leitura executiva sobre a verdade canônica.
// O conjunto de dados reproduz os padrões reais que o motor antigo errou ou
// ignorou (30/09): aluguel pago no dia 31, Assinaturas saltando, Transporte
// em alta, reajuste da Apple, uso intenso da Lovable e déficit de 3 meses.
import { describe, expect, it } from "vitest";
import {
  computeExecutiveInsights,
  insightsForSection,
  unifyMerchantKeys,
  type LedgerEntry,
} from "../../supabase/functions/_shared/insights/executive/engine";

let seq = 0;
const e = (date: string, amount: number, category: string, merchant: string | null, kind: "expense" | "income" = "expense"): LedgerEntry => ({
  id: String(++seq), date, kind, amount, category_id: `cat-${category}`, category,
  merchant_key: merchant ? merchant.toLowerCase() : null, merchant,
});

const months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
function dataset(): LedgerEntry[] {
  const rows: LedgerEntry[] = [];
  months.forEach((m, i) => {
    // Aluguel: em agosto pago no dia 31 (o motor antigo perdia esse pagamento).
    rows.push(e(`${m}-${m === "2026-08" ? "31" : "30"}`, 3800 + (i % 2) * 40, "Moradia", "LS Prado"));
    // Netflix estável.
    rows.push(e(`${m}-10`, 44.9, "Assinaturas", "Netflix"));
    // Apple: 34,90 até agosto; 129,90 em setembro (reajuste/plano).
    rows.push(e(`${m}-12`, m === "2026-09" ? 129.9 : 34.9, "Assinaturas", "Apple"));
    // Transporte: ~1.150 até maio, ~2.100 de julho em diante (alta estrutural via Uber).
    const uberRides = i < 3 ? 40 : i === 3 ? 60 : 75;
    for (let r = 0; r < uberRides; r++) rows.push(e(`${m}-${String(1 + (r % 28)).padStart(2, "0")}`, 28, "Transporte", "Uber"));
    // Mercado estável.
    rows.push(e(`${m}-05`, 450, "Mercado", "Pão de Açúcar"));
    // Renda: 12 mil até junho; 7,5 mil de julho em diante.
    rows.push(e(`${m}-05`, i < 4 ? 12000 : 6000, "Salário", null, "income"));
  });
  // Lovable: nova, intensa, desde julho (≈10 cobranças/mês).
  for (const m of ["2026-07", "2026-08", "2026-09"]) {
    for (let r = 0; r < 10; r++) rows.push(e(`${m}-${String(2 + r * 2).padStart(2, "0")}`, 130, "Assinaturas", "Lovable"));
  }
  return rows;
}

describe("motor executivo sobre dados com os padrões reais", () => {
  const briefing = computeExecutiveInsights({
    as_of: "2026-09-30",
    entries: dataset(),
    future_installments: [
      { month: "2026-10", amount: 4735.46 }, { month: "2026-11", amount: 2078.15 }, { month: "2026-12", amount: 677.78 },
    ],
  });
  const byKind = (kind: string) => briefing.insights.filter((i) => i.kind === kind);
  const text = (i: { headline: string; why: string; evidence: string[] }) => [i.headline, i.why, ...i.evidence].join(" ");

  it("setembro (dia 30) é o mês de referência", () => {
    expect(briefing.reference_month).toBe("2026-09");
  });

  it("não acusa Moradia: aluguel pago no dia 31 não é 'aumento de R$ 0 para R$ 3 mil'", () => {
    const moradia = briefing.insights.filter((i) => text(i).includes("Moradia") && i.kind === "structural_trend");
    expect(moradia).toEqual([]);
    expect(briefing.insights.some((i) => /de R\$ 0 para/.test(i.headline))).toBe(false);
  });

  it("resultado de 3 meses: déficit com valor por mês e projeção anual", () => {
    const [cash] = byKind("cashflow");
    expect(cash).toBeDefined();
    expect(cash.direction).toBe("worse");
    expect(cash.headline).toMatch(/^Nos últimos 3 meses você gastou R\$ [\d.,]+ mil a mais do que recebeu$/);
    expect(cash.why).toMatch(/déficit médio de R\$ .* por mês/);
    expect(cash.evidence).toHaveLength(3);
    expect(cash.action?.label).toBe("Montar plano para equilibrar");
  });

  it("alta estrutural de Transporte explicada pelo Uber, com limite sugerido", () => {
    const transport = briefing.insights.find((i) => i.key === "category:cat-Transporte")!;
    expect(transport.kind).toBe("structural_trend");
    expect(transport.headline).toMatch(/^Transporte está em alta há 3 meses: R\$ 2,1 mil por mês contra R\$ 1,1 mil antes$/);
    expect(transport.why).toContain("por ano se continuar");
    expect(transport.evidence.join(" ")).toMatch(/Uber responde por 100% da alta/);
    // O Uber explica toda a alta: a ação é sobre o Uber, não um teto genérico.
    expect(transport.action).toMatchObject({ type: "ask", label: "Analisar Uber" });
  });

  it("reajuste da Apple aparece com valor mensal e anual", () => {
    const apple = briefing.insights.find((i) => i.key === "merchant:apple")!;
    expect(apple.kind).toBe("price_increase");
    expect(apple.headline).toBe("Apple subiu de R$ 34,90 para R$ 129,90 por mês");
    expect(apple.why).toContain("R$ 95,00 a mais por mês");
  });

  it("uso concentrado na Lovable com economia estimada", () => {
    const lovable = briefing.insights.find((i) => i.key === "merchant:lovable")!;
    expect(lovable.kind).toBe("usage_concentration");
    expect(lovable.headline).toMatch(/^Lovable leva \d+% de tudo o que você gasta: R\$ 1,3 mil por mês$/);
    expect(lovable.why).toMatch(/Reduzir um quarto do uso economiza cerca de R\$ \d+ por mês/);
    expect(lovable.action).toMatchObject({ type: "ask" });
  });

  it("parcelas já contratadas nos próximos 3 meses", () => {
    const [inst] = byKind("installments_ahead");
    expect(inst.headline).toBe("R$ 7,5 mil em parcelas já comprometidos até dezembro");
    expect(inst.evidence).toEqual(["Outubro: R$ 4.735,46", "Novembro: R$ 2.078,15", "Dezembro: R$ 677,78"]);
  });

  it("percentual de participação nunca passa de 100%", () => {
    for (const i of byKind("usage_concentration")) {
      const share = Number(i.headline.match(/leva (\d+)%/)?.[1]);
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThanOrEqual(100);
    }
  });

  it("compromissos fixos são cobranças mensais estáveis (aluguel, assinaturas), não Uber", () => {
    const fixed = briefing.insights.find((i) => i.kind === "recurring_costs")!;
    const labels = fixed.evidence.join(" ");
    expect(labels).toContain("LS Prado");
    expect(labels).not.toContain("Uber");
    expect(labels).not.toContain("Lovable");
  });

  it("uma causa, um insight; nada de jargão interno ou número sem formato", () => {
    const keys = briefing.insights.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const i of briefing.insights) {
      const t = text(i);
      expect(t).not.toMatch(/score|confian|amostra|detector|evid[êe]ncia da mudan/i);
      expect(t).not.toMatch(/(?<![\d.,])\d+\.\d{2}(?![\d])/); // "190.09"
      expect(i.action === null || i.action.label.length > 0).toBe(true);
    }
  });

  it("Agora traz a pauta do comitê: até 5, ordenada por peso", () => {
    const agora = insightsForSection(briefing, "agora");
    expect(agora.length).toBeGreaterThanOrEqual(3);
    expect(agora.length).toBeLessThanOrEqual(5);
    expect(agora[0].kind).toBe("cashflow");
    expect(insightsForSection(briefing, "mudancas").every((i) => i.section === "mudancas")).toBe(true);
  });

  it("KPIs do topo: gasto do mês, resultado e poupança", () => {
    expect(briefing.kpis.map((k) => k.label)).toEqual(["Gasto em setembro", "Resultado em 3 meses", "Taxa de poupança"]);
    expect(briefing.kpis[1].tone).toBe("bad");
  });
});

describe("robustez", () => {
  it("histórico curto: aprende em vez de inventar", () => {
    const b = computeExecutiveInsights({ as_of: "2026-09-15", entries: [e("2026-09-02", 100, "Mercado", "X")] });
    expect(b.coverage.learning).toBe(true);
    expect(b.insights).toEqual([]);
  });

  it("mês no meio usa o último mês fechado como referência", () => {
    const b = computeExecutiveInsights({ as_of: "2026-09-12", entries: dataset() });
    expect(b.reference_month).toBe("2026-08");
  });

  it("unifica variações do mesmo estabelecimento", () => {
    const map = unifyMerchantKeys([
      { key: "lovable", label: "Lovable" },
      { key: "lovablelovable devus", label: "Lovablelovable Devus" },
      { key: "l s prado interme", label: "L S Prado Interme" },
      { key: "ls prado intermediacao", label: "LS Prado Intermediacao" },
      { key: "chat gpt", label: "Chat Gpt" },
      { key: "chatgpt", label: "ChatGPT" },
    ]);
    expect(map.get("lovablelovable devus")?.key).toBe("lovable");
    expect(map.get("ls prado intermediacao")?.key).toBe(map.get("l s prado interme")?.key);
    expect(map.get("chat gpt")?.key).toBe(map.get("chatgpt")?.key);
  });
});

import { toLedger } from "../../supabase/functions/_shared/insights/executive/load";

describe("livro canônico (mesma verdade de Home e relatórios)", () => {
  const base = { status: "confirmed", transfer_group_id: null, settles_card_id: null, movement_kind: "transaction", refund_of_transaction_id: null, competence_date: null, credit_card_id: null, payment_method: "account" };
  const rows = [
    // Compra no cartão em 30/07 que pertence à fatura de agosto.
    { ...base, id: "a", type: "expense", amount: 500, occurred_at: "2026-07-30", competence_date: "2026-08-01", payment_method: "credit_card", credit_card_id: "c1", category_id: "transp", description: "Uber *Trip" },
    // Estorno do Uber: abate Transporte e o próprio Uber.
    { ...base, id: "b", type: "income", amount: 40, occurred_at: "2026-08-10", movement_kind: "refund", refund_of_transaction_id: "a", category_id: "outros", description: "Estorno" },
    // Pagamento de fatura e transferência: fora do consumo.
    { ...base, id: "c", type: "expense", amount: 3000, occurred_at: "2026-08-12", settles_card_id: "c1", category_id: null, description: "Pagamento fatura" },
    { ...base, id: "d", type: "expense", amount: 900, occurred_at: "2026-08-13", movement_kind: "internal_transfer", category_id: null, description: "Transf" },
    // Salário.
    { ...base, id: "e", type: "income", amount: 8000, occurred_at: "2026-08-05", category_id: "sal", description: "Salario" },
  ];
  const ledger = toLedger(rows, new Map([["transp", "Transporte"], ["outros", "Outros"], ["sal", "Salário"]]), [], { from: "2026-08-01", to: "2026-08-31" });

  it("competência do cartão, estorno na categoria/estabelecimento original, fatura e transferência fora", () => {
    expect(ledger.map((l) => [l.id, l.kind, l.date.slice(0, 7), l.amount, l.category, l.merchant])).toEqual([
      ["a", "expense", "2026-08", 500, "Transporte", "Uber"],
      ["b", "expense", "2026-08", -40, "Transporte", "Uber"],
      ["e", "income", "2026-08", 8000, "Salário", null],
    ]);
  });
});
