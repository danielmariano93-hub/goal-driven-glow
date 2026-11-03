import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HeroDisponivelCard } from "@/components/home/HeroDisponivelCard";

const base = {
  available: 2213.91, confirmedFutureInflows: 0, estimatedFixedInflows: 0, estimatedIncomeEvents: [],
  upcomingCommitments: 0, cardDueThisMonth: 0, projectedEndBalance: 0, freeAfterKnownCommitments: 5963.15,
  periodLabel: "Disponível hoje", hasAccount: true,
};
const wrap = (ui: React.ReactElement) => <MemoryRouter>{ui}</MemoryRouter>;

describe("card do topo com período que já terminou", () => {
  it("período aberto: continua mostrando a posição de hoje e o livre após compromissos", () => {
    render(wrap(<HeroDisponivelCard {...base} />));
    expect(screen.getByText("Livre após compromissos conhecidos")).toBeTruthy();
    expect(screen.queryByTestId("hero-past-period")).toBeNull();
  });
  it("mês fechado: mostra o saldo no último dia e a variação, não o livre de hoje", () => {
    render(wrap(<HeroDisponivelCard {...base} pastPeriod={{ endLabel: "31/10", closingCash: 1000, openingCash: 400 }} />));
    expect(screen.getByText("Saldo em 31/10")).toBeTruthy();
    expect(screen.getByTestId("hero-past-period")).toBeTruthy();
    expect(screen.queryByText("Livre após compromissos conhecidos")).toBeNull();
    expect(screen.getByText(/hoje você tem/)).toBeTruthy();
  });
});
