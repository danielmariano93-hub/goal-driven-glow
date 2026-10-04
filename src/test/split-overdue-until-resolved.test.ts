import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("supabase/migrations/20261004170000_split_overdue_reminders_until_resolved.sql", "utf8");

describe("cobrança de rolê atrasada até resolver", () => {
  it("não tem mais janela final para o lembrete de atraso", () => {
    expect(sql).not.toMatch(/interval '3 days'/);
    expect(sql).toMatch(/sem prazo final/);
  });
  it("agenda uma cobrança por dia de São Paulo no horário da política", () => {
    expect(sql).toContain("repeat_every_days");
    expect(sql).toContain("America/Sao_Paulo");
    expect(sql).toContain("split_due_timestamp(v_next_day, cfg.send_hour)");
  });
  it("só cobra parcela elegível (pagamento, pausa, opt-out e cancelamento encerram)", () => {
    expect(sql).toContain("split_installment_is_eligible(rv.installment_id)");
  });
  it("função interna: sem acesso de anon nem de usuário logado", () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.schedule_split_due_reminders\(uuid\) FROM PUBLIC, anon/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.schedule_split_due_reminders\(uuid\) TO service_role;/);
  });
});
