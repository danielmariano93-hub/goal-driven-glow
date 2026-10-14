import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { desktopGroups, moreGroups } from "@/lib/navigation/appNavigationRegistry";

const menu = readFileSync("src/pages/MaisMenu.tsx", "utf8");

describe("menu Mais compacto", () => {
  it("atalhos em lista (sem blocos quadrados) e Entender vem antes de Organizar", () => {
    expect(menu).not.toContain("grid grid-cols-3");
    expect(moreGroups().map((g) => g.group)).toEqual(["entender", "organizar", "conta"]);
  });
  it("Desafios não aparece nos menus", () => {
    const ids = [...moreGroups(), ...desktopGroups()].flatMap((g) => g.items.map((i) => i.id));
    expect(ids).not.toContain("desafios");
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
    expect(menu).toContain("min-h-[48px]");
    expect(menu).toContain("min-h-[56px]");
  });
});
