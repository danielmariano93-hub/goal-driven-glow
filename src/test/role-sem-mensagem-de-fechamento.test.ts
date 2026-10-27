import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");

describe("mensagem de rolê fechado", () => {
  it("o banco recusa enfileirar o tipo 'completed' (todos os caminhos de baixa)", () => {
    const sql = read("supabase/migrations/20261028130000_role_sem_mensagem_de_fechamento.sql");
    expect(sql).toContain("split_enqueue_message(uuid,uuid,text,timestamp with time zone)");
    expect(sql).toContain("split_enqueue_installment_message(uuid,uuid,uuid,text,timestamp with time zone)");
    expect(sql).toContain("IF p_kind = ''completed'' THEN RETURN NULL");
  });

  it("o despachante descarta jobs 'completed' sem enviar", () => {
    const dispatch = read("supabase/functions/split-reminders-dispatch-v2/index.ts");
    expect(dispatch).toMatch(/if \(kind === "completed"\) \{[\s\S]{0,260}completed_disabled/);
    expect(dispatch).toContain('["payment_confirmation"].includes(kind)');
  });

  it("o convite e os lembretes voltam a trazer o total do rolê e o número de pessoas", () => {
    const templates = read("supabase/functions/_shared/agent/messageTemplates.ts");
    const dispatch = read("supabase/functions/split-reminders-dispatch-v2/index.ts");
    expect(templates).toContain("{{split_context_sentence}}");
    expect(dispatch).toContain("total do rolê:");
    expect(dispatch).toContain("dividido entre");
  });
});
