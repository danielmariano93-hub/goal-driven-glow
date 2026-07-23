/**
 * Testes de fumaça da LP pública Meu Nino.IA.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import LandingPage from "@/pages/landing/LandingPage";

function renderLP() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

describe("LandingPage", () => {
  it("renderiza headline principal e badge", () => {
    renderLP();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /você não precisa controlar cada centavo/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/inteligência financeira que conversa/i)).toBeInTheDocument();
  });

  it("todos os CTAs de cadastro apontam para /signup e o de login para /login", () => {
    const { container } = renderLP();
    const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const hrefs = anchors.map((a) => a.getAttribute("href"));
    // Sem placeholders fictícios de WhatsApp
    for (const h of hrefs) {
      expect(h).not.toMatch(/wa\.me\/?$/);
      expect(h).not.toBe("#");
    }
    // Pelo menos um link para signup e um para login
    expect(hrefs.filter((h) => h === "/signup").length).toBeGreaterThanOrEqual(2);
    expect(hrefs).toContain("/login");
  });

  it("FAQ renderiza 5 perguntas como <details>", () => {
    const { container } = renderLP();
    const details = container.querySelectorAll(".lp-faq details");
    expect(details.length).toBe(5);
  });

  it("SocialProof fica oculto por default (flag desligada)", () => {
    renderLP();
    expect(
      screen.queryByText(/exemplo demonstrativo/i),
    ).not.toBeInTheDocument();
  });

  it("não contém referências à marca antiga NoControle", () => {
    const { container } = renderLP();
    expect(container.textContent ?? "").not.toMatch(/NoControle/i);
    expect(container.textContent ?? "").toMatch(/Meu Nino/);
  });
});
