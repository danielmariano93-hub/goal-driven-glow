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
  it("renderiza headline principal", () => {
    renderLP();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /seu dinheiro não está desorganizado/i,
      }),
    ).toBeInTheDocument();
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

  it("não exibe depoimentos fictícios (prova social removida)", () => {
    const { container } = renderLP();
    expect(container.querySelector(".lp-quotes")).toBeNull();
    expect(container.querySelector(".lp-quote-badge")).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/persona demonstrativa/i);
  });

  it("não contém referências à marca antiga NoControle", () => {
    const { container } = renderLP();
    expect(container.textContent ?? "").not.toMatch(/NoControle/i);
    expect(container.textContent ?? "").toMatch(/Meu Nino/);
  });

  it("wordmark oficial: 'Meu Nino' + descritor '.IA' sobrescrito", () => {
    const { container } = renderLP();
    expect(container.querySelector(".lp-ia-pill")).toBeNull();
    expect(container.querySelector(".nino-wordmark__name")).not.toBeNull();
    expect(container.querySelector(".nino-wordmark__ia")?.textContent).toBe(".IA");
  });

  it("seções principais estão presentes por id", () => {
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
      "confianca",
      "seguranca",
      "duvidas",
      "comecar",
    ];
    for (const id of ids) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("copy de segurança não inventa criptografia específica nem selos", () => {
    const { container } = renderLP();
    const txt = container.textContent ?? "";
    expect(txt).not.toMatch(/HTTPS\/TLS/i);
    expect(txt).not.toMatch(/LGPD como padrão/i);
    expect(txt).toMatch(/seu dinheiro é pessoal/i);
  });
});
