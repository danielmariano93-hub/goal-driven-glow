import { describe, expect, it } from "vitest";
import { computeCommitmentAgenda } from "@/lib/engine/commitmentAgenda";

describe("meta de doação na agenda canônica", () => {
  const today = new Date(2026, 7, 10);

  it("inclui a doação do mês como compromisso estimado", () => {
    const agenda = computeCommitmentAgenda({
      recurring: [],
      txs: [],
      donations: [{ id: "g1", name: "Doação · Igreja", amount: 250, date: "2026-08-25" }],
      today,
      horizonDays: 30,
    });
    const item = agenda.items.find((i) => i.source === "donation_goal");
    expect(item?.amount).toBe(250);
    expect(item?.estimated).toBe(true);
    expect(agenda.bySource.donation_goal).toBe(250);
  });

  it("ignora doações fora do horizonte ou sem valor", () => {
    const agenda = computeCommitmentAgenda({
      recurring: [],
      txs: [],
      donations: [
        { id: "g1", name: "Zero", amount: 0, date: "2026-08-25" },
        { id: "g2", name: "Longe", amount: 100, date: "2027-01-05" },
      ],
      today,
      horizonDays: 30,
    });
    expect(agenda.items.filter((i) => i.source === "donation_goal")).toHaveLength(0);
  });
});
