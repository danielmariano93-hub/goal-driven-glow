import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActNav, ActSection, ProjectionCard, parseAct } from "@/components/reports/ReportActs";
import { ninoRedirectTarget } from "@/lib/navigation/ninoRedirect";
import { resolveAppRoute } from "@/lib/navigation/resolveRoute";
import type { ReportDashboard } from "@/lib/engine/reportDashboard";

const dash = (over: Partial<ReportDashboard>) => ({ filtered: false, projection: null, ...over }) as ReportDashboard;
const projection = { expense: 4200, daysElapsed: 10, daysInMonth: 30, previousMonthExpense: 5000, early: false, fixedKnown: 0, source: "home" as const,
  composition: { realized: 1500, variable: 1700, commitments: 600, cardDue: 400, confidence: "alta" } };

describe("Relatórios em 3 atos", () => {
  it("ato desconhecido cai em 'Como foi'", () => {
    expect(parseAct(null)).toBe("foi");
    expect(parseAct("xyz")).toBe("foi");
    expect(parseAct("vai")).toBe("vai");
  });
  it("atalho marca a seção atual por aria, não só por cor", () => {
    render(<ActNav active="mudou" onChange={() => {}} counts={{ mudou: 2 }} />);
    expect(screen.getByRole("button", { name: /O que mudou/ }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: /Como foi/ }).getAttribute("aria-current")).toBeNull();
  });
  it("cada ato é uma seção da mesma página, com número e título", () => {
    render(<ActSection id="vai"><p>conteúdo</p></ActSection>);
    expect(screen.getByRole("heading", { name: "Para onde vai" })).toBeTruthy();
    expect(document.getElementById("ato-vai")).not.toBeNull();
    expect(screen.getByText("3")).toBeTruthy();
  });
  it("projeção mostra número, comparação e composição reais; some sem dado ou com filtro", () => {
    const { rerender, container } = render(<ProjectionCard d={dash({ projection })} />);
    expect(screen.getByTestId("projection-card").textContent).toMatch(/4\.200/);
    expect(screen.getByTestId("projection-card").textContent).toMatch(/abaixo/);
    expect(screen.getByText("Já gasto")).toBeTruthy();
    rerender(<ProjectionCard d={dash({ projection: null })} />);
    expect(container.innerHTML).toBe("");
    rerender(<ProjectionCard d={dash({ projection, filtered: true })} />);
    expect(container.innerHTML).toBe("");
  });
  it("links antigos da aba Nino caem no lugar certo", () => {
    expect(ninoRedirectTarget(null)).toBe("/app");
    expect(ninoRedirectTarget("agora")).toBe("/app");
    expect(ninoRedirectTarget("mudancas")).toBe("/app/relatorios?ato=mudou");
    expect(ninoRedirectTarget("prepare-se")).toBe("/app/relatorios?ato=vai");
    expect(resolveAppRoute("/app/nino?section=aprendizados")).toBe("/app/relatorios?ato=mudou");
    expect(resolveAppRoute("/app/nino")).toBe("/app");
  });
});
