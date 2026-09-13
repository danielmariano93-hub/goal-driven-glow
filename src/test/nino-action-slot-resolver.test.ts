import { describe, expect, it } from "vitest";
import {
  bindActionSlots, resolveTargetDateExpression,
} from "../../supabase/functions/_shared/agent/core/ActionSlotResolver.ts";

describe("ActionSlotResolver — backend soberano sobre datas de WRITE", () => {
  const now = new Date("2026-09-13T18:00:00-03:00");

  it("resolve fim do ano sem depender da LLM", () => {
    expect(resolveTargetDateExpression("até o final deste ano", now)).toBe("2026-12-31");
  });

  it("resolve mês futuro para o último dia do mês", () => {
    expect(resolveTargetDateExpression("dezembro", now)).toBe("2026-12-31");
    expect(resolveTargetDateExpression("fevereiro de 2027", now)).toBe("2027-02-28");
  });

  it("não inventa data quando a expressão não é suportada", () => {
    expect(resolveTargetDateExpression("quando der", now)).toBeNull();
  });

  it("ActionIR de meta liga expressão humana ao schema executável", () => {
    const slots = bindActionSlots({
      version: "action_ir.v1",
      action: "goal.create",
      slots: { target_amount: 5000, target_date_expression: "fim do ano" },
    }, now);
    expect(slots.target_amount).toBe(5000);
    expect(slots.target_date).toBe("2026-12-31");
    expect(slots).not.toHaveProperty("target_date_expression");
  });
});
