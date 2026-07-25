import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(
  resolve(process.cwd(), "src/pages/admin/operacao/WhatsApp.tsx"),
  "utf8",
);
const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260726090000_message_intelligence_safe.sql"),
  "utf8",
);

describe("contrato seguro da inteligência de mensagens", () => {
  it("consome os três RPCs esperados", () => {
    expect(page).toContain('"admin_v2_whatsapp_monitor"');
    expect(page).toContain('"admin_v2_message_intelligence"');
    expect(page).toContain('"admin_v2_retry_failed_outbound"');
  });

  it("preserva privacidade na interface", () => {
    expect(page).not.toContain("to_phone");
    expect(page).not.toContain("body:");
  });

  it("protege leitura e reprocessamento com permissões existentes", () => {
    expect(migration).toContain("perform public._require_perm('messaging.read')");
    expect(migration).toContain("perform public._require_perm('messaging.reprocess')");
  });

  it("reutiliza estruturas existentes e não cria tabelas paralelas", () => {
    expect(migration).not.toMatch(/create\s+table/i);
    expect(migration).not.toContain("notification_events");
    expect(migration).not.toContain("platform_feature_flags");
  });

  it("reprocessa apenas falhas WAHA do canal WhatsApp", () => {
    expect(migration).toContain("status::text = 'failed'");
    expect(migration).toContain("channel = 'whatsapp'");
    expect(migration).toContain("provider::text = 'waha'");
  });
});
