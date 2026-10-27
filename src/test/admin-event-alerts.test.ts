import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");
const sql = read("supabase/migrations/20261027270000_admin_event_alerts.sql");
const tick = read("supabase/functions/ops-alerts-tick/index.ts");

describe("alertas de eventos do painel admin", () => {
  it("cobre cadastro, exclusão, lista de espera, feedback e WhatsApp conectado", () => {
    for (const type of ["signup", "deletion_request", "waitlist", "feedback", "whatsapp_linked"]) {
      expect(sql).toContain(`'type', '${type}'`);
    }
  });

  it("mascara o e-mail e ignora contas de teste/sandbox", () => {
    expect(sql).toContain("left(r.email, 2) || '***@'");
    expect(sql).toContain("not coalesce(p.is_test, false) and not coalesce(p.is_sandbox, false)");
  });

  it("só o serviço executa a coleta e a marca d'água só avança depois da entrega", () => {
    expect(sql).toContain("revoke all on function public.ops_events_collect() from public, anon, authenticated");
    expect(sql).toContain("revoke all on function public.ops_events_ack(timestamptz) from public, anon, authenticated");
    expect(tick).toContain("if (!externalConfigured || delivered)");
    expect(tick).toContain('sb.rpc("ops_events_ack"');
  });

  it("agenda a rotina de 5 minutos que nunca existiu em produção", () => {
    expect(sql).toContain("cron.schedule('ops-alerts-5m'");
  });

  it("agrupa os eventos numa única mensagem com limite", () => {
    expect(tick).toContain("MAX_EVENT_LINES");
    expect(tick).toContain("outbound_messages");
  });
});
