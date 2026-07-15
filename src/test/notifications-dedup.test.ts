import { describe, it, expect } from "vitest";

// Este teste é conceitual — a idempotência real é garantida no banco via UNIQUE(user_id, dedup_key).
// Aqui garantimos que o helper de dedup produz a mesma chave para o mesmo evento.

function dedupKey(type: string, ...parts: string[]): string {
  return `${type}:${parts.join(":")}`;
}

describe("notifications dedup", () => {
  it("mesmo evento produz mesma chave", () => {
    expect(dedupKey("goal_reached", "goal-1")).toBe(dedupKey("goal_reached", "goal-1"));
  });
  it("eventos diferentes produzem chaves distintas", () => {
    expect(dedupKey("goal_reached", "goal-1")).not.toBe(dedupKey("goal_reached", "goal-2"));
  });
});
