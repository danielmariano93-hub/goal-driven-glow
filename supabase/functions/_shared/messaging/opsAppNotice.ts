// Alerta operacional como notificação dentro do app, para cada administrador ativo.
//
// Por que existe: em 20-26/10/2026 o WhatsApp ficou fora por 6 dias e NINGUÉM foi avisado. Os alertas existiam, mas só
// tinham canais externos (ntfy e WhatsApp), nenhum configurado, e o próprio WhatsApp não pode avisar que está caído.
// A notificação no app não depende de nada externo (e ganha push nos aparelhos que tiverem).

export type OpsNoticeInput = { id: string; kind: "new" | "reminder" | "recovered"; key: string; severity: string };

/** Lembretes entram no app no máximo a cada 6 h (o ciclo interno é de 2 h); novo e recuperado entram uma vez. */
export const REMINDER_BUCKET_MS = 6 * 60 * 60 * 1000;

export function opsNoticeDedupKey(n: OpsNoticeInput, nowMs: number): string {
  const bucket = n.kind === "reminder" ? `:${Math.floor(nowMs / REMINDER_BUCKET_MS)}` : "";
  return `ops_alert:${n.id}:${n.kind}${bucket}`;
}

export function opsNoticeRows(
  adminIds: string[],
  n: OpsNoticeInput,
  message: { title: string; body: string },
  nowMs: number,
) {
  const title = n.kind === "recovered" ? `✅ ${message.title}` : message.title;
  return [...new Set(adminIds.filter(Boolean))].map((user_id) => ({
    user_id,
    type: "system",
    title: title.slice(0, 140),
    body: message.body.slice(0, 600),
    action_url: "/admin/visao-geral",
    dedup_key: opsNoticeDedupKey(n, nowMs),
  }));
}
