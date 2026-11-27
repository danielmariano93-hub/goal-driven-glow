import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { foodSourceByCycle, type BenefitEntry } from "@/lib/engine/benefitWallet";
import { TicketVsOwnChart } from "@/components/ticket/TicketVsOwnChart";

const e = (id: string, occurred_on: string, amount: number, kind: BenefitEntry["kind"] = "spend"): BenefitEntry => ({ id, kind, amount, occurred_on });
const w = { credit_day: 27 };

describe("foodSourceByCycle", () => {
  it("agrupa por ciclo de recarga (a recarga real antecipada marca o início), não por mês do calendário", () => {
    const entries = [
      e("old", "2026-09-10", 500),                       // antes da 1ª recarga lançada: fora
      e("c1", "2026-09-25", 1281.06, "credit"),
      e("a", "2026-09-26", 600), e("b", "2026-10-26", 680), // ciclo 25/09–26/10
      e("c2", "2026-10-27", 1227.16, "credit"),
      e("c", "2026-10-28", 400), e("d", "2026-11-26", 820), // ciclo 27/10–26/11
    ];
    const own = [{ occurred_at: "2026-10-01", amount: 100 }, { occurred_at: "2026-11-20", amount: 300 }, { occurred_at: "2026-09-01", amount: 999 }];
    const c = foodSourceByCycle(w, entries, own, "2026-11-27");
    expect(c.map((x) => [x.start, x.end, x.label_month])).toEqual([["2026-09-25", "2026-10-26", "2026-10"], ["2026-10-27", "2026-11-26", "2026-11"]]);
    expect(c[0]).toMatchObject({ ticket: 1280, own: 100, partial: false });
    expect(c[1]).toMatchObject({ ticket: 1220, own: 300, partial: false });
  });
  it("o ciclo em andamento só entra quando já tem gasto", () => {
    const entries = [e("c1", "2026-10-27", 1000, "credit"), e("a", "2026-11-01", 900), e("b", "2026-11-28", 30)];
    expect(foodSourceByCycle(w, entries, [], "2026-11-27").map((x) => x.start)).toEqual(["2026-10-27"]);
    const c = foodSourceByCycle(w, entries, [], "2026-11-28");
    expect(c.map((x) => [x.start, x.partial])).toEqual([["2026-10-27", false], ["2026-11-27", true]]);
  });
  it("sem gasto no Ticket não há gráfico", () => {
    expect(foodSourceByCycle(w, [e("c", "2026-09-25", 900, "credit")], [{ occurred_at: "2026-09-30", amount: 50 }], "2026-11-27")).toEqual([]);
  });
});

describe("TicketVsOwnChart", () => {
  const cycles = foodSourceByCycle(w, [e("c1", "2026-09-25", 1281, "credit"), e("a", "2026-10-05", 1285.93), e("c2", "2026-10-27", 1227, "credit"), e("b", "2026-11-05", 1237.45)],
    [{ occurred_at: "2026-10-05", amount: 1427.18 }, { occurred_at: "2026-11-05", amount: 725.97 }], "2026-11-27");
  it("abre no último ciclo com o período escrito e troca ao tocar", () => {
    render(<TicketVsOwnChart cycles={cycles} today="2026-11-27" />);
    expect(screen.getByText(/ciclo de 27\/10 a 26\/11/)).toBeTruthy();
    expect(screen.getByText("+16 p.p. vs ciclo anterior")).toBeTruthy();
    expect(screen.getByTestId("ticket-vs-own-detail").textContent).toContain("1.237,45");
    fireEvent.click(screen.getByRole("button", { name: /^Ciclo de 25\/09/ }));
    expect(screen.getByTestId("ticket-vs-own-detail").textContent).toContain("1.285,93");
  });
});
