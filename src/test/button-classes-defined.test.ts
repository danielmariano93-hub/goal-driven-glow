import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Regressão: `btn-primary` não existia no CSS, então botões importantes (ex.: "Lembrar quem ainda
// não pagou", "Novo rolê") apareciam como texto solto. Toda classe `btn-*` usada precisa estar definida.
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(tsx|ts)$/.test(name) ? [path] : [];
  });

describe("classes de botão", () => {
  const css = readFileSync("src/index.css", "utf8");
  const defined = new Set([...css.matchAll(/\.(btn-[a-z0-9-]+)/g)].map((m) => m[1]));
  const used = new Map<string, string>();
  for (const file of walk("src").filter((f) => !f.includes("/test/"))) {
    for (const m of readFileSync(file, "utf8").matchAll(/className="[^"]*?\b(btn-[a-z0-9-]+)/g)) {
      const all = [...m[0].matchAll(/\b(btn-[a-z0-9-]+)/g)].map((x) => x[1]);
      for (const cls of all) used.set(cls, file);
    }
  }
  it("toda classe btn-* usada no app está definida no CSS", () => {
    const missing = [...used.entries()].filter(([cls]) => !defined.has(cls));
    expect(missing).toEqual([]);
  });
  it("as ações do rolê têm área de toque de 44px", () => {
    expect(css).toMatch(/\.btn-action \{[^}]*min-h-\[44px\]/);
    expect(css).toMatch(/\.btn-action-secondary \{[^}]*min-h-\[44px\]/);
  });
});
