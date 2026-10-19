import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * O Assessor e a revisão de lançamentos abrem em tela cheia num portal (fora do #root). No iPhone instalado (barra de status
 * translúcida) o cabeçalho, com o botão de fechar, ficava embaixo da barra de status e a pessoa não conseguia sair.
 */
describe("telas cheias do Assessor respeitam a área segura do topo", () => {
  for (const file of ["src/components/assessor/AssessorPanel.tsx", "src/components/assessor/ReviewSheet.tsx"]) {
    const src = readFileSync(file, "utf8");
    it(`${file.split("/").pop()}: padding-top com a área segura e botão de fechar com alvo de toque grande`, () => {
      expect(src).toContain('paddingTop: "env(safe-area-inset-top)"');
      expect(src).toContain('aria-label="Fechar"');
      expect(src).toMatch(/h-11 w-11[^"]*"[^>]*aria-label="Fechar"/);
    });
  }
});
