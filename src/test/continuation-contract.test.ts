import { describe, it, expect } from "vitest";
import {
  detectContinuationOffer,
  resolveContinuation,
  isAffirmativeAnswer,
} from "../../supabase/functions/_shared/agent/core/ContinuationContract.ts";

const OFFER = "Seus gastos caíram 12% 💸. Quer comparar o acumulado do dia 1º até hoje com o mesmo período do mês passado? Me dá o ok.";

describe("nino_continuation.v1", () => {
  it("detecta oferta de comparação e o modo equivalente", () => {
    const a = detectContinuationOffer(OFFER)!;
    expect(a.action_type).toBe("financial_comparison");
    expect(a.requested_operation.comparison_mode).toBe("MTD_EQUIVALENT");
  });

  it("não cria pendência em resposta sem oferta", () => {
    expect(detectContinuationOffer("Você gastou R$ 120 em Mercado.")).toBeNull();
  });

  it('"ok" executa a operação oferecida', () => {
    const action = detectContinuationOffer(OFFER)!;
    const r = resolveContinuation({ text: "Ok", action, hasPendingWrite: false });
    expect(r.continue).toBe(true);
    expect(r.prompt).toContain("mesmo período do mês passado");
  });

  it("escrita financeira pendente tem precedência", () => {
    const action = detectContinuationOffer(OFFER)!;
    expect(resolveContinuation({ text: "sim", action, hasPendingWrite: true }).continue).toBe(false);
  });

  it("negativa e assunto novo não continuam", () => {
    const action = detectContinuationOffer(OFFER)!;
    expect(resolveContinuation({ text: "não", action, hasPendingWrite: false }).continue).toBe(false);
    expect(resolveContinuation({ text: "quanto gastei em julho no mercado?", action, hasPendingWrite: false }).continue).toBe(false);
  });

  it("oferta expirada é ignorada", () => {
    const action = detectContinuationOffer(OFFER, new Date(Date.now() - 7 * 3600_000))!;
    expect(resolveContinuation({ text: "ok", action, hasPendingWrite: false }).continue).toBe(false);
  });

  it("afirmativas curtas aceitas", () => {
    for (const t of ["ok", "Sim", "pode", "manda", "beleza"]) expect(isAffirmativeAnswer(t)).toBe(true);
    expect(isAffirmativeAnswer("agora não")).toBe(false);
  });
});
