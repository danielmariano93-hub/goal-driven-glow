import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/20261004180000_split_pause_hardening.sql", "utf8");

describe("pausa individual de cobranças — endurecimento", () => {
  it("não reescreve como pulado um job cuja mensagem já saiu", () => {
    expect(sql).toMatch(/o\.status::text IN \('sent','delivered','read'\)/);
  });
  it("retomar reagenda na hora pela regra diária", () => {
    expect(sql).toContain("public.schedule_split_due_reminders(p.shared_expense_id)");
  });
  it("pessoa pausada não conta como 'sem job vivo' na cobertura", () => {
    expect(sql).toContain("p.reminders_paused_at IS NULL");
  });
  it("só o dono age e anon não executa", () => {
    expect(sql).toContain("owner_user_id = uid");
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.split_set_participant_reminders_paused\(uuid, boolean, text\) FROM PUBLIC, anon/);
  });
});
