import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("assessor não retoma documentos ao abrir", () => {
  it("não chama resumeIngestion no efeito de hidratação", () => {
    const source = fs.readFileSync("src/components/assessor/AssessorPanel.tsx", "utf8");
    const hydration = source.slice(source.indexOf("Recupera a conversa"), source.indexOf("const activeDocumentKey"));
    expect(hydration).not.toContain("await resumeIngestion");
    expect(hydration).not.toContain('"failed"');
  });
});
