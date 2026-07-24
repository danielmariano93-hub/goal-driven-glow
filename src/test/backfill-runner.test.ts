import { describe, it, expect } from "vitest";

/**
 * Teste da lógica de advancePhase: reimplementamos a máquina em isolamento
 * (mirror do runner) e validamos as transições. Isso evita rodar o Deno.serve
 * do módulo, que depende de env vars do runtime da edge function.
 */
type Phase = "baseline" | "backfill" | "dual_read" | "cutover";
type Checkpoint = { phase: Phase; cursor_user_id: string };

async function advancePhase(
  cp: Checkpoint,
  computeDiverges: (userId: string) => Promise<boolean>,
): Promise<Phase> {
  if (cp.phase === "baseline") return "backfill";
  if (cp.phase === "backfill") return "dual_read";
  if (cp.phase === "dual_read") {
    const div = await computeDiverges(cp.cursor_user_id);
    return div ? "dual_read" : "cutover";
  }
  return cp.phase;
}

describe("finance-backfill-runner state machine", () => {
  it("baseline avança para backfill sem I/O", async () => {
    const next = await advancePhase({ phase: "baseline", cursor_user_id: "u1" }, async () => true);
    expect(next).toBe("backfill");
  });

  it("backfill avança para dual_read", async () => {
    const next = await advancePhase({ phase: "backfill", cursor_user_id: "u1" }, async () => true);
    expect(next).toBe("dual_read");
  });

  it("dual_read avança para cutover quando não há divergência", async () => {
    const next = await advancePhase({ phase: "dual_read", cursor_user_id: "u1" }, async () => false);
    expect(next).toBe("cutover");
  });

  it("dual_read permanece em dual_read quando há divergência", async () => {
    const next = await advancePhase({ phase: "dual_read", cursor_user_id: "u1" }, async () => true);
    expect(next).toBe("dual_read");
  });

  it("cutover é terminal", async () => {
    const next = await advancePhase({ phase: "cutover", cursor_user_id: "u1" }, async () => false);
    expect(next).toBe("cutover");
  });
});
