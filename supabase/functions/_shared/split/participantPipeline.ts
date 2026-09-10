// split_receipt.v1 — pipeline do participante externo no WhatsApp.
//
// O participante não é usuário do app: ele não tem sessão, não tem carteira e
// não pode dar baixa em nada. O que ele PODE fazer é informar o pagamento e
// mandar o comprovante. Este módulo:
//  1. detecta a intenção da mensagem (com ou sem anexo);
//  2. baixa e arquiva o comprovante no storage do DONO da divisão;
//  3. registra contexto conversacional (`participant_contexts`);
//  4. move o participante para "comprovante enviado / aguardando confirmação";
//  5. avisa o dono no app e no WhatsApp para confirmar ou recusar.
// Nenhuma baixa financeira acontece automaticamente.
// deno-lint-ignore-file no-explicit-any

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { downloadInboundMedia, type MediaHint } from "../messaging/wahaMedia.ts";
import {
  activeReceivables,
  buildInstallmentSchedule,
  type CanonicalReceivable,
  formatCivilBR,
  installmentSentence,
  summarizeSchedule,
} from "./installmentSchedule.ts";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export type ParticipantIntent =
  | "receipt_sent"
  | "payment_reported"
  | "asking_schedule"
  | "asking_next"
  | "asking_month"
  | "asking_amount"
  | "asking_pix"
  | "opt_out"
  | "other";

const norm = (t: string) => t.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{Diacritic}/gu, "");

/** Classificador determinístico — sem LLM, sem ambiguidade. */
export function detectParticipantIntent(text: string, hasMedia: boolean): ParticipantIntent {
  const t = norm(text ?? "");
  if (hasMedia) return "receipt_sent";
  if (/\b(nao vou pagar|nao participo|me tira|para de mandar|sai(r)? do role)\b/.test(t)) return "opt_out";
  if (/\b(paguei|ja paguei|pagamento feito|transferi|pix feito|fiz o pix|acabei de pagar)\b/.test(t)) return "payment_reported";
  if (/\bproxim/.test(t)) return "asking_next";
  if (/(esse|este|neste|nesse|atual)\s+mes|\bmes atual\b|\bpago esse mes\b/.test(t)) return "asking_month";
  if (/\bparcela|\bparcelas\b|parcelamento|\bparcelad/.test(t)) return "asking_schedule";
  if (/\b(pix|chave)\b/.test(t)) return "asking_pix";
  if (/\b(valor|quanto|devo|pendente|venc|falta)\b/.test(t)) return "asking_amount";
  return "other";
}

/** Parcelas canônicas do participante (fonte única: split_receivables_v1). */
export async function loadParticipantReceivables(
  sb: SupabaseClient,
  participantId: string,
): Promise<CanonicalReceivable[]> {
  const { data, error } = await sb.from("split_receivables_v1")
    .select("installment_id,installment_number,total_installments,amount,paid_amount,balance_due,due_date,settlement_status,state")
    .eq("participant_id", participantId)
    .order("installment_number", { ascending: true });
  if (error) {
    console.warn("[split_receipt] receivables_query_failed", String(error.message).slice(0, 160));
    return [];
  }
  return activeReceivables(((data as CanonicalReceivable[] | null) ?? []));
}

/** Valor informado em texto livre ("paguei 45,90"). Retorna null quando não há. */
export function extractReportedAmount(text: string): number | null {
  const match = norm(text ?? "").match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!match) return null;
  const raw = match[1];
  const value = raw.includes(",")
    ? Number(raw.replace(/\./g, "").replace(",", "."))
    : Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : null;
}

export type ParticipantRow = {
  id: string;
  name: string;
  amount_due: number;
  amount_paid: number;
  shared_expense_id: string;
  phone_e164: string;
};

export type ExpenseRow = {
  id: string;
  title: string;
  due_date: string | null;
  pix_key: string | null;
  user_id: string;
};

export type ParticipantHandleResult = {
  intent: ParticipantIntent;
  reply: string;
  receipt_stored: boolean;
  media_error: string | null;
  storage_path: string | null;
  owner_notified: boolean;
  status_changed: string | null;
};

async function upsertContext(
  sb: SupabaseClient,
  participant: ParticipantRow,
  expense: ExpenseRow,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await sb.from("participant_contexts").upsert({
    participant_id: participant.id,
    shared_expense_id: expense.id,
    owner_user_id: expense.user_id,
    phone_e164: participant.phone_e164,
    last_message_at: new Date().toISOString(),
    ...patch,
  }, { onConflict: "participant_id" });
  if (error) console.warn("[split_receipt] context_upsert_failed", String(error.message).slice(0, 160));
}

async function notifyOwner(
  sb: SupabaseClient,
  expense: ExpenseRow,
  participant: ParticipantRow,
  body: string,
): Promise<boolean> {
  const remaining = Math.max(0, Number(participant.amount_due) - Number(participant.amount_paid));
  const dedup = `split_receipt:${participant.id}:${new Date().toISOString().slice(0, 10)}`;
  const { error } = await sb.from("notifications").insert({
    user_id: expense.user_id,
    type: "split_reminder",
    title: `${participant.name.split(/\s+/)[0]} informou pagamento`,
    body,
    data: {
      shared_expense_id: expense.id,
      participant_id: participant.id,
      remaining,
      requires_owner_confirmation: true,
      route: `/app/divisao-do-role/${expense.id}`,
    },
    logical_dedup_key: dedup,
  });
  if (error && !String(error.message).toLowerCase().includes("duplicate")) {
    console.warn("[split_receipt] notify_failed", String(error.message).slice(0, 160));
    return false;
  }

  // Aviso no WhatsApp do dono, quando o número está vinculado e ativo.
  const { data: link } = await sb.from("whatsapp_links")
    .select("phone_e164").eq("user_id", expense.user_id).eq("status", "active").maybeSingle();
  const phone = (link as any)?.phone_e164;
  if (phone) {
    await sb.from("outbound_messages").insert({
      user_id: expense.user_id,
      to_phone: phone,
      channel: "whatsapp",
      kind: "split_support",
      idempotency_key: `split-receipt:${participant.id}:${Date.now()}`,
      status: "queued",
      body,
    }).then(() => {}, () => {});
  }
  return true;
}

/**
 * Trata a mensagem do participante externo de ponta a ponta.
 * `media` presente = tentativa de comprovante; o download é obrigatório antes
 * de qualquer mudança de estado, e falha de mídia NUNCA vira sucesso silencioso.
 */
export async function handleParticipantInbound(
  sb: SupabaseClient,
  input: {
    participant: ParticipantRow;
    expense: ExpenseRow;
    text: string;
    media?: MediaHint | null;
    providerMessageId?: string | null;
    inboundMessageId?: string | null;
    waha?: { apiUrl?: string; apiKey?: string; session?: string };
  },
): Promise<ParticipantHandleResult> {
  const { participant, expense } = input;
  const firstName = participant.name.trim().split(/\s+/)[0] || "tudo bem";
  const remaining = Math.max(0, Number(participant.amount_due) - Number(participant.amount_paid));
  const hasMedia = Boolean(input.media);
  const intent = detectParticipantIntent(input.text ?? "", hasMedia);

  const out: ParticipantHandleResult = {
    intent,
    reply: "",
    receipt_stored: false,
    media_error: null,
    storage_path: null,
    owner_notified: false,
    status_changed: null,
  };

  if (intent === "receipt_sent") {
    const download = await downloadInboundMedia({
      media: input.media as MediaHint,
      apiUrl: input.waha?.apiUrl,
      apiKey: input.waha?.apiKey,
      session: input.waha?.session,
      messageId: input.providerMessageId ?? undefined,
    });

    if (download.ok) {
      const path = `${expense.user_id}/split-receipts/${participant.id}/${Date.now()}-${download.filename}`;
      const upload = await sb.storage.from("documents").upload(path, download.bytes, {
        contentType: download.mime_type,
        upsert: false,
      });
      if (upload.error) {
        out.media_error = `storage:${String(upload.error.message).slice(0, 80)}`;
      } else {
        out.receipt_stored = true;
        out.storage_path = path;
      }
    } else {
      out.media_error = (download as { code?: string }).code ?? "download_failed";
    }

    const reported = extractReportedAmount(input.text ?? "") ?? remaining;
    await upsertContext(sb, participant, expense, {
      last_intent: "receipt_sent",
      awaiting_receipt: false,
      receipt_count: out.receipt_stored ? 1 : 0,
      last_receipt_at: out.receipt_stored ? new Date().toISOString() : null,
      reported_amount: reported,
      state: {
        storage_path: out.storage_path,
        media_error: out.media_error,
        inbound_message_id: input.inboundMessageId ?? null,
      },
    });

    if (out.receipt_stored) {
      await sb.from("shared_expense_participants")
        .update({ status: "awaiting_owner_confirmation", updated_at: new Date().toISOString() })
        .eq("id", participant.id);
      out.status_changed = "awaiting_owner_confirmation";
      out.owner_notified = await notifyOwner(
        sb, expense, participant,
        `${firstName} enviou um comprovante de ${BRL.format(reported)} em “${expense.title}”. Confirme ou recuse a baixa no app.`,
      );
      out.reply = `Recebi seu comprovante, ${firstName} 💛 Guardei junto do rolê “${expense.title}” e avisei quem organizou para confirmar a baixa de ${BRL.format(reported)}. Assim que confirmarem, eu te aviso.`;
      return out;
    }

    // Comprovante não pôde ser lido: seguimos com o registro do relato, sem
    // fingir que o arquivo chegou.
    await sb.from("shared_expense_participants")
      .update({ status: "payment_reported", updated_at: new Date().toISOString() })
      .eq("id", participant.id);
    out.status_changed = "payment_reported";
    out.owner_notified = await notifyOwner(
      sb, expense, participant,
      `${firstName} informou pagamento de ${BRL.format(reported)} em “${expense.title}”, mas o comprovante não pôde ser baixado. Confirme com ela/ele antes de dar baixa.`,
    );
    out.reply = `Recebi sua mensagem, ${firstName}. Não consegui abrir o arquivo aqui, mas já registrei que você informou o pagamento de ${BRL.format(reported)} em “${expense.title}” e avisei quem organizou. Se puder, reenvie o comprovante como imagem ou PDF.`;
    return out;
  }

  if (intent === "payment_reported") {
    const reported = extractReportedAmount(input.text ?? "") ?? remaining;
    await upsertContext(sb, participant, expense, {
      last_intent: "payment_reported",
      awaiting_receipt: true,
      awaiting_receipt_since: new Date().toISOString(),
      reported_amount: reported,
    });
    await sb.from("shared_expense_participants")
      .update({ status: "payment_reported", updated_at: new Date().toISOString() })
      .eq("id", participant.id);
    out.status_changed = "payment_reported";
    out.owner_notified = await notifyOwner(
      sb, expense, participant,
      `${firstName} informou pagamento de ${BRL.format(reported)} em “${expense.title}”. Confirme a baixa no app.`,
    );
    out.reply = `Entendi, ${firstName}. Registrei que você pagou ${BRL.format(reported)} em “${expense.title}” e avisei quem organizou. Se quiser, me envie o comprovante (imagem ou PDF) que eu anexo ao rolê.`;
    return out;
  }

  if (intent === "opt_out") {
    await upsertContext(sb, participant, expense, { last_intent: "opt_out", awaiting_receipt: false });
    out.reply = `Sem problema, ${firstName}. Vou parar os lembretes automáticos e avisar quem organizou o rolê “${expense.title}” para falar direto com você.`;
    out.owner_notified = await notifyOwner(
      sb, expense, participant,
      `${firstName} pediu para não receber mais lembretes de “${expense.title}”. Fale direto com ela/ele.`,
    );
    return out;
  }

  await upsertContext(sb, participant, expense, { last_intent: intent, awaiting_receipt: false });

  // Consultas do participante leem a verdade canônica por parcela.
  const rows = await loadParticipantReceivables(sb, participant.id);
  const summary = summarizeSchedule(rows);
  const pending = rows.length ? summary.pending_total : remaining;
  const nextRow = summary.next;
  const due = nextRow?.due_date
    ? `, com vencimento em ${formatCivilBR(nextRow.due_date)}`
    : expense.due_date
      ? `, com vencimento em ${formatCivilBR(expense.due_date)}`
      : "";

  if (intent === "asking_schedule") {
    if (summary.count > 1) {
      const schedule = buildInstallmentSchedule(rows, { withState: true });
      out.reply = `Sua parte em “${expense.title}” é ${BRL.format(summary.total)} em ${summary.count}x:\n${schedule}\n\nAinda em aberto: ${BRL.format(pending)}.`;
    } else {
      out.reply = `“${expense.title}” não está parcelado: sua parte é ${BRL.format(pending)}${due}.`;
    }
    return out;
  }

  if (intent === "asking_next") {
    out.reply = nextRow
      ? `A próxima parcela em aberto de “${expense.title}” é a ${installmentSentence(nextRow)}.`
      : `Você não tem parcelas em aberto em “${expense.title}” — está tudo quitado 💛`;
    return out;
  }

  if (intent === "asking_month") {
    const monthRows = summary.current_month;
    if (!monthRows.length) {
      out.reply = nextRow
        ? `Neste mês não vence nenhuma parcela de “${expense.title}”. A próxima é a ${installmentSentence(nextRow)}.`
        : `Neste mês não vence nenhuma parcela de “${expense.title}” — está tudo quitado 💛`;
      return out;
    }
    const monthTotal = monthRows.reduce((s, r) => s + Math.max(0, Number(r.balance_due ?? 0)), 0);
    out.reply = monthRows.length === 1
      ? `Neste mês vence a ${installmentSentence(monthRows[0])} de “${expense.title}”.`
      : `Neste mês vencem ${monthRows.length} parcelas de “${expense.title}”, somando ${BRL.format(monthTotal)}:\n${buildInstallmentSchedule(monthRows, { withState: true })}`;
    return out;
  }

  if (intent === "asking_pix") {
    out.reply = expense.pix_key
      ? `Sua parte em aberto em “${expense.title}” é ${BRL.format(pending)}${due}. A chave Pix é ${expense.pix_key}. Depois de pagar, me manda o comprovante que eu anexo ao rolê.`
      : `Sua parte em aberto em “${expense.title}” é ${BRL.format(pending)}${due}. A chave Pix ainda não foi informada — vou avisar quem organizou.`;
    return out;
  }
  if (intent === "asking_amount") {
    const parcelado = summary.count > 1 && nextRow
      ? ` A próxima é a ${installmentSentence(nextRow)}.`
      : "";
    out.reply = `Sua parte pendente em “${expense.title}” é ${BRL.format(pending)}${parcelado ? "." : `${due}.`}${parcelado} Se já pagou, me envie o comprovante (imagem ou PDF) que eu registro para confirmação.`;
    return out;
  }
  out.reply = `Posso ajudar com “${expense.title}”, ${firstName}. Sua parte pendente é ${BRL.format(pending)}${due}. Você pode perguntar o valor, as parcelas, a próxima a vencer, a chave Pix — ou me enviar o comprovante do pagamento.`;
  return out;
}
