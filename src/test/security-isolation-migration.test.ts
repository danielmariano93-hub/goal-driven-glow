import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  `${process.cwd()}/supabase/migrations/20261027260000_security_close_anon_definer_and_goal_member_tamper.sql`,
  "utf8",
);

describe("isolamento entre usuários (auditoria de segurança)", () => {
  it("behavioral_finished_cycles só devolve linhas do próprio usuário e some para anon", () => {
    expect(sql).toContain("p_uid = auth.uid()");
    expect(sql).toMatch(/revoke all on function public\.behavioral_finished_cycles\(uuid, date\) from public, anon/);
  });

  it("funções internas deixam de ser executáveis por anon/authenticated", () => {
    for (const fn of [
      "refresh_installment_anticipation(uuid, uuid)",
      "financial_report_schedules_enroll()",
      "csg_record_adjustment()",
      "tg_refresh_installment_anticipation()",
    ]) {
      expect(sql).toContain(`revoke all on function public.${fn} from public, anon, authenticated`);
    }
  });

  it("o membro de meta compartilhada não edita papel, valor nem se auto-aceita", () => {
    expect(sql).toContain("tg_shared_goal_members_guard");
    expect(sql).toContain("new.role is distinct from old.role");
    expect(sql).toContain("new.contribution_total is distinct from old.contribution_total");
    expect(sql).toContain("new.invite_status = 'accepted'");
  });
});
