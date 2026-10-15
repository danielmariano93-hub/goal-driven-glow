import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { groupReceivables, splitDueView, type ReceivableLite } from "@/lib/split/overdue";

const r = (state: string, due: string, extra: Partial<ReceivableLite> = {}): ReceivableLite =>
  ({ shared_expense_id: "e1", state, due_date: due, phone_e164: "+55", ...extra });

describe("atraso de rolê pela parcela, não pela data da divisão", () => {
  it("caso real (Divisão Carro RJ): 1ª parcela paga pelos dois, 2ª vence em 07/11 → NÃO atrasada", () => {
    const v = splitDueView({
      status: "active", splitDueDate: "2026-10-07", today: "2026-10-15",
      receivables: [r("paid", "2026-10-07"), r("paid", "2026-10-07"), r("pending", "2026-11-07"), r("pending", "2026-11-07")],
    });
    expect(v.overdue).toBe(false);
    expect(v.nextDue).toBe("2026-11-07");
    expect(v.source).toBe("installments");
  });

  it("parcela vencida e não paga → atrasada, com o vencimento aberto mais antigo", () => {
    const v = splitDueView({
      status: "active", splitDueDate: "2026-10-07", today: "2026-10-15",
      receivables: [r("overdue", "2026-10-07"), r("pending", "2026-11-07")],
    });
    expect(v.overdue).toBe(true);
    expect(v.nextDue).toBe("2026-10-07");
  });

  it("parcela parcial ainda conta como aberta", () => {
    expect(splitDueView({ status: "active", splitDueDate: null, today: "2026-10-15", receivables: [r("partial", "2026-10-20")] }).nextDue).toBe("2026-10-20");
  });

  it("divisão concluída, cancelada ou excluída nunca aparece como atrasada", () => {
    for (const status of ["settled", "cancelled"]) {
      expect(splitDueView({ status, splitDueDate: "2026-01-01", today: "2026-10-15", receivables: [r("overdue", "2026-01-01")] }).overdue).toBe(false);
    }
    expect(splitDueView({ status: "active", deleted: true, splitDueDate: "2026-01-01", today: "2026-10-15", receivables: [] }).overdue).toBe(false);
  });

  it("sem parcelas materializadas (divisão antiga), vale a data da divisão", () => {
    const v = splitDueView({ status: "active", splitDueDate: "2026-10-07", today: "2026-10-15", receivables: [] });
    expect(v).toMatchObject({ overdue: true, source: "split_due_date" });
  });

  it("agrupa por divisão", () => {
    const m = groupReceivables([r("paid", "x"), { ...r("pending", "y"), shared_expense_id: "e2" }]);
    expect(m.get("e1")).toHaveLength(1);
    expect(m.get("e2")).toHaveLength(1);
  });
});

describe("a lista usa a mesma fonte do detalhe e dos lembretes", () => {
  const page = readFileSync("src/pages/DivisaoDoRole.tsx", "utf8");
  it("não compara mais a data da divisão inteira com hoje", () => {
    expect(page).not.toMatch(/s\.due_date\s*<\s*(today\(\)|todayIso)/);
    expect(page).toContain("splitDueView(");
    expect(page).toContain("split_receivables_v1");
  });
});
