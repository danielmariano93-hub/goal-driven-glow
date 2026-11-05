import { describe, expect, it } from "vitest";
import { opsNoticeDedupKey, opsNoticeRows, REMINDER_BUCKET_MS } from "../../supabase/functions/_shared/messaging/opsAppNotice";

const n = (kind: "new" | "reminder" | "recovered") => ({ id: "a1", kind, key: "waha_unreachable", severity: "critical" });
const msg = { title: "O servidor do WhatsApp não responde", body: "Pode ser domínio, DNS ou servidor fora do ar." };

describe("alerta operacional como notificação no app", () => {
  it("uma linha por admin ativo, tipo system, levando ao painel", () => {
    const rows = opsNoticeRows(["u1", "u2", "u1", ""], n("new"), msg, 1_000);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ user_id: "u1", type: "system", action_url: "/admin/visao-geral", title: msg.title });
  });
  it("recuperação ganha o ✅ e uma chave própria (não colide com o aviso de queda)", () => {
    const [row] = opsNoticeRows(["u1"], n("recovered"), { title: "WhatsApp voltou", body: "ok" }, 1_000);
    expect(row.title.startsWith("✅")).toBe(true);
    expect(opsNoticeDedupKey(n("recovered"), 1_000)).not.toBe(opsNoticeDedupKey(n("new"), 1_000));
  });
  it("novo e recuperado entram uma vez; lembrete só a cada 6h (evita spam, mantém a insistência)", () => {
    expect(opsNoticeDedupKey(n("new"), 1)).toBe(opsNoticeDedupKey(n("new"), 999_999_999));
    expect(opsNoticeDedupKey(n("reminder"), 1)).toBe(opsNoticeDedupKey(n("reminder"), REMINDER_BUCKET_MS - 1));
    expect(opsNoticeDedupKey(n("reminder"), 1)).not.toBe(opsNoticeDedupKey(n("reminder"), REMINDER_BUCKET_MS + 1));
  });
  it("sem admin ativo não há linhas (e o tick não finge que avisou)", () => {
    expect(opsNoticeRows([], n("new"), msg, 1)).toEqual([]);
  });
});
