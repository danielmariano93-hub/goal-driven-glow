import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// O PR #310 removeu `Stat` mas o detalhe da fatura ainda o usa: abrir "Ver e editar fatura" lançava ReferenceError.
describe("Cartões: detalhe da fatura", () => {
  it("todo componente local usado no JSX está definido", () => {
    const src = readFileSync(`${process.cwd()}/src/pages/Cartoes.tsx`, "utf8");
    for (const name of ["Stat", "Field"]) {
      if (new RegExp(`<${name}[\\s/>]`).test(src)) {
        expect(src, `${name} usado mas não definido`).toMatch(new RegExp(`function ${name}\\(`));
      }
    }
  });
});
