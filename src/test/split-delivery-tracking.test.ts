import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(`${process.cwd()}/supabase/migrations/20260719233000_split_delivery_tracking_and_soft_delete.sql`, "utf8");
const pipelineMigration = readFileSync(`${process.cwd()}/supabase/migrations/20260719231937_7985b419-f354-47cb-94cc-48bda3aef9cc.sql`, "utf8");
const dispatcher = readFileSync(`${process.cwd()}/supabase/functions/split-reminders-dispatch/index.ts`, "utf8");
const detail = readFileSync(`${process.cwd()}/src/pages/DivisaoDoRoleDetalhe.tsx`, "utf8");
const list = readFileSync(`${process.cwd()}/src/pages/DivisaoDoRole.tsx`, "utf8");

describe("Divisão do Rolê — tracking e exclusão", () => {
  it("diferencia exclusão de cancelamento e preserva auditoria", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS deleted_at");
    expect(migration).toContain("FUNCTION public.split_delete");
    expect(pipelineMigration).toContain("id = se.linked_transaction_id");
    expect(pipelineMigration).toContain("status IN ('queued', 'processing', 'enqueued')");
    expect(migration).toContain("'deleted'");
    expect(list).toContain('.is("deleted_at"');
    expect(list).toContain("Excluído · mantido apenas no histórico");
  });

  it("impede um lançamento original excluído de deixar divisão ativa", () => {
    expect(migration).toContain("sync_split_after_original_transaction_delete");
    expect(migration).toContain("transactions_sync_split_after_delete");
    expect(migration).toContain("last_error = 'split_deleted'");
  });

  it("processa somente a fila do usuário em chamadas autenticadas", () => {
    expect(migration).toContain("claim_reminder_jobs_for_owner");
    expect(dispatcher).toContain("caller.userId");
    expect(dispatcher).toContain("claim_reminder_jobs_for_owner");
  });

  it("encadeia dispatcher e envio ao WhatsApp no mesmo tick", () => {
    expect(dispatcher).toContain("/functions/v1/whatsapp-send");
    expect(dispatcher).toContain("outbound_processed");
    expect(dispatcher).toContain("outbound_kicked");
    expect(dispatcher).not.toContain("if (enqueued > 0)");
    expect(migration).toContain("split-message-pipeline-1m");
  });

  it("mostra jornada amigável e atualiza sem recarregar", () => {
    expect(detail).toContain("setInterval(load,6000)");
    expect(detail).toContain("Estamos enviando os convites");
    expect(detail).toContain("Enviada ao WhatsApp");
    expect(detail).toContain("Na fila do WhatsApp");
    expect(detail).toContain("Ainda sem tentativa de envio");
    expect(detail).toContain("Retomar envio");
  });

  it("permite exclusão financeira mesmo quando a divisão já foi cancelada", () => {
    expect(detail).toContain('split?.status==="cancelled"');
    expect(detail).toContain("Excluir rolê e remover lançamento");
    expect(detail).not.toContain('split.status!=="cancelled"&&received===0&&<button onClick={remove}');
  });
});
