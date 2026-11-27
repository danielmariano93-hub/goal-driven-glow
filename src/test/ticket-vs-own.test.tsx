import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { foodSourceByMonth, type BenefitEntry } from "@/lib/engine/benefitWallet";
import { TicketVsOwnChart } from "@/components/ticket/TicketVsOwnChart";

const e = (id: string, occurred_on: string, amount: number, kind: BenefitEntry["kind"] = "spend"): BenefitEntry => ({ id, kind, amount, occurred_on });

describe("foodSourceByMonth", () => {
  it("separa Ticket e bolso por mês da compra, de primeiro gasto no Ticket até hoje", () => {
    const months = foodSourceByMonth(
      [e("1", "2026-09-03", 100), e("2", "2026-09-20", 50), e("c", "2026-09-01", 900, "credit"), e("3", "2026-11-02", 30)],
      [{ occurred_at: "2026-08-30", amount: 999 }, { occurred_at: "2026-09-10", amount: 50 }, { occurred_at: "2026-10-05", amount: 80 }, { occurred_at: "2026-11-30", amount: 70 }],
      "2026-11-27",
    );
    expect(months.map((m) => m.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(months[0]).toMatchObject({ ticket: 150, own: 50, total: 200, ticket_pct: 75, own_pct: 25, partial: false });
    expect(months[1]).toMatchObject({ ticket: 0, own: 80, ticket_pct: 0, own_pct: 100 });
    expect(months[2]).toMatchObject({ ticket: 30, own: 0, ticket_pct: 100, partial: true });
  });
  it("sem gasto no Ticket não há gráfico", () => {
    expect(foodSourceByMonth([e("c", "2026-09-01", 900, "credit")], [{ occurred_at: "2026-09-10", amount: 50 }], "2026-11-27")).toEqual([]);
  });
  it("os valores reais de set–nov somam 100% em cada mês", () => {
    const m = foodSourceByMonth([e("a", "2026-09-05", 1226.51), e("b", "2026-10-05", 1060.79), e("c", "2026-11-05", 871.54)],
      [{ occurred_at: "2026-09-05", amount: 980.44 }, { occurred_at: "2026-10-05", amount: 1357.66 }, { occurred_at: "2026-11-05", amount: 578.74 }], "2026-11-27");
    expect(m.map((x) => [x.ticket_pct, x.own_pct])).toEqual([[56, 44], [44, 56], [60, 40]]);
  });
});

describe("TicketVsOwnChart", () => {
  const months = foodSourceByMonth([e("a", "2026-10-05", 1060.79), e("b", "2026-11-05", 871.54)],
    [{ occurred_at: "2026-10-05", amount: 1357.66 }, { occurred_at: "2026-11-05", amount: 578.74 }], "2026-11-27");
  it("abre no mês atual com a variação e troca de mês ao tocar", () => {
    render(<TicketVsOwnChart months={months} today="2026-11-27" />);
    expect(screen.getByText("+16 p.p. vs outubro")).toBeTruthy();
    expect(screen.getByTestId("ticket-vs-own-detail").textContent).toContain("578,74");
    fireEvent.click(screen.getByRole("button", { name: /^outubro/ }));
    expect(screen.getByTestId("ticket-vs-own-detail").textContent).toContain("1.357,66");
  });
});
