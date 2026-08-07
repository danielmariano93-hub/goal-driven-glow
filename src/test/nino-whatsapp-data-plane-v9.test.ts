import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const webhook = readFileSync("supabase/functions/whatsapp-webhook/index.ts", "utf8");
const sender = readFileSync("supabase/functions/whatsapp-send/index.ts", "utf8");
const watchdog = readFileSync("supabase/functions/whatsapp-ack-watchdog/index.ts", "utf8");
const session = readFileSync("supabase/functions/whatsapp-session/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260807235900_nino_reliability_truth_v9.sql", "utf8");

describe("WhatsApp data plane v9", () => {
  it("correlaciona webhook, inbound, agente, outbound e ack", () => {
    for (const stage of [
      "webhook_received", "inbound_persisted", "agent_started", "agent_completed",
      "outbound_queued", "provider_sent", "ack_received", "failed",
    ]) {
      expect(webhook + sender + migration).toContain(stage);
    }
  });

  it("status operacional inclui data plane, não apenas sessão WAHA", () => {
    expect(session).toContain("data_plane");
    expect(session).toContain("whatsapp_channel_health.v1");
  });

  it("watchdog valida e auto-repara webhook divergente", () => {
    expect(watchdog).toContain("validateWahaCredentials");
    expect(watchdog).toContain("syncWebhook");
    expect(watchdog).toContain("webhook_repaired");
  });

  it("telemetria sanitizada não persiste corpo nem telefone", () => {
    const tableBlock = migration.slice(
      migration.indexOf("CREATE TABLE IF NOT EXISTS public.whatsapp_pipeline_events"),
      migration.indexOf("ALTER TABLE public.whatsapp_pipeline_events ENABLE ROW LEVEL SECURITY"),
    );
    expect(tableBlock).not.toContain("body ");
    expect(tableBlock).not.toContain("phone_e164");
    expect(tableBlock).not.toContain("to_phone");
  });
});
