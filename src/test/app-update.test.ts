import { describe, expect, it } from "vitest";
import { extractEntryScript, isNewVersion } from "@/lib/appUpdate";

const html = (hash: string) => `<html><head><script type="module" crossorigin src="/assets/index-${hash}.js"></script></head></html>`;

describe("detecção de versão nova", () => {
  it("lê o pacote de entrada do HTML publicado", () => {
    expect(extractEntryScript(html("CVKeWzGw"))).toBe("/assets/index-CVKeWzGw.js");
    expect(extractEntryScript("<html></html>")).toBeNull();
  });
  it("só acusa versão nova quando o hash difere do carregado", () => {
    expect(isNewVersion("/assets/index-AAA.js", html("BBB"))).toBe(true);
    expect(isNewVersion("/assets/index-AAA.js", html("AAA"))).toBe(false);
  });
  it("em dev (sem hash carregado) ou HTML sem pacote, não avisa", () => {
    expect(isNewVersion(null, html("BBB"))).toBe(false);
    expect(isNewVersion("/assets/index-AAA.js", "<html></html>")).toBe(false);
  });
});
