import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const menu = readFileSync("src/pages/MaisMenu.tsx", "utf8");

describe("menu Mais compacto", () => {
  it("atalhos em grade de 3 colunas, sem descrição ocupando linha", () => {
    expect(menu).toContain("grid grid-cols-3");
    expect(menu).toContain("aria-label={it.desc");
  });
  it("cada assunto aparece uma vez: o que está em destaque sai da grade", () => {
    expect(menu).toContain("highlighted");
    expect(menu).toMatch(/\.filter\(\(item\) => !highlighted\.has\(item\.path\)\)/);
  });
  it("destaques só aparecem quando há algo a dizer", () => {
    expect(menu).toContain("highlights.length > 0");
    expect(menu).not.toContain("Prioridade agora");
  });
  it("continua derivando do registro de navegação e com alvos de toque confortáveis", () => {
    expect(menu).toContain("moreGroups()");
    expect(menu).toContain("min-h-[84px]");
    expect(menu).toContain("min-h-[56px]");
  });
});
