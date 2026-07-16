import { describe, it, expect } from "vitest";
import { parseLegacyPayload } from "@/lib/import/legacy";
import fixture from "./fixtures/financial_ecosystem_v2.json";

describe("parseLegacyPayload", () => {
  it("reconhece todas as chaves reais", () => {
    const r = parseLegacyPayload(fixture);
    expect(r.lancamentos).toBe(3);
    expect(r.metas).toBe(2);
    expect(r.aportes).toBe(1);
    expect(r.dividas).toBe(1);
    expect(r.investimentos).toBe(1);
    expect(r.emocoes).toBe(1);
    expect(r.contasFixas).toBe(1);
    expect(r.categoriasCustom).toBe(4);
  });

  it("mapeia tipo pt-BR para en", () => {
    const r = parseLegacyPayload(fixture);
    const l = (r.normalized as any).lancamentos;
    expect(l[0].tipo).toBe("income");
    expect(l[1].tipo).toBe("expense");
    expect(l[2].tipo).toBe("expense");
  });

  it("parseia valores e datas em formato BR", () => {
    const r = parseLegacyPayload(fixture);
    const l = (r.normalized as any).lancamentos;
    expect(l[2].valor).toBeCloseTo(1234.56);
    expect(l[2].data).toBe("2026-01-10");
  });

  it("aceita payload vazio sem quebrar", () => {
    const r = parseLegacyPayload({});
    expect(r.lancamentos).toBe(0);
  });
});
