import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(p, "utf8");

describe("reconectar o WhatsApp é fácil de achar no admin", () => {
  it("a conexão do WhatsApp fica no topo da aba, antes do monitor e dos serviços de envio", () => {
    const s = src("src/components/admin/messaging/ChannelsBoard.tsx");
    const conn = s.indexOf("<WhatsAppSessionPanel />");
    expect(conn).toBeGreaterThan(-1);
    expect(conn).toBeLessThan(s.indexOf("Serviços de envio"));
    expect(s.indexOf("Conexão do WhatsApp")).toBeLessThan(s.indexOf("Serviços de envio"));
    expect(s.match(/<WhatsAppSessionPanel \/>/g)?.length).toBe(1);
  });
  it("a aba se chama WhatsApp e entrega e os alertas apontam para ela", () => {
    expect(src("src/pages/admin/ComunicacaoProativa.tsx")).toContain('label: "WhatsApp e entrega"');
    expect(src("src/lib/admin/plainLanguage.ts")).toContain("aba WhatsApp e entrega");
    expect(src("src/lib/admin/commandCenter.ts")).toContain("aba WhatsApp e entrega");
  });
});
