/**
 * Testes de fumaça da LP pública Meu Nino.IA — redesign 7 blocos.
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

describe("LandingPage — redesign 7 blocos", () => {
  it("renderiza headline principal exata", () => {
    renderLP();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /seu dinheiro não está desorganizado\.\s*só faltava alguém para cuidar dele com você\./i,
      }),
    ).toBeInTheDocument();
  });

  it("contém as sete âncoras dos blocos oficiais", () => {
    const { container } = renderLP();
    for (const id of [
      "top",
      "manifesto",
      "demonstracao",
      "transformacao",
      "role",
      "simples",
      "comecar",
      "duvidas",
    ]) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("não expõe seções antigas como blocos autônomos", () => {
    const { container } = renderLP();
    for (const id of [
      "previsao",
      "comportamento",
      "metas",
      "insights",
      "capacidades",
      "como-funciona",
      "confianca",
      "seguranca",
    ]) {
      expect(container.querySelector(`#${id}`)).toBeNull();
    }
  });

  it("FAQ tem exatamente 5 perguntas", () => {
    const { container } = renderLP();
    const details = container.querySelectorAll(".lp-faq details");
    expect(details.length).toBe(5);
  });

  it("CTAs de cadastro apontam para /signup e login para /login", () => {
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

  it("microcopy oficial de gratuidade presente no hero", () => {
    const { container } = renderLP();
    expect(container.textContent ?? "").toMatch(
      /grátis para começar\s*·\s*sem cartão\s*·\s*menos de 1 minuto/i,
    );
  });

  it("manifesto contém as frases oficiais em sequência", () => {
    const { container } = renderLP();
    const txt = container.textContent ?? "";
    expect(txt).toMatch(/o mês não sai do controle em um único gasto/i);
    expect(txt).toMatch(/uma assinatura esquecida/i);
    expect(txt).toMatch(/quando você percebe, a fatura já fechou/i);
    expect(txt).toMatch(/o nino acompanha esses sinais com você/i);
  });

  it("não contém prova social fictícia, selos ou claims proibidos", () => {
    const { container } = renderLP();
    const txt = container.textContent ?? "";
    expect(txt).not.toMatch(/NoControle/i);
    expect(txt).not.toMatch(/LGPD/i);
    expect(txt).not.toMatch(/criptografia/i);
    expect(txt).not.toMatch(/100% seguro/i);
    expect(txt).not.toMatch(/HTTPS\/TLS/i);
    expect(txt).not.toMatch(/persona demonstrativa/i);
    expect(container.querySelector(".lp-quotes")).toBeNull();
  });

  it("Divisão do Rolê promete apenas 'preparar lembrete'", () => {
    const { container } = renderLP();
    const txt = container.textContent ?? "";
    expect(txt).toMatch(/preparar lembrete/i);
    expect(txt).not.toMatch(/envia lembrete/i);
    expect(txt).not.toMatch(/cobrança automática/i);
    expect(txt).not.toMatch(/pix/i);
  });

  it("wordmark oficial: 'Meu Nino' + descritor '.IA' sobrescrito", () => {
    const { container } = renderLP();
    expect(container.querySelector(".lp-ia-pill")).toBeNull();
    expect(container.querySelector(".nino-wordmark__name")).not.toBeNull();
    expect(container.querySelector(".nino-wordmark__ia")?.textContent).toBe(".IA");
  });
});
