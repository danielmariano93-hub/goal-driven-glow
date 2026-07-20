import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderMessageTemplate } from "../../supabase/functions/_shared/agent/messageTemplates";

const ingest = readFileSync(`${process.cwd()}/supabase/functions/assistant-ingest-document/index.ts`, "utf8");
const migration = readFileSync(`${process.cwd()}/supabase/migrations/20260720013000_assessor_messaging_observability.sql`, "utf8");
const webhook = readFileSync(`${process.cwd()}/supabase/functions/whatsapp-webhook/index.ts`, "utf8");

describe("correções definitivas do assessor e mensageria", () => {
  it("mantém contadores de fragmento fora do bloco opcional", () => {
    const scope = ingest.indexOf("let batchDupStrong = 0");
    const branch = ingest.indexOf("if (freshItems.length > 0)", scope);
    expect(scope).toBeGreaterThan(0);
    expect(scope).toBeLessThan(branch);
  });

  it("preserva itens extraídos quando uma etapa tardia falha", () => {
    expect(ingest).toContain('status: recoverable ? "partial" : "failed"');
    expect(ingest).toContain("recovered_items");
  });

  it("cancela pai e filhos e recupera dados presos", () => {
    expect(migration).toContain("status = 'partial'");
    expect(migration).toContain("batchDupStrong is not defined");
    expect(migration).toContain("SET status = 'ignored'");
    expect(migration).not.toContain("DELETE FROM public.extracted_items");
  });

  it("processa ACK de entrega antes do classificador inbound", () => {
    expect(webhook.indexOf("const ack = readAckEvent(payload)")).toBeLessThan(webhook.indexOf("const classified = classifyInbound"));
  });

  it("renderiza template sem forçar nome", () => {
    const value = renderMessageTemplate("invite", { name: "" }, {
      participant_name: "Ana", owner_name: "Daniel", title: "Jantar", amount: "R$ 25,00",
      due_sentence: "", pix_sentence: "", due_date: "", pix_key: "",
    });
    expect(value).toContain("Ana");
    expect(value).toContain("Jantar");
    expect(value).not.toContain("Lucas");
  });
});
