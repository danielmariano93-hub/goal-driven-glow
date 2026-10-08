import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { summarizeBankGap, GAP_MAX_AGE_MS } from "@/lib/openfinance/useBankBalanceGap";

const now = Date.parse("2026-10-08T12:00:00Z");
const reading = (bank: number, nino: number, ageMs = 3_600_000) => ({
  bank_balance: bank, nino_balance: nino, read_at: new Date(now - ageMs).toISOString(),
});

describe("saldo do banco x Nino: só aparece quando há diferença para analisar", () => {
  it("sem diferença (ou só centavos): nada aparece", () => {
    expect(summarizeBankGap([reading(455.72, 455.72)], now)).toBeNull();
    expect(summarizeBankGap([reading(455.72, 456.2)], now)).toBeNull();
  });
  it("com diferença relevante: devolve os dois saldos", () => {
    const gap = summarizeBankGap([reading(439.74, 455.72)], now);
    expect(gap).toMatchObject({ bank: 439.74, nino: 455.72, diff: 15.98 });
  });
  it("leitura antiga demais é ignorada (o banco muda o dia todo)", () => {
    expect(summarizeBankGap([reading(100, 500, GAP_MAX_AGE_MS + 1000)], now)).toBeNull();
  });
  it("sem leituras (quem não usa Open Finance): nada", () => {
    expect(summarizeBankGap([], now)).toBeNull();
  });
  it("vários bancos: soma antes de comparar", () => {
    const gap = summarizeBankGap([reading(100, 100), reading(50, 80)], now);
    expect(gap).toMatchObject({ bank: 150, nino: 180, diff: 30 });
  });
  it("a função grava a leitura só na ação balance e nunca em lançamentos; a Home usa o indicador discreto", () => {
    const fn = readFileSync("supabase/functions/openfinance-sync/index.ts", "utf8");
    expect(fn).toContain('from("bank_balance_readings").upsert');
    expect(fn).not.toMatch(/from\("transactions"\)\.(insert|update|upsert|delete)/);
    const hero = readFileSync("src/components/home/HeroDisponivelCard.tsx", "utf8");
    expect(hero).toContain("p.bankGap");
    expect(hero).toContain("text-[11px]");
  });
});
