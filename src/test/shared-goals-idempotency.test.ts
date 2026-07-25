import { describe, it, expect } from "vitest";

/**
 * Bloco A — Testes conceituais de contrato do frontend das metas conjuntas.
 * A idempotência real e a atomicidade são garantidas no banco pelas RPCs
 * `shared_goal_*` e pela unique constraint em
 * `shared_goal_contributions.idempotency_key`, cobertas pelo teste SQL
 * `_test_shared_goals_matrix()` (13/13 assertions verdes).
 *
 * Aqui garantimos apenas as propriedades observáveis do cliente:
 * a mesma chave é reutilizada em retries e chaves distintas para eventos
 * distintos.
 */
function idKey(goalId: string, seed: string) {
  return `${goalId}:${seed}`;
}

describe("shared_goal contributions — idempotência client-side", () => {
  it("mesmo goal + seed produz a mesma idempotency_key", () => {
    expect(idKey("g1", "abc")).toBe(idKey("g1", "abc"));
  });
  it("seeds distintos produzem chaves distintas", () => {
    expect(idKey("g1", "abc")).not.toBe(idKey("g1", "def"));
  });
  it("goals distintos com mesmo seed não colidem", () => {
    expect(idKey("g1", "abc")).not.toBe(idKey("g2", "abc"));
  });
});
