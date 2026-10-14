import { describe, expect, it } from "vitest";
import { commitmentStatus, commitmentWindowEnd, upcomingCommitments } from "@/lib/engine/commitmentView";
import type { CommitmentItem } from "@/lib/engine/commitmentAgenda";

const item = (over: Partial<CommitmentItem>): CommitmentItem => ({
  id: "x", name: "Conta", type: "expense", amount: 100, date: "2026-10-20", source: "recurring",
  estimated: false, dedupKey: over.date ?? "k", payment_status: "pending", ...over,
});

describe("compromissos: janela e estado", () => {
  it("janela vai até o dia 7 do mês seguinte (inclusive virada de ano)", () => {
    expect(commitmentWindowEnd("2026-10-14")).toBe("2026-11-07");
    expect(commitmentWindowEnd("2026-12-30")).toBe("2027-01-07");
  });
  it("rótulos: pago, hoje, amanhã, em N dias e atraso com dias", () => {
    const t = "2026-10-14";
    expect(commitmentStatus(item({ payment_status: "paid" }), t).label).toBe("Pago");
    expect(commitmentStatus(item({ date: "2026-10-14" }), t).label).toBe("Vence hoje");
    expect(commitmentStatus(item({ date: "2026-10-15" }), t).label).toBe("Vence amanhã");
    expect(commitmentStatus(item({ date: "2026-10-20" }), t).label).toBe("Vence em 6 dias");
    expect(commitmentStatus(item({ date: "2026-10-11", payment_status: "overdue" }), t)).toMatchObject({ kind: "overdue", days: 3, label: "Em atraso há 3 dias" });
  });
  it("lista: atrasados primeiro, só até a janela, pagos do passado fora", () => {
    const t = "2026-10-14";
    const out = upcomingCommitments([
      item({ id: "far", date: "2026-11-20", dedupKey: "far" }),
      item({ id: "edge", date: "2026-11-07", dedupKey: "edge" }),
      item({ id: "late", date: "2026-10-10", payment_status: "overdue", dedupKey: "late" }),
      item({ id: "paidold", date: "2026-10-02", payment_status: "paid", dedupKey: "po" }),
      item({ id: "paidnext", date: "2026-10-18", payment_status: "paid", dedupKey: "pn" }),
      item({ id: "soon", date: "2026-10-16", dedupKey: "soon" }),
    ], t).map((i) => i.id);
    expect(out).toEqual(["late", "soon", "edge", "paidnext"]);
  });
});
