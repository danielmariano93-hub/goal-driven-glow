import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/20261013140000_rollout_whatsapp_users.sql", "utf8");

describe("liberação para usuários com WhatsApp ativo", () => {
  it("relatório 'Gastos dia a dia': só WhatsApp ativo + lançamentos recentes + respeita o relatório semanal", () => {
    expect(sql).toContain("w.status = 'active'");
    expect(sql).toContain("interval '60 days'");
    expect(sql).toContain("weekly_report_enabled");
    expect(sql).toContain("'monthly-current-monday-10-brasilia', 'monthly_partial', 1, 10");
    expect(sql).toContain("financial_report_schedules_enroll()");
    expect(sql).toMatch(/revoke all on function public\.financial_report_schedules_enroll\(\) from public, anon, authenticated/);
  });
  it("lembrete de vencimento ligado por padrão apenas para quem tem WhatsApp ativo", () => {
    expect(sql).toContain("alter column due_reminders_enabled set default true");
    expect(sql).toMatch(/update public\.notification_preferences np[\s\S]*whatsapp_links w where w\.user_id = np\.user_id and w\.status = 'active'/);
  });
  it("hábitos v2: banco e leitura do servidor usam a mesma regra", () => {
    expect(sql).toMatch(/habits_v2_enabled\(\)[\s\S]*whatsapp_links where user_id = auth\.uid\(\) and status = 'active'/);
    const runtime = readFileSync("supabase/functions/_shared/behavioral/observedRuntime.ts", "utf8");
    expect(runtime).toContain('from("whatsapp_links")');
    expect(runtime).not.toContain('from("habits_v2_access")');
  });
});
