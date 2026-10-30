import { describe, expect, it } from "vitest";
import { buildCauseMonth, computeCauseLedger, type CauseMonth } from "@/lib/engine/causeLedger";

const mk = (month: string, p: Partial<CauseMonth>): CauseMonth => ({ month, income: 0, fixa: 0, parcela_cartao: 0, variavel: 0, pontual: 0, antecipacao: 0, desconhecida: 0, ...p });
const sumEffects = (l: ReturnType<typeof computeCauseLedger>) => Math.round((l.drivers.reduce((s, d) => s + d.effect, 0) + 0) * 100) / 100;

describe("livro de causas v1", () => {
  it("a soma dos efeitos fecha com a variação do caixa livre (identidade contábil)", () => {
    const base = [mk("2026-07", { income: 8000, fixa: 3000, parcela_cartao: 2000, variavel: 2000 }), mk("2026-08", { income: 8200, fixa: 3000, parcela_cartao: 2100, variavel: 2100 }), mk("2026-09", { income: 7800, fixa: 3000, parcela_cartao: 2000, variavel: 1900 })];
    const l = computeCauseLedger(mk("2026-10", { income: 8000, fixa: 3000, parcela_cartao: 4500, variavel: 2000 }), base);
    expect(sumEffects(l)).toBeCloseTo(l.delta, 2);
    expect(l.residual).toBe(0);
    expect(l.mechanism).toBe("compromissos");
    expect(l.main_driver).toBe("parcela_cartao");
  });

  it("mediana: um mês de renda extraordinária no histórico não vira 'queda de renda' (caso real do dono: jul 7,7k, ago 8,5k, set 24,4k, out 8,3k)", () => {
    const base = [mk("2026-07", { income: 7720.9 }), mk("2026-08", { income: 8526.59 }), mk("2026-09", { income: 24355.3 })];
    const l = computeCauseLedger(mk("2026-10", { income: 8330.29 }), base);
    const renda = l.drivers.find((d) => d.key === "renda")!;
    expect(renda.baseline).toBe(8526.59);
    expect(l.mechanism).toBe("estavel");
    expect(l.main_driver).toBeNull();
  });

  it("queda real de renda é nomeada como renda", () => {
    const base = [mk("2026-07", { income: 8000, fixa: 4000 }), mk("2026-08", { income: 8000, fixa: 4000 }), mk("2026-09", { income: 8000, fixa: 4000 })];
    const l = computeCauseLedger(mk("2026-10", { income: 5000, fixa: 4000 }), base);
    expect(l.mechanism).toBe("renda");
    expect(l.main_driver).toBe("renda");
    expect(l.delta).toBe(-3000);
  });

  it("antecipação de parcelas é calendário (timing), não comportamento", () => {
    const base = [mk("2026-07", { income: 8000, parcela_cartao: 3000 }), mk("2026-08", { income: 8000, parcela_cartao: 3000 }), mk("2026-09", { income: 8000, parcela_cartao: 3000 })];
    const l = computeCauseLedger(mk("2026-10", { income: 8000, parcela_cartao: 3000, antecipacao: 4252.02 }), base);
    expect(l.mechanism).toBe("calendario");
    expect(l.drivers.find((d) => d.key === "antecipacao")!.nature).toBe("timing");
  });

  it("variação pequena não inventa causa", () => {
    const base = [mk("2026-07", { income: 8000, variavel: 2000 }), mk("2026-08", { income: 8000, variavel: 2000 })];
    const l = computeCauseLedger(mk("2026-09", { income: 8000, variavel: 2060 }), base);
    expect(l.mechanism).toBe("estavel");
    expect(l.main_driver).toBeNull();
  });

  it("lançamentos sem classificação viram resíduo declarado e baixam a confiança", () => {
    const base = [mk("2026-07", { income: 8000, variavel: 2000 }), mk("2026-08", { income: 8000, variavel: 2000 })];
    const l = computeCauseLedger(mk("2026-09", { income: 8000, variavel: 2000, desconhecida: 3000 }), base);
    expect(l.residual).toBe(-3000);
    expect(l.residual_share).toBe(1);
    expect(l.reasons).toContain("residual_alto");
    expect(l.confidence).toBe("baixa");
  });

  it("poucos meses de comparação reduzem a confiança", () => {
    const l = computeCauseLedger(mk("2026-09", { income: 5000 }), [mk("2026-08", { income: 8000 })]);
    expect(l.reasons).toContain("poucos_meses_de_comparacao");
    expect(l.confidence).not.toBe("alta");
  });

  it("buildCauseMonth agrega por natureza e estorno reduz o consumo", () => {
    const m = buildCauseMonth("2026-10", [
      { kind: "income", amount: 1000, class: "variavel" },
      { kind: "expense", amount: 300, class: "variavel" },
      { kind: "expense", amount: -50, class: "variavel" },
      { kind: "expense", amount: 200, class: "fixa" },
    ]);
    expect(m).toMatchObject({ income: 1000, variavel: 250, fixa: 200 });
  });
});
