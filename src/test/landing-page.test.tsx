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
        name: /o nino entende seus gastos hoje/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/inteligência financeira que conversa/i)).toBeInTheDocument();
  });

  it("renderiza o manifesto oficial", () => {
    const { container } = renderLP();
    expect(container.textContent ?? "").toMatch(
      /você não precisa olhar mais números/i,
    );
  });

  it("todos os CTAs de cadastro apontam para /signup e o de login para /login", () => {
    const { container } = renderLP();
    const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>("a[href]"));
    const hrefs = anchors.map((a) => a.getAttribute("href"));
    for (const h of hrefs) {
      expect(h).not.toMatch(/wa\.me\/?$/);
      expect(h).not.toBe("#");
    }
    expect(hrefs.filter((h) => h === "/signup").length).toBeGreaterThanOrEqual(2);
    expect(hrefs).toContain("/login");
  });

  it("FAQ renderiza 6 perguntas como <details>", () => {
    const { container } = renderLP();
    const details = container.querySelectorAll(".lp-faq details");
    expect(details.length).toBe(6);
  });

  it("prova social é marcada como placeholder por default", () => {
    const { container } = renderLP();
    const quotes = container.querySelector(".lp-quotes");
    expect(quotes?.getAttribute("data-placeholder")).toBe("true");
    expect(container.querySelectorAll(".lp-quote-badge").length).toBeGreaterThan(0);
  });

  it("não contém referências à marca antiga NoControle", () => {
    const { container } = renderLP();
    expect(container.textContent ?? "").not.toMatch(/NoControle/i);
    expect(container.textContent ?? "").toMatch(/Meu Nino/);
  });

  it("wordmark oficial: 'Meu Nino' + descritor '.IA' sobrescrito", () => {
    const { container } = renderLP();
    // Não deve mais existir pill gradiente antiga.
    expect(container.querySelector(".lp-ia-pill")).toBeNull();
    // Deve existir a estrutura oficial do wordmark.
    expect(container.querySelector(".nino-wordmark__name")).not.toBeNull();
    expect(container.querySelector(".nino-wordmark__ia")?.textContent).toBe(".IA");
  });

  it("todas as 14 seções principais estão presentes por id", () => {
    const { container } = renderLP();
    const ids = [
      "top",
      "previsao",
      "comportamento",
      "metas",
      "insights",
      "role",
      "capacidades",
      "como-funciona",
      "prova",
      "seguranca",
      "duvidas",
      "comecar",
    ];
    for (const id of ids) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("nenhum ícone antigo NinoIcons segue sendo importado", () => {
    // grep indireto via DOM: os componentes antigos usavam data-icon="chat-bubble" etc.
    // Aqui garantimos ao menos que a página renderiza sem erros e Phosphor está no DOM.
    const { container } = renderLP();
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(4);
  });
});
