import { describe, expect, it } from "vitest";
import { benefitSituations, isBenefitAlertWindow } from "../../supabase/functions/_shared/proactive/benefitSituations";
import { computeBenefitState, type BenefitEntry, type BenefitWalletConfig } from "@/lib/engine/benefitWallet";

const wallet: BenefitWalletConfig = { monthly_credit: 900, credit_day: 5, carries_over: true };
let n = 0;
const e = (kind: BenefitEntry["kind"], amount: number, occurred_on: string, merchant?: string): BenefitEntry => ({ id: `e${++n}`, kind, amount, occurred_on, merchant });
const ctx = { as_of: "2026-11-18", snapshot_ref: { reconciliation_id: "r1" } } as never;
// 12h em São Paulo (15h UTC); 23h em São Paulo (02h UTC do dia seguinte).
const NOON = new Date("2026-11-18T15:00:00Z");
const NIGHT = new Date("2026-11-19T02:00:00Z");

// Cenário dourado: saldo 412,40; ritmo 35,69; acaba 30/11; faltam 194,33 (status "short").
const cycle: BenefitEntry[] = [
  e("balance_reading", 12, "2026-11-04"),
  e("spend", 80, "2026-11-05", "Mercado"), e("spend", 45, "2026-11-06"), e("spend", 52.8, "2026-11-07"), e("spend", 70.3, "2026-11-09"),
  e("spend", 39, "2026-11-10"), e("spend", 21, "2026-11-12"), e("spend", 83.5, "2026-11-13"), e("spend", 64, "2026-11-14"), e("spend", 44, "2026-11-15"),
];
const state = (entries: BenefitEntry[], today = "2026-11-18") => computeBenefitState(wallet, entries, today);

describe("avisos do Ticket por mudança", () => {
  it("projeção que não fecha vira aviso com data, falta (do bolso) e teto diário", () => {
    const [s] = benefitSituations(state(cycle), ctx, NOON);
    expect(s.type).toBe("benefit_projection");
    expect(s.severity).toBe("attention");
    expect(s.title).toContain("30/11");
    expect(s.body).toContain("sai do seu bolso");
    expect(s.body).toMatch(/R\$\s*194,33/);
    expect(s.body).toMatch(/R\$\s*24,26/);
    expect(s.impact_amount).toBe(194.33);
  });

  it("o mesmo estado não gera aviso novo (mesmo identificador) e um estado novo gera", () => {
    const a = benefitSituations(state(cycle), ctx, NOON)[0].fingerprint;
    const sameStateNextDay = benefitSituations(state(cycle, "2026-11-18"), ctx, NOON)[0].fingerprint;
    expect(sameStateNextDay).toBe(a);
    // gasto grande acelera o esgotamento: faixa nova ⇒ aviso novo
    const worse = benefitSituations(state([...cycle, e("spend", 150, "2026-11-17", "Restaurante")]), ctx, NOON)[0].fingerprint;
    expect(worse).not.toBe(a);
  });

  it("cobertura folgada não avisa", () => {
    const calm = [e("balance_reading", 900, "2026-11-04"), e("spend", 10, "2026-11-10"), e("spend", 10, "2026-11-12")];
    expect(benefitSituations(state(calm), ctx, NOON).filter((s) => s.type === "benefit_projection")).toEqual([]);
  });

  it("sem leitura de saldo não inventa aviso de projeção", () => {
    expect(benefitSituations(state([]), ctx, NOON)).toEqual([]);
  });

  it("de noite não envia (silêncio 20h–8h)", () => {
    expect(isBenefitAlertWindow(NIGHT)).toBe(false);
    expect(benefitSituations(state(cycle), ctx, NIGHT)).toEqual([]);
  });

  it("leitura antiga com gastos depois pede o saldo de hoje, uma vez por semana de atraso", () => {
    const old = [e("balance_reading", 500, "2026-11-05"), e("spend", 30, "2026-11-10")];
    const s = benefitSituations(state(old, "2026-11-18"), ctx, NOON).find((x) => x.type === "benefit_stale_reading");
    expect(s?.body).toContain("ticket 412,40");
    expect(s?.fingerprint).toContain("stale_reading");
  });
});
