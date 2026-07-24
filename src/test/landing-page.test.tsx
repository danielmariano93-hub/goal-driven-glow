/**
 * Testes de fumaça da LP pública Meu Nino.IA — redesign narrativo 6 capítulos.
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

describe("LandingPage — redesign 6 capítulos", () => {
  it("renderiza headline principal exata", () => {
    renderLP();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /seu dinheiro não está desorganizado\.\s*só faltava alguém para cuidar dele com você\./i,
      }),
    ).toBeInTheDocument();
  });

  it("contém as âncoras oficiais dos capítulos", () => {
    const { container } = renderLP();
    for (const id of [
      "top",
      "hero",
      "reconhecimento",
      "acao",
      "mes",
      "role",
      "comecar",
      "duvidas",
    ]) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
  });

  it("não expõe seções antigas removidas", () => {
    const { container } = renderLP();
    for (const id of [
      "manifesto",
      "demonstracao",
      "transformacao",
      "simples",
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

  it("não renderiza CTA fixo mobile em nenhuma forma", () => {
    const { container } = renderLP();
    expect(container.querySelector(".lp-mobile-cta")).toBeNull();
  });

  it("não renderiza seção autônoma de passos genéricos", () => {
    const { container } = renderLP();
    expect(container.querySelector(".lp-steps")).toBeNull();
    expect(container.querySelector(".lp-step-num")).toBeNull();
  });

  it("FAQ tem exatamente 4 perguntas", () => {
    const { container } = renderLP();
    const details = container.querySelectorAll(".lp-faq details");
    expect(details.length).toBe(4);
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

  it("capítulo de reconhecimento traz a timeline oficial", () => {
    const { container } = renderLP();
    const txt = container.textContent ?? "";
    expect(txt).toMatch(/o mês não sai do controle de uma vez/i);
    expect(txt).toMatch(/assinatura que você esqueceu/i);
    expect(txt).toMatch(/separados, parecem pouco\. juntos, mudam o mês/i);
    expect(txt).toMatch(/o nino acompanha esses sinais/i);
  });

  it("Story Canvas mostra as 4 etapas causais", () => {
    const { container } = renderLP();
    const txt = container.textContent ?? "";
    expect(txt).toMatch(/registrado em lazer · nubank · ontem/i);
    expect(txt).toMatch(/previsão de fechamento/i);
    expect(txt).toMatch(/o que puxou a alta/i);
    expect(txt).toMatch(/criar limite de r\$ 350/i);
  });

  it("cap. 4 exibe meta com valor absoluto, ritmo e previsão", () => {
    const { container } = renderLP();
    const txt = container.textContent ?? "";
    expect(txt).toMatch(/r\$ 4\.320/i);
    expect(txt).toMatch(/de r\$ 6\.000/i);
    expect(txt).toMatch(/r\$ 280 \/ mês/i);
    expect(txt).toMatch(/novembro/i);
  });

  it("Divisão do Rolê traz conversa, cálculo e mensagem preparada", () => {
    const { container } = renderLP();
    const txt = container.textContent ?? "";
    expect(txt).toMatch(/o jantar deu r\$ 480/i);
    expect(txt).toMatch(/r\$ 120 cada/i);
    expect(txt).toMatch(/oi, bruno! sua parte do jantar/i);
    expect(txt).toMatch(/copiar lembrete/i);
    expect(txt).not.toMatch(/envia lembrete/i);
    expect(txt).not.toMatch(/cobrança automática/i);
    expect(txt).not.toMatch(/pix/i);
  });

  it("faixa de confiança compacta substitui seção autônoma de passos", () => {
    const { container } = renderLP();
    const txt = container.textContent ?? "";
    expect(txt).toMatch(/você continua no controle/i);
    expect(txt).toMatch(/o nino não movimenta seu dinheiro/i);
  });

  it("não contém prova social fictícia, selos ou claims proibidos", () => {
    const { container } = renderLP();
    const txt = container.textContent ?? "";
    expect(txt).not.toMatch(/NoControle/i);
    expect(txt).not.toMatch(/LGPD/i);
    expect(txt).not.toMatch(/criptografia/i);
    expect(txt).not.toMatch(/100% seguro/i);
    expect(txt).not.toMatch(/HTTPS\/TLS/i);
    expect(container.querySelector(".lp-quotes")).toBeNull();
  });

  it("wordmark oficial: 'Meu Nino' + descritor '.IA' sobrescrito", () => {
    const { container } = renderLP();
    expect(container.querySelector(".lp-ia-pill")).toBeNull();
    expect(container.querySelector(".nino-wordmark__name")).not.toBeNull();
    expect(container.querySelector(".nino-wordmark__ia")?.textContent).toBe(".IA");
  });
});
