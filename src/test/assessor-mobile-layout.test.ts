import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// Regressão: o assessor quebrava no celular (rolagem lateral cortando as mensagens e página de trás
// aparecendo com o teclado aberto). Estes invariantes de layout não podem voltar.
const src = readFileSync("src/components/assessor/AssessorPanel.tsx", "utf8");

describe("layout responsivo do assessor", () => {
  it("camada externa cobre a tela inteira e é opaca; só o painel acompanha a área visível", () => {
    expect(src).toMatch(/fixed inset-0 z-\[100\][^"]*bg-background/);
    expect(src).toContain("top-[var(--vv-top)] h-[var(--vv-h)]");
  });
  it("lista de mensagens nunca rola na horizontal e as mensagens quebram texto longo", () => {
    expect(src).toContain("overflow-x-hidden overflow-y-auto");
    expect(src).toContain("[overflow-wrap:anywhere]");
    expect(src).toContain("min-w-0");
  });
  it("trava a rolagem da página de trás enquanto aberto", () => {
    expect(src).toContain("useBodyScrollLock()");
    expect(src).toContain('document.body.style.position = "fixed"');
  });
  it("placeholder curto (o longo estourava a linha de entrada no celular)", () => {
    expect(src).not.toContain("anexe um documento ou use !ja");
  });
});
