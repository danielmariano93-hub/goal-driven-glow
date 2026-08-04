export type ParticipantSplitContext = {
  participantName: string;
  title: string;
  amountDue: number;
  amountPaid: number;
  dueDate: string | null;
  pixKey: string | null;
  siteUrl?: string;
  /** Verdadeiro quando a mensagem trouxe imagem/PDF (provável comprovante). */
  hasAttachment?: boolean;
};

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function participantSplitReply(message: string, context: ParticipantSplitContext): string {
  const text = message.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const remaining = Math.max(0, context.amountDue - context.amountPaid);
  const site = context.siteUrl || "https://meunino.com.br";
  if (context.hasAttachment) {
    return `Recebi seu anexo, ${firstName(context.participantName)}. Não consigo ler comprovantes por aqui, mas já avisei quem criou o rolê “${context.title}” para confirmar a baixa dos ${BRL.format(remaining)} pendentes.`;
  }
  if (/\b(site|link|pagina|app)\b/.test(text)) {
    return `O site oficial do MeuNino é ${site}. Sobre “${context.title}”, sua parte pendente é ${BRL.format(remaining)}.`;
  }
  if (/\b(paguei|ja paguei|pagamento feito|transferi|pix feito)\b/.test(text)) {
    return `Entendi, ${firstName(context.participantName)}. Avisei que você informou o pagamento de ${BRL.format(remaining)} em “${context.title}”. Por segurança, quem criou o rolê precisa confirmar a baixa.`;
  }
  if (/\b(pix|pagar|pagamento|chave)\b/.test(text)) {
    return context.pixKey
      ? `Sua parte em “${context.title}” é ${BRL.format(remaining)}. A chave Pix informada é ${context.pixKey}.`
      : `Sua parte em “${context.title}” é ${BRL.format(remaining)}. A chave Pix ainda não foi informada; confirme com quem criou o rolê.`;
  }
  if (/\b(valor|quanto|devo|pendente|venc)\b/.test(text)) {
    const due = context.dueDate ? `, com vencimento em ${formatDate(context.dueDate)}` : "";
    return `Sua parte pendente em “${context.title}” é ${BRL.format(remaining)}${due}.`;
  }
  return `Posso ajudar com “${context.title}”. Sua parte pendente é ${BRL.format(remaining)}. Você pode perguntar pelo valor, vencimento, Pix ou site do MeuNino.`;
}

function firstName(name: string) { return name.trim().split(/\s+/)[0] || "tudo bem"; }
function formatDate(date: string) { return new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR"); }
