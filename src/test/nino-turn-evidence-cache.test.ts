import { describe, expect, it } from "vitest";
import {
  createTurnEvidenceCache,
  isWriteTool,
} from "../../supabase/functions/_shared/agent/core/TurnEvidenceCache.ts";
import { renderMessageTemplate } from "../../supabase/functions/_shared/agent/messageTemplates.ts";

const exec = (result: unknown, ok = true) => ({
  tool_name: "t", args: {}, ok, result, error: ok ? null : "boom",
  duration_ms: 12, retries: 0,
});

describe("nino_turn_cache.v1", () => {
  it("executa a mesma leitura uma única vez por turno", async () => {
    const cache = createTurnEvidenceCache();
    let calls = 0;
    const run = () => cache.run("get_financial_snapshot", { from: "2026-09-01" }, async () => {
      calls++;
      return exec({ balance: 10 });
    });
    const a = await run();
    const b = await run();
    expect(calls).toBe(1);
    expect(a.reused).toBeFalsy();
    expect(b.reused).toBe(true);
    expect(b.result).toEqual({ balance: 10 });
    expect(cache.stats().reuses).toBe(1);
  });

  it("nunca reexecuta ferramenta de escrita, mesmo após falha", async () => {
    const cache = createTurnEvidenceCache();
    let calls = 0;
    const run = () => cache.run("create_transaction_draft", { amount: 50 }, async () => {
      calls++;
      return exec(null, false);
    });
    await run();
    const second = await run();
    expect(calls).toBe(1);
    expect(second.reused).toBe(true);
    expect(cache.stats().write_reuses).toBe(1);
  });

  it("reexecuta leitura que falhou (falha pode ser transitória)", async () => {
    const cache = createTurnEvidenceCache();
    let calls = 0;
    const run = () => cache.run("analyze_spending", {}, async () => {
      calls++;
      return calls === 1 ? exec(null, false) : exec({ total: 1 });
    });
    await run();
    const second = await run();
    expect(calls).toBe(2);
    expect(second.ok).toBe(true);
  });

  it("classifica escritas e drafts como não repetíveis", () => {
    expect(isWriteTool("confirm_pending_action")).toBe(true);
    expect(isWriteTool("create_goal_draft")).toBe(true);
    expect(isWriteTool("get_financial_summary")).toBe(false);
  });
});

describe("cobrança de divisão do rolê identifica o rolê", () => {
  const values = {
    title: "Churrasco do sábado",
    owner_name: "Lucas",
    participant_name: "Ana",
    installment_label: "2ª parcela de 3",
    amount: "R$ 100,00",
    due_date: "10/09",
  } as Record<string, string>;

  for (const kind of ["reminder", "due_soon", "due_today", "overdue"]) {
    it(`inclui título e responsável em ${kind}`, () => {
      const text = renderMessageTemplate(kind, null, values);
      expect(text).toContain("Churrasco do sábado");
      expect(text).toContain("Lucas");
      expect(text).toContain("2ª parcela de 3");
    });
  }
});
