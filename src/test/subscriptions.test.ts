import { describe, expect, it } from "vitest";
import { brandOf, detectSubscriptions, subscriptionInsights } from "@/lib/engine/subscriptions";
import type { DetectionTx } from "@/lib/engine/recurringDetection";

let n = 0;
const tx = (description: string, amount: number, date: string, over: Partial<DetectionTx> = {}): DetectionTx => ({
  id: `s${++n}`, description, amount, occurred_at: date, type: "expense", status: "confirmed", movement_kind: "transaction", ...over,
});
const today = "2026-10-15";

describe("assinaturas pagas no cartão e na conta", () => {
  const txs = [
    // ChatGPT: nomes diferentes mês a mês, pago por Pix automático (EBANX)
    tx("OpenAI", 103.4, "2026-08-03", { merchant_name: "OpenAI" }),
    tx("ChatGPT / EBANX", 103.4, "2026-09-03", { merchant_name: "PIX AUT EBANX 03/09" }),
    // Apple no cartão, valores diferentes
    tx("Apple.com/billsao Paulo", 34.9, "2026-07-12", { merchant_name: "APPLE.COM/BILLSAO PAULO", credit_card_id: "c1", payment_method: "credit_card" }),
    tx("Apple.com/billsao Paulo", 34.9, "2026-08-20", { merchant_name: "APPLE.COM/BILLSAO PAULO", credit_card_id: "c1", payment_method: "credit_card" }),
    tx("Apple.com/bill", 129.9, "2026-09-18", { merchant_name: "Apple.com/bill", credit_card_id: "c1", payment_method: "credit_card" }),
    // Spotify e Netflix na conta
    ...["2026-07-18", "2026-08-18", "2026-09-18"].map((d) => tx("Spotify", 23.9, d)),
    ...["2026-07-27", "2026-08-27", "2026-09-27"].map((d) => tx("Netflix", 44.9, d)),
    // Amazon Prime parou (último em julho); Google Ads não é assinatura
    tx("Amazon Prime", 19.9, "2026-06-23", { credit_card_id: "c1" }),
    tx("Amazon Prime", 34.9, "2026-07-02", { credit_card_id: "c1" }),
    tx("Google ADS2752034344SAO", 400, "2026-06-22", { credit_card_id: "c1" }),
    tx("Google ADS2752034344SAO", 400, "2026-07-22", { credit_card_id: "c1" }),
  ];
  const r = detectSubscriptions({ txs, today });

  it("reconhece a marca apesar do nome do banco e soma cartão + conta", () => {
    const names = r.active.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(["ChatGPT / OpenAI", "Apple (assinaturas)", "Spotify", "Netflix"]));
    expect(names).not.toContain("Amazon Prime");
    expect(r.possibly_ended.map((s) => s.name)).toEqual(["Amazon Prime"]);
    expect(brandOf({ description: "Google ADS123", merchant_name: null })).toBeNull();
  });
  it("canal: cartão, conta e valores que variam", () => {
    const apple = r.active.find((s) => s.name.startsWith("Apple"))!;
    expect(apple.channel).toBe("cartão");
    expect(apple.amount_varies).toBe(true);
    expect(apple.price_change_pct).toBeGreaterThan(100);
    expect(r.active.find((s) => s.name === "Netflix")!.channel).toBe("conta");
  });
  it("totais e orientação: quantidade, mensal, anual, % da renda, maior e alta de preço", () => {
    const ins = subscriptionInsights(r.active, 9000);
    expect(ins.count).toBe(4);
    expect(ins.monthly_total).toBeCloseTo(103.4 + 34.9 + 23.9 + 44.9, 1);
    expect(ins.annual_total).toBeCloseTo(ins.monthly_total * 12, 1);
    expect(ins.income_share_pct).not.toBeNull();
    expect(ins.largest?.name).toBe("ChatGPT / OpenAI");
    expect(ins.lines.join(" ")).toMatch(/A maior é ChatGPT/);
    expect(ins.lines.join(" ")).toMatch(/Apple.*(subiu|acima do normal)/);
  });
  it("serviços da mesma família: quanto liberaria ficando com um só", () => {
    const two = detectSubscriptions({ txs: [
      ...["2026-08-05", "2026-09-05"].map((d) => tx("Netflix", 44.9, d)),
      ...["2026-08-10", "2026-09-10"].map((d) => tx("Disney Plus", 33.9, d)),
    ], today });
    const ins = subscriptionInsights(two.active, null);
    expect(ins.overlaps).toHaveLength(1);
    expect(ins.overlaps[0].savings_if_keep_one).toBeCloseTo(33.9, 1);
    expect(ins.max_savings_month).toBeCloseTo(33.9, 1);
  });
});

import { readFileSync } from "node:fs";
describe("fiação da tela", () => {
  it("resumo no topo de Contas que se repetem, com simulação de cancelamento e aviso de cobertura do cartão", () => {
    const page = readFileSync("src/pages/Recorrencias.tsx", "utf8");
    expect(page).toContain("<SubscriptionsSummary");
    expect(page.indexOf("<SubscriptionsSummary")).toBeLessThan(page.indexOf("O Nino achou estas contas"));
    const card = readFileSync("src/components/recurring/SubscriptionsSummary.tsx", "utf8");
    expect(card).toContain("subscription-saving");
    expect(card).toContain("card-coverage-note");
  });
});
