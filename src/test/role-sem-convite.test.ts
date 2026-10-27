import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("supabase/migrations/20261028170000_split_create_v4_sem_convite.sql", "utf8");
const page = readFileSync("src/pages/DivisaoDoRoleNova.tsx", "utf8");

describe("criar o rolê sem avisar a inclusão", () => {
  it("v4 descarta convite e follow-up na mesma transação e agenda vencimento/atraso", () => {
    expect(sql).toMatch(/kind in \('invite', 'reminder'\)/);
    expect(sql).toMatch(/status = 'skipped'/);
    expect(sql).toContain("schedule_split_due_reminders(new_id)");
    expect(sql).toContain("'invite_suppressed'");
    expect(sql).toMatch(/revoke all on function public\.split_create_v4/);
  });
  it("só dono autenticado cria; o padrão continua sendo avisar", () => {
    expect(sql).toMatch(/p_send_invite boolean default true/);
    expect(sql).toMatch(/auth\.uid\(\)/);
  });
  it("a tela só oferece a opção ao criar, avisa o que acontece e não dispara o envio do convite", () => {
    expect(page).toContain("split_create_v4");
    expect(page).toContain("p_send_invite:sendInvite");
    expect(page).toMatch(/!editing&&<label[\s\S]*Avisar as pessoas agora que elas foram incluídas/);
    expect(page).toMatch(/recipients > 0 && !sendInvite\) \{\s*toast\.success/);
    expect(page.indexOf("recipients > 0 && !sendInvite")).toBeLessThan(page.indexOf("await dispatchSplitReminders()"));
  });
});
