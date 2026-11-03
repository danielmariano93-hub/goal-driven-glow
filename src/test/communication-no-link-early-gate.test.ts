import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("F4 — gate precoce de vínculo WhatsApp", () => {
  const src = readFileSync("supabase/functions/_shared/agent/core/CommunicationDispatcherV3.ts", "utf8");
  it("barra no_active_whatsapp_link antes de decideCommunication", () => {
    const gate = src.indexOf('? "no_active_whatsapp_link"');
    const decide = src.indexOf("decideCommunication({");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(decide);
  });
  it("mantém a checagem tardia como rede de segurança", () => {
    expect(src.match(/reason: "no_active_whatsapp_link"/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
